async function handleApiRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method === 'GET' && path === '/api/v1/health') {
    return jsonResponse({ status: 'healthy', version: '2.0.0', timestamp: new Date().toISOString() });
  }

  if (request.method === 'POST' && path === '/api/v1/notes/generate') {
    return handleGenerateNote(request);
  }

  if (request.method === 'POST' && path === '/api/v1/notes/extract') {
    return handleExtractStructured(request);
  }

  if (request.method === 'POST' && path === '/api/v1/notes/format') {
    return handleFormatForEHR(request);
  }

  if (request.method === 'POST' && path === '/api/v1/notes/validate') {
    return handleValidateNote(request);
  }

  if (request.method === 'POST' && path === '/api/v1/webhooks/deliver') {
    return handleWebhookDeliver(request);
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

async function handleCloudProxy(request) {
  const body = await request.json();
  const groqKey = CLOUDFLARE_ENV.GROQ_API_KEY;
  const openrouterKey = CLOUDFLARE_ENV.OPENROUTER_API_KEY;

  if (groqKey) {
    try {
      return await tryGroq(body, groqKey);
    } catch (e) {
      console.error('Groq failed:', e.message);
    }
  }

  if (openrouterKey) {
    try {
      return await tryOpenRouter(body, openrouterKey);
    } catch (e) {
      console.error('OpenRouter failed:', e.message);
    }
  }

  return jsonResponse({ error: 'All cloud providers failed' }, 500);
}

async function handleGenerateNote(request) {
  try {
    const body = await request.json();
    const { raw_notes, note_type, target_ehr, system_prompt } = body;

    if (!raw_notes || !note_type) {
      return jsonResponse({ error: 'Missing required fields: raw_notes, note_type' }, 400);
    }

    const prompt = system_prompt || buildSystemPrompt(note_type);
    const userPrompt = `Note Type: ${note_type}\n\nRaw Notes:\n${raw_notes}`;

    const note = await generateWithFallback(prompt, userPrompt);
    if (!note) return jsonResponse({ error: 'All models failed' }, 500);

    const structured = extractStructuredData(note, note_type);
    const validation = validateClinicalContent(note, note_type);
    const formatted = target_ehr ? formatForEHR(structured, target_ehr) : null;

    return jsonResponse({
      success: true,
      note,
      structured,
      validation,
      formatted,
      metadata: { note_type, target_ehr, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleExtractStructured(request) {
  try {
    const body = await request.json();
    if (!body.note_text) return jsonResponse({ error: 'Missing note_text' }, 400);
    const structured = extractStructuredData(body.note_text, body.note_type || 'general');
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
    const validation = validateClinicalContent(body.note_text, body.note_type || 'general');
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
    const headers = { 'Content-Type': 'application/json' };
    if (body.secret) headers['X-Signature'] = generateSignature(body.payload, body.secret);
    const response = await fetch(body.webhook_url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'note.generated', timestamp: new Date().toISOString(), data: body.payload }),
    });
    return jsonResponse({ success: response.ok, status: response.status });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

async function generateWithFallback(systemPrompt, userPrompt) {
  const groqKey = CLOUDFLARE_ENV.GROQ_API_KEY;
  const openrouterKey = CLOUDFLARE_ENV.OPENROUTER_API_KEY;

  if (groqKey) {
    try { return await callGroq(systemPrompt, userPrompt, groqKey); }
    catch (e) { console.error('Groq failed:', e.message); }
  }
  if (openrouterKey) {
    try { return await callOpenRouter(systemPrompt, userPrompt, openrouterKey); }
    catch (e) { console.error('OpenRouter failed:', e.message); }
  }
  return null;
}

async function callGroq(systemPrompt, userPrompt, apiKey) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.3, max_tokens: 1024,
    }),
  });
  if (!response.ok) throw new Error(`Groq ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOpenRouter(systemPrompt, userPrompt, apiKey) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Mr-Midas/ai-scribe', 'X-Title': 'Note Scribe AI',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-70b-instruct',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.3, max_tokens: 1024,
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

function buildSystemPrompt(noteType) {
  return `You are a clinical documentation assistant specializing in occupational therapy. Convert shorthand notes into professional SOAP format.

RULES:
- Plain text. No markdown/placeholders.
- Use headers ONLY if section has data. Omit missing info.
- Language: Skilled ("Therapist facilitated", "Tactile cues for").
- Include sets, reps, distances, assistance levels.
- Tie interventions to functional goals.

ASSIST LEVELS: Independent, Supervision (verbal/visual), Standby Assist/SBA (ready, no contact), Contact Guard Assist/CGA (light touch), Min A (75%+), Mod A (50-74%), Max A (25-49%), Total Assist (<25%).

EQUIPMENT: Reacher (NEVER "grabber"), Dressing Stick, Sock Aide, Leg Lifter, Shoe Horn, Built-up Handles, Universal Cuff, Dycem, Button Hook.

${noteType === 'initial-eval' ? 'INITIAL EVAL: OBSERVATIONS ONLY. Baseline ROM, MMT (0-5), balance, assist levels. Document safety: hand placements, time, attempts, cues. No progress.' : 'TREATMENT/RE-EVAL: Document progress. Compare assist levels (e.g., "Improved from Mod A to SBA"). Update goals.'}

CONTEXT: Adjust for diagnosis (Stroke, TBI, SCI, Ortho). Never use "independent" if unsafe.

EXAMPLE EVAL:
Subjective: R shoulder pain 5/10, difficulty dressing.
Objective:
- Exercise: Facilitated RUE AROM 10 mins. Flexion 120, Abd 90.
- ADL: Instructed UB dressing with reacher. Mod A. Safety: Hands at hips. 2 attempts. Time: 8 min.
Assessment: Impaired RUE AROM, decreased UB dressing independence.
Plan: Continue OT. Goal: UB dressing with SBA in 4 weeks.`;
}

function extractStructuredData(noteText, noteType) {
  const sections = parseSOAPSections(noteText);
  const structured = {
    subjective: sections.subjective || '', objective: sections.objective || '',
    assessment: sections.assessment || '', plan: sections.plan || '',
    functional_abilities: { goals: [], activities: [], current_level: null, target_level: null },
    skin_integrity: { intact: true, areas_of_concern: [], breakdown: null },
    codes: { g_codes: [], functional_limitations: [], cpt_codes: [] },
    safety_observations: { hand_placements: [], time_to_complete: null, attempts: null, cues: [] },
  };

  const assistMatch = noteText.match(/(Independent|Supervision|Standby Assist|SBA|Contact Guard Assist|CGA|Min A|Mod A|Max A|Total Assist)/i);
  if (assistMatch) structured.functional_abilities.current_level = normalizeAssistLevel(assistMatch[1]);

  const goalMatch = noteText.match(/Goal[:\s]+([^.]+)\./i);
  if (goalMatch) structured.functional_abilities.goals.push(goalMatch[1].trim());

  const activityMatch = noteText.match(/(?:Instructed|Facilitated|Trained)\s+([^.]+)/i);
  if (activityMatch) structured.functional_abilities.activities.push(activityMatch[1].trim());

  const timeMatch = noteText.match(/Time[:\s]+(\d+)\s*min/i);
  if (timeMatch) structured.safety_observations.time_to_complete = parseInt(timeMatch[1]);

  const attemptsMatch = noteText.match(/(\d+)\s*attempts?/i);
  if (attemptsMatch) structured.safety_observations.attempts = parseInt(attemptsMatch[1]);

  if (/pain|swelling|redness|breakdown|ulcer/i.test(noteText)) {
    structured.skin_integrity.intact = false;
    const skinMatch = noteText.match(/(pain|swelling|redness|breakdown|ulcer)/gi);
    if (skinMatch) structured.skin_integrity.areas_of_concern = [...new Set(skinMatch.map(s => s.toLowerCase()))];
  }

  return structured;
}

function parseSOAPSections(text) {
  const sections = {};
  const patterns = {
    subjective: /Subjective[:\s]*([\s\S]*?)(?=Objective|Assessment|Plan|$)/i,
    objective: /Objective[:\s]*([\s\S]*?)(?=Subjective|Assessment|Plan|$)/i,
    assessment: /Assessment[:\s]*([\s\S]*?)(?=Subjective|Objective|Plan|$)/i,
    plan: /Plan[:\s]*([\s\S]*?)(?=Subjective|Objective|Assessment|$)/i,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) sections[key] = match[1].trim();
  }
  return sections;
}

function normalizeAssistLevel(level) {
  const n = level.toLowerCase().trim();
  if (n.includes('total')) return 'Total Assist';
  if (n.includes('max')) return 'Max A';
  if (n.includes('mod')) return 'Mod A';
  if (n.includes('min')) return 'Min A';
  if (n.includes('contact') || n.includes('cga')) return 'Contact Guard Assist';
  if (n.includes('standby') || n.includes('sba')) return 'Standby Assist';
  if (n.includes('supervision')) return 'Supervision';
  if (n.includes('independent')) return 'Independent';
  return level;
}

function validateClinicalContent(text, noteType) {
  const issues = [], warnings = [];
  if (!/Subjective|Objective|Assessment|Plan/i.test(text)) issues.push('Missing SOAP section headers');
  if (/grabber|reacher wand/i.test(text)) issues.push('Use "reacher" not "grabber"');
  if (noteType === 'initial-eval' && !/ROM|range of motion|MMT|strength/i.test(text)) warnings.push('Initial eval should include ROM/MMT/strength');
  if (noteType === 'treatment' && !/improved|progress|increased|decreased|changed/i.test(text)) warnings.push('Treatment note should document progress');
  return { valid: issues.length === 0, issues, warnings };
}

function formatForEHR(data, targetEhr) {
  if (targetEhr.toLowerCase() === 'therapyboss') return formatTherapyBOSS(data);
  if (targetEhr.toLowerCase() === 'kinnser') return formatKinnser(data);
  throw new Error(`Unsupported EHR: ${targetEhr}`);
}

function formatTherapyBOSS(data) {
  return {
    note_type: 'progress_note', current_status: data.subjective || '', treatments: data.objective || '',
    assessments: data.assessment || '', outcomes: data.plan || '',
    functional_abilities: data.functional_abilities, safety_observations: data.safety_observations,
    goals: data.functional_abilities?.goals || [],
  };
}

function formatKinnser(data) {
  return {
    document_type: 'progress_note',
    clinical_note: { subjective: data.subjective || '', objective: data.objective || '', assessment: data.assessment || '', plan: data.plan || '' },
    functional_status: { current_level: data.functional_abilities?.current_level || null, target_level: data.functional_abilities?.target_level || null, goals: data.functional_abilities?.goals || [], activities: data.functional_abilities?.activities || [] },
    skin_integrity: data.skin_integrity, safety_data: data.safety_observations, billing_codes: data.codes,
  };
}

function generateSignature(payload, secret) {
  const data = JSON.stringify(payload);
  let hash = 0;
  const combined = data + secret;
  for (let i = 0; i < combined.length; i++) { hash = ((hash << 5) - hash) + combined.charCodeAt(i); hash |= 0; }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
}

addEventListener('fetch', event => {
  event.respondWith(handleApiRequest(event.request));
});
