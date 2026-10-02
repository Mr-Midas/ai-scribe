import {
  buildSystemPrompt,
  extractStructuredData,
  validateClinicalContent,
  buildRetryPrompt,
  formatForEHR
} from './src/clinical.js';
import { APP_HTML } from './src/app.js';

// The web app only talks to this API and loads nothing from other sites.
const APP_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
};

// Constant-time comparison, so response timing doesn't reveal how much of a
// guessed key was right.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authenticateRequest(request, env) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return { valid: false, error: 'Missing X-API-Key header' };
  // The master key is a Wrangler secret (`wrangler secret put MASTER_KEY`), never
  // source code. With no secret set, there is no master key.
  if (env.MASTER_KEY && safeEqual(apiKey, env.MASTER_KEY)) return { valid: true, key: 'master', tier: 'unlimited' };
  try {
    const keyData = await env.API_KEYS.get(apiKey);
    if (!keyData) return { valid: false, error: 'Invalid API key' };
    const parsed = JSON.parse(keyData);
    if (!parsed.active) return { valid: false, error: 'API key deactivated' };
    return { valid: true, key: apiKey, tier: parsed.tier || 'standard' };
  } catch (e) {
    return { valid: false, error: 'Authentication error' };
  }
}

// Requests per minute per key. "demo" is the shared public testing key.
const RATE_LIMITS_PER_MINUTE = { demo: 10, standard: 100, premium: 1000, unlimited: Infinity };

async function checkRateLimit(apiKey, tier, env) {
  const now = Date.now();
  const windowMs = 60000;
  const limit = RATE_LIMITS_PER_MINUTE[tier] || RATE_LIMITS_PER_MINUTE.standard;
  try {
    const data = await env.RATE_LIMITS.get(`rl_${apiKey}`);
    const record = data ? JSON.parse(data) : { count: 0, reset: now + windowMs };
    if (now > record.reset) {
      record.count = 0;
      record.reset = now + windowMs;
    }
    record.count++;
    await env.RATE_LIMITS.put(`rl_${apiKey}`, JSON.stringify(record), { expirationTtl: 120 });
    return { allowed: record.count <= limit, remaining: Math.max(0, limit - record.count), reset: record.reset };
  } catch (e) {
    return { allowed: true, remaining: limit, reset: now + windowMs };
  }
}

async function generateWithRetry(systemPrompt, userPrompt, noteType, targetEHR, env, sourceNotes) {
  const groqKey = env.GROQ_API_KEY;
  // Patient notes may only go to providers with a signed HIPAA Business Associate
  // Agreement. OpenRouter routes to many upstream providers, so it is off unless
  // OPENROUTER_FALLBACK is set to "enabled".
  const openrouterKey = env.OPENROUTER_FALLBACK === 'enabled' ? env.OPENROUTER_API_KEY : null;

  let currentPrompt = userPrompt;
  let lastNote = null;
  let lastValidation = null;
  let lastModel = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let note = null;
    let modelUsed = null;

    if (groqKey) {
      try {
        note = await callGroq(systemPrompt, currentPrompt, groqKey, env.GROQ_MODEL || DEFAULT_GROQ_MODEL);
        modelUsed = `groq:${env.GROQ_MODEL || DEFAULT_GROQ_MODEL}`;
      } catch (e) {
        console.error(`Groq attempt ${attempt + 1} failed:`, e.message);
        // Rate limited: wait as long as Groq asks (capped) before the next attempt
        // rather than burning all retries in under a second.
        if (e.retryAfterMs !== undefined && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, Math.min(e.retryAfterMs, MAX_RATE_LIMIT_WAIT_MS)));
        }
      }
    }

    if (!note && openrouterKey) {
      try {
        note = await callOpenRouter(systemPrompt, currentPrompt, openrouterKey, env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL);
        modelUsed = `openrouter:${env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL}`;
      } catch (e) {
        console.error(`OpenRouter attempt ${attempt + 1} failed:`, e.message);
      }
    }

    if (!note) continue;

    lastNote = note;
    lastModel = modelUsed;
    lastValidation = validateClinicalContent(note, noteType, targetEHR, sourceNotes);

    if (lastValidation.valid) {
      return { note, validation: lastValidation, modelUsed, attempts: attempt + 1 };
    }

    if (attempt < 2) {
      currentPrompt = buildRetryPrompt(userPrompt, lastValidation);
    }
  }

  return {
    note: lastNote,
    validation: lastValidation || { valid: false, issues: ['All retries failed'], warnings: [] },
    modelUsed: lastModel || 'none',
    attempts: 3
  };
}

// llama3-70b-8192 and llama-3.3-70b-versatile have both been decommissioned by Groq.
// Override with the GROQ_MODEL / OPENROUTER_MODEL vars without redeploying code.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.1-70b-instruct';

// A hung provider must fail over instead of holding the request open.
const MODEL_TIMEOUT_MS = 20000;
// Low temperature: notes should be a faithful rewrite, not creative writing.
const MODEL_TEMPERATURE = 0.1;
// Longest a request waits on a provider's rate limit before trying again.
const MAX_RATE_LIMIT_WAIT_MS = 10000;

async function callGroq(systemPrompt, userPrompt, apiKey, model) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: MODEL_TEMPERATURE,
    max_tokens: 2048
  };
  // gpt-oss models spend output tokens on reasoning; keep it short for latency.
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok) {
    const error = new Error(`Groq ${response.status}: ${(await response.text()).slice(0, 200)}`);
    if (response.status === 429) {
      const seconds = parseFloat(response.headers.get('retry-after'));
      error.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : 2000;
    }
    throw error;
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned empty content');
  return content;
}

async function callOpenRouter(systemPrompt, userPrompt, apiKey, model) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Mr-Midas/ai-scribe',
      'X-Title': 'Note Scribe AI'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: MODEL_TEMPERATURE,
      max_tokens: 1024
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned empty content');
  return content;
}

function hashUserId(userId) {
  let hash = 0;
  const str = String(userId);
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function stripMetadata(obj) {
  const stripped = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'raw_notes' || key === 'note_text' || key === 'note' || key === 'prompt' || key === 'system_prompt') continue;
    if (typeof value === 'string') {
      stripped[key] = value.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[NAME]').replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]').replace(/\b\d{5}(-\d{4})?\b/g, '[ZIP]');
    } else if (typeof value === 'object' && value !== null) {
      stripped[key] = stripMetadata(value);
    } else {
      stripped[key] = value;
    }
  }
  return stripped;
}

async function auditLog(event, env) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      event_type: event.type,
      user_hash: event.userId ? hashUserId(event.userId) : null,
      ehr_platform: event.platform || null,
      success: event.success,
      model_used: event.model || null,
      duration_ms: event.duration || null,
      note_type: event.noteType || null,
      validation_issues_count: event.validationIssues?.length || 0,
      validation_warnings_count: event.validationWarnings?.length || 0,
      attempts: event.attempts || null
    };

    const logUrl = env.AUDIT_LOG_URL;
    if (logUrl) {
      await fetch(logUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
    }
    return true;
  } catch (error) {
    console.error('Audit log failed:', error.message);
    return false;
  }
}

async function deliverWebhook(webhookUrl, payload, secret) {
  // Sign the exact bytes sent so the receiver can verify them as-is.
  const body = JSON.stringify({
    event: 'note.generated',
    timestamp: new Date().toISOString(),
    data: payload
  });
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    headers['X-Signature'] = `sha256=${await generateSignature(body, secret)}`;
  }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10000)
  });
  return { success: response.ok, status: response.status };
}

// HMAC-SHA256 of the request body, hex-encoded.
async function generateSignature(body, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function handleApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method === 'GET' && (path === '/' || path === '/app')) {
    // Only a well-formed key is inserted into the page; anything else hides the guest button.
    const demoKey = /^nscrb_[A-Za-z0-9_]+$/.test(env.DEMO_API_KEY || '') ? env.DEMO_API_KEY : '';
    return new Response(APP_HTML.replace('__DEMO_API_KEY__', demoKey), { headers: APP_HEADERS });
  }

  if (request.method === 'GET' && path === '/api/v1/health') {
    return jsonResponse({ status: 'healthy', version: '3.1.0', timestamp: new Date().toISOString() });
  }

  if (request.method === 'GET' && path === '/api/v1/usage') {
    return handleUsageStats(request);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error }, 401);
  }

  const rateLimit = await checkRateLimit(auth.key, auth.tier, env);
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'Rate limit exceeded', retry_after_ms: rateLimit.reset - Date.now() }, 429);
  }

  const rateHeaders = {
    'X-RateLimit-Limit': auth.tier === 'unlimited' ? 'unlimited' : String(RATE_LIMITS_PER_MINUTE[auth.tier] || RATE_LIMITS_PER_MINUTE.standard),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rateLimit.reset / 1000))
  };

  let response;
  if (request.method === 'GET' && path === '/api/v1/auth/check') {
    response = jsonResponse({ valid: true, tier: auth.tier });
  } else if (request.method === 'POST' && path === '/api/v1/notes/generate') {
    response = await handleGenerateNote(request, env, ctx);
  } else if (request.method === 'POST' && path === '/api/v1/notes/extract') {
    response = await handleExtractStructured(request);
  } else if (request.method === 'POST' && path === '/api/v1/notes/format') {
    response = await handleFormatForEHR(request);
  } else if (request.method === 'POST' && path === '/api/v1/notes/validate') {
    response = await handleValidateNote(request);
  } else if (request.method === 'POST' && path === '/api/v1/webhooks/deliver') {
    response = await handleWebhookDeliver(request);
  } else {
    response = jsonResponse({ error: 'Not found' }, 404);
  }

  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(rateHeaders)) newHeaders.set(k, v);
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

async function handleUsageStats(request) {
  return jsonResponse({
    status: 'ok',
    version: '3.1.0',
    endpoints: {
      'POST /api/v1/notes/generate': 'Generate SOAP note with validation + retry',
      'POST /api/v1/notes/extract': 'Extract structured EHR data',
      'POST /api/v1/notes/format': 'Format for TherapyBOSS or Kinnser',
      'POST /api/v1/notes/validate': 'Validate clinical content',
      'POST /api/v1/webhooks/deliver': 'Deliver payload to EHR webhook'
    },
    rate_limits: {
      demo: '10 requests/minute (shared public testing key)',
      standard: '100 requests/minute',
      premium: '1000 requests/minute',
      unlimited: 'No limit'
    },
    timestamp: new Date().toISOString()
  });
}

async function handleGenerateNote(request, env, ctx) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { raw_notes, note_type, target_ehr, system_prompt, webhook_url, webhook_secret } = body;

    if (!raw_notes || !note_type) {
      return jsonResponse({ error: 'Missing required fields: raw_notes, note_type' }, 400);
    }

    const prompt = system_prompt || buildSystemPrompt(note_type, target_ehr);
    const noteTypeLabel = note_type === 'initial-eval' ? 'INITIAL EVALUATION' : 'TREATMENT / RE-EVALUATION';
    const userPrompt = `Note Type: ${noteTypeLabel}\n\nRaw Notes:\n${raw_notes}`;

    const result = await generateWithRetry(prompt, userPrompt, note_type, target_ehr, env, raw_notes);

    if (!result.note) {
      return jsonResponse({ error: 'All models failed after retries' }, 500);
    }

    const structured = extractStructuredData(result.note, note_type, raw_notes);
    const formatted = target_ehr ? formatForEHR(structured, target_ehr) : null;

    const duration = Date.now() - startTime;

    await auditLog({
      type: 'note_generated',
      platform: target_ehr,
      success: true,
      model: result.modelUsed,
      duration,
      noteType: note_type,
      validationIssues: result.validation.issues,
      validationWarnings: result.validation.warnings,
      attempts: result.attempts,
      metadata: stripMetadata({ raw_notes, note_type, target_ehr })
    }, env);

    if (webhook_url && formatted) {
      ctx.waitUntil(deliverWebhook(webhook_url, formatted, webhook_secret).catch(e =>
        console.error('Webhook delivery failed:', e.message)
      ));
    }

    return jsonResponse({
      success: true,
      // true when the note still failed validation after all retries (e.g. it
      // contains values not found in raw_notes). Clients should show it to the
      // clinician for review rather than filing it automatically.
      review_required: !result.validation.valid,
      note: result.note,
      structured,
      validation: result.validation,
      formatted,
      metadata: {
        note_type,
        target_ehr,
        model_used: result.modelUsed,
        attempts: result.attempts,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleExtractStructured(request) {
  try {
    const body = await request.json();
    if (!body.note_text) return jsonResponse({ error: 'Missing note_text' }, 400);
    const structured = extractStructuredData(body.note_text, body.note_type || 'general', body.raw_notes);
    return jsonResponse({ success: true, structured });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleFormatForEHR(request) {
  try {
    const body = await request.json();
    if (!body.structured_data || !body.target_ehr) {
      return jsonResponse({ error: 'Missing structured_data or target_ehr' }, 400);
    }
    const formatted = formatForEHR(body.structured_data, body.target_ehr);
    return jsonResponse({ success: true, formatted, ehr: body.target_ehr });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleValidateNote(request) {
  try {
    const body = await request.json();
    if (!body.note_text) return jsonResponse({ error: 'Missing note_text' }, 400);
    const validation = validateClinicalContent(body.note_text, body.note_type || 'general', body.target_ehr, body.raw_notes);
    return jsonResponse({ success: true, validation });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleWebhookDeliver(request) {
  try {
    const body = await request.json();
    if (!body.webhook_url || !body.payload) {
      return jsonResponse({ error: 'Missing webhook_url or payload' }, 400);
    }
    const result = await deliverWebhook(body.webhook_url, body.payload, body.secret);
    return jsonResponse({ success: result.success, status: result.status });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

export default {
  fetch(request, env, ctx) {
    return handleApiRequest(request, env, ctx);
  }
};
