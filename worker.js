const ASSIST_LEVELS = [
  { pattern: /total assist/i, normalized: 'Total Assist' },
  { pattern: /max(?:imum)?\s*a/i, normalized: 'Max A' },
  { pattern: /mod(?:erate)?\s*a/i, normalized: 'Mod A' },
  { pattern: /min(?:imum)?\s*a/i, normalized: 'Min A' },
  { pattern: /contact guard|cga/i, normalized: 'Contact Guard Assist' },
  { pattern: /standby|sba/i, normalized: 'Standby Assist' },
  { pattern: /supervision/i, normalized: 'Supervision' },
  { pattern: /independent/i, normalized: 'Independent' },
];

const MASTER_KEY = 'nscrb_master_2026';

async function authenticateRequest(request) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return { valid: false, error: 'Missing X-API-Key header' };
  if (apiKey === MASTER_KEY) return { valid: true, key: apiKey, tier: 'unlimited' };
  try {
    const keyData = await API_KEYS.get(apiKey);
    if (!keyData) return { valid: false, error: 'Invalid API key' };
    const parsed = JSON.parse(keyData);
    if (!parsed.active) return { valid: false, error: 'API key deactivated' };
    return { valid: true, key: apiKey, tier: parsed.tier || 'standard' };
  } catch (e) {
    return { valid: false, error: 'Authentication error' };
  }
}

async function checkRateLimit(apiKey, tier) {
  const now = Date.now();
  const windowMs = 60000;
  const limits = { standard: 100, premium: 1000, unlimited: Infinity };
  const limit = limits[tier] || 100;
  try {
    const data = await RATE_LIMITS.get(`rl_${apiKey}`);
    const record = data ? JSON.parse(data) : { count: 0, reset: now + windowMs };
    if (now > record.reset) {
      record.count = 0;
      record.reset = now + windowMs;
    }
    record.count++;
    await RATE_LIMITS.put(`rl_${apiKey}`, JSON.stringify(record), { expirationTtl: 120 });
    return { allowed: record.count <= limit, remaining: Math.max(0, limit - record.count), reset: record.reset };
  } catch (e) {
    return { allowed: true, remaining: limit, reset: now + windowMs };
  }
}

const EQUIPMENT_LIST = [
  'reacher', 'dressing stick', 'sock aide', 'leg lifter',
  'shoe horn', 'built-up handles', 'universal cuff', 'dycem', 'button hook'
];

const BODY_REGIONS = [
  'right upper extremity', 'left upper extremity', 'right lower extremity', 'left lower extremity',
  'shoulder', 'elbow', 'wrist', 'hand', 'hip', 'knee', 'ankle', 'foot', 'spine', 'neck'
];

function buildSystemPrompt(noteType, targetEHR) {
  const rules = [
    'Convert OT shorthand notes to SOAP format.',
    'Plain text only. No markdown or placeholders.',
    'Use SOAP headers ONLY for sections with data.',
    'Omit sections with no data. Do not invent information.',
    'Use skilled language: "Therapist facilitated...", "Instructed patient in...", "Tactile cues required for..."',
    'Include exact sets, reps, distances, and assistance levels.',
    'Tie every intervention to a functional goal.'
  ].join('\n');

  const assist = 'Assistance levels (use exact terms): Independent, Supervision (verbal/visual only), Standby Assist/SBA (ready, no contact), Contact Guard Assist/CGA (light touch), Min A (75%+), Mod A (50-74%), Max A (25-49%), Total Assist (<25%).';

  const equip = 'Adaptive equipment: Reacher (NEVER "grabber" or "reacher wand"), Dressing Stick, Sock Aide, Leg Lifter, Shoe Horn, Built-up Handles, Universal Cuff, Dycem, Button Hook.';

  let noteTypeRules = '';
  if (noteType === 'initial-eval') {
    noteTypeRules = 'INITIAL EVALUATION: Document OBSERVATIONS ONLY. Include baseline ROM (degrees), MMT grades (0-5 scale), balance scores, assistance levels for each activity. Document safety: hand placements, time to complete tasks (minutes), number of attempts, and verbal/visual/tactile cues provided. Do NOT document progress. Set goals as target assistance levels.';
  } else if (noteType === 'treatment') {
    noteTypeRules = 'TREATMENT/RE-EVAL: Document progress since last session. Compare assistance levels (e.g., "Improved from Mod A to Standby Assist"). Note measurement changes (ROM, MMT). Update goals based on progress.';
  }

  const context = 'Context-aware goals: Consider diagnosis (stroke lesion location, TBI cognition, SCI level, orthopedic weight-bearing status). Never use "independent" as a goal if deficits make it unsafe.';

  let ehrRules = '';
  if (targetEHR === 'therapyboss') {
    ehrRules = 'THERAPYBOSS FORMAT: Emphasize Section GG functional abilities (self-care, mobility), G-codes with modifiers, functional limitation reporting, and measurable outcomes. Include FIM-level descriptors where applicable.';
  } else if (targetEHR === 'kinnser') {
    ehrRules = 'KINNSER FORMAT: Emphasize intake assessment structure (age, weight, height, initial impression, plan), progress note outcomes, and discharge summary fields. Include functional status measurements and safety data.';
  }

  return `${rules}\n\n${assist}\n\n${equip}\n\n${noteTypeRules}\n\n${context}\n\n${ehrRules}\n\nOutput ONLY the SOAP note text. No explanations, no markdown, no JSON wrapper.`;
}

function extractStructuredData(noteText, noteType) {
  const structured = {
    subjective: '', objective: '', assessment: '', plan: '',
    functional_abilities: { goals: [], activities: [], current_level: null, target_level: null, rom_measurements: [], strength_grades: [] },
    skin_integrity: { intact: true, areas_of_concern: [], breakdown: null, staging: null },
    codes: { g_codes: [], modifiers: [], cpt_codes: [], functional_limitations: [] },
    safety_observations: { hand_placements: [], time_to_complete: null, attempts: null, cues: [], fall_risk: false },
    equipment_used: []
  };

  const sections = parseSOAP(noteText);
  structured.subjective = sections.subjective || '';
  structured.objective = sections.objective || '';
  structured.assessment = sections.assessment || '';
  structured.plan = sections.plan || '';

  for (const { pattern, normalized } of ASSIST_LEVELS) {
    if (pattern.test(noteText)) {
      structured.functional_abilities.current_level = normalized;
      break;
    }
  }

  const goalMatch = noteText.match(/Goal[s]?:\s*([^.\n]+(?:\.[^.\n]+)?)/i);
  if (goalMatch) {
    structured.functional_abilities.goals.push(goalMatch[1].trim());
  }

  const activityMatches = noteText.match(/(?:Instructed|Facilitated|Trained|Performed)\s+([^.]+)/gi) || [];
  structured.functional_abilities.activities = activityMatches.map(a => a.trim());

  const romMatches = noteText.match(/(?:flexion|abduction|extension|rotation|adduction)[:\s]+(\d+)/gi) || [];
  structured.functional_abilities.rom_measurements = romMatches.map(r => {
    const parts = r.match(/(flexion|abduction|extension|rotation|adduction)[:\s]+(\d+)/i);
    return { movement: parts[1].toLowerCase(), degrees: parseInt(parts[2]) };
  });

  const mmtMatches = noteText.match(/(\w+(?:\s+\w+)?)\s*(\d)\/5/gi) || [];
  structured.functional_abilities.strength_grades = mmtMatches.map(m => {
    const parts = m.match(/(\w+(?:\s+\w+)?)\s*(\d)\/5/i);
    return { muscle_group: parts[1].trim(), grade: parseInt(parts[2]) };
  });

  const timeMatch = noteText.match(/Time[:\s]+(\d+)\s*min/i);
  if (timeMatch) structured.safety_observations.time_to_complete = parseInt(timeMatch[1]);

  const attemptsMatch = noteText.match(/(\d+)\s*attempts?/i);
  if (attemptsMatch) structured.safety_observations.attempts = parseInt(attemptsMatch[1]);

  const cues = [];
  if (/verbal cues?/i.test(noteText)) cues.push('verbal');
  if (/visual cues?/i.test(noteText)) cues.push('visual');
  if (/tactile cues?/i.test(noteText)) cues.push('tactile');
  structured.safety_observations.cues = cues;

  const handMatch = noteText.match(/hands?[:\s]+([^.]+)/i);
  if (handMatch) structured.safety_observations.hand_placements.push(handMatch[1].trim());

  if (/fall risk|unsteady|dizziness|loss of balance/i.test(noteText)) {
    structured.safety_observations.fall_risk = true;
  }

  if (/pain|swelling|redness|breakdown|ulcer|wound|skin/i.test(noteText)) {
    structured.skin_integrity.intact = false;
    const concerns = [];
    if (/pain/i.test(noteText)) concerns.push('pain');
    if (/swelling|edema/i.test(noteText)) concerns.push('swelling');
    if (/redness|erythema/i.test(noteText)) concerns.push('redness');
    if (/breakdown|ulcer|wound/i.test(noteText)) concerns.push('breakdown');
    structured.skin_integrity.areas_of_concern = [...new Set(concerns)];
    const stageMatch = noteText.match(/stage\s*(\d+|I{1,3}V?)/i);
    if (stageMatch) structured.skin_integrity.staging = stageMatch[1];
  }

  for (const equip of EQUIPMENT_LIST) {
    if (noteText.toLowerCase().includes(equip)) {
      structured.equipment_used.push(equip);
    }
  }

  const gcodeMatch = noteText.match(/G\d{4,5}/g);
  if (gcodeMatch) structured.codes.g_codes = gcodeMatch;

  const modifierMatch = noteText.match(/modifier[:\s]+([^.]+)/i);
  if (modifierMatch) structured.codes.modifiers.push(modifierMatch[1].trim());

  const cptPatterns = [
    { pattern: /therapeutic activit/i, code: '97530' },
    { pattern: /therapeutic procedure|therapeutic exercise/i, code: '97110' },
    { pattern: /self.?care|home management|ADL training/i, code: '97535' },
    { pattern: /community|work reintegration/i, code: '97537' },
    { pattern: /neuromuscular reeducation/i, code: '97112' },
    { pattern: /gait training/i, code: '97116' },
    { pattern: /manual therapy/i, code: '97140' }
  ];
  for (const { pattern, code } of cptPatterns) {
    if (pattern.test(noteText)) structured.codes.cpt_codes.push({ code, description: codeDescription(code) });
  }

  return structured;
}

function codeDescription(code) {
  const codes = {
    '97530': 'Therapeutic activities', '97110': 'Therapeutic procedure',
    '97535': 'Self-care/home management training', '97537': 'Community/work reintegration',
    '97112': 'Neuromuscular reeducation', '97116': 'Gait training', '97140': 'Manual therapy'
  };
  return codes[code] || code;
}

function parseSOAP(text) {
  const sections = {};
  const patterns = {
    subjective: /Subjective[:\s]*([\s\S]*?)(?=Objective|Assessment|Plan|$)/i,
    objective: /Objective[:\s]*([\s\S]*?)(?=Subjective|Assessment|Plan|$)/i,
    assessment: /Assessment[:\s]*([\s\S]*?)(?=Subjective|Objective|Plan|$)/i,
    plan: /Plan[:\s]*([\s\S]*?)(?=Subjective|Objective|Assessment|$)/i
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) sections[key] = match[1].trim();
  }
  return sections;
}

function validateClinicalContent(text, noteType, targetEHR) {
  const issues = [];
  const warnings = [];

  if (!/Subjective[:\s]/i.test(text)) issues.push('Missing Subjective section');
  if (!/Objective[:\s]/i.test(text)) issues.push('Missing Objective section');
  if (!/Assessment[:\s]/i.test(text)) issues.push('Missing Assessment section');
  if (!/Plan[:\s]/i.test(text)) issues.push('Missing Plan section');

  const hasAssistLevel = ASSIST_LEVELS.some(({ pattern }) => pattern.test(text));
  if (!hasAssistLevel) issues.push('No assistance level documented');

  if (/grabber|reacher wand/i.test(text)) {
    issues.push('Incorrect equipment term: use "reacher" not "grabber"');
  }

  if (/patient walked|patient told|patient said|patient made|patient did/i.test(text)) {
    warnings.push('Use skilled language: "Therapist facilitated..." instead of "patient walked"');
  }

  if (noteType === 'initial-eval') {
    if (!/ROM|range of motion|degrees|flexion|abduction/i.test(text)) {
      warnings.push('Initial eval should include ROM measurements');
    }
    if (!/MMT|strength|\/5/i.test(text)) {
      warnings.push('Initial eval should include MMT grades');
    }
    if (/improved|progress|increased from|decreased from/i.test(text)) {
      warnings.push('Initial eval should not document progress');
    }
  }

  if (noteType === 'treatment') {
    if (!/improved|progress|increased|decreased|changed|maintained|regressed/i.test(text)) {
      warnings.push('Treatment note should document progress');
    }
  }

  if (targetEHR === 'therapyboss') {
    if (!/G\d{4,5}|G-code|functional limitation/i.test(text)) {
      warnings.push('TherapyBOSS notes should include G-codes or functional limitation reporting');
    }
    if (!/Section GG|self-care|mobility/i.test(text)) {
      warnings.push('TherapyBOSS notes should reference Section GG functional abilities');
    }
  }

  if (targetEHR === 'kinnser') {
    if (!/intake|assessment|plan|discharge/i.test(text)) {
      warnings.push('Kinnser notes should follow intake/assessment/plan structure');
    }
  }

  return { valid: issues.length === 0, issues, warnings };
}

function buildRetryPrompt(originalPrompt, validation, noteType) {
  const feedback = [];
  if (validation.issues.length > 0) {
    feedback.push(`Fix these issues: ${validation.issues.join('; ')}`);
  }
  if (validation.warnings.length > 0) {
    feedback.push(`Address these: ${validation.warnings.join('; ')}`);
  }
  return `${originalPrompt}\n\nIMPORTANT CORRECTIONS NEEDED:\n${feedback.join('\n')}\n\nRegenerate the complete SOAP note with these corrections.`;
}

async function generateWithRetry(systemPrompt, userPrompt, noteType, targetEHR) {
  const groqKey = CLOUDFLARE_ENV.GROQ_API_KEY;
  const openrouterKey = CLOUDFLARE_ENV.OPENROUTER_API_KEY;

  let currentPrompt = userPrompt;
  let lastNote = null;
  let lastValidation = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let note = null;
    let modelUsed = null;

    if (groqKey) {
      try {
        note = await callGroq(systemPrompt, currentPrompt, groqKey);
        modelUsed = 'groq';
      } catch (e) {
        console.error(`Groq attempt ${attempt + 1} failed:`, e.message);
      }
    }

    if (!note && openrouterKey) {
      try {
        note = await callOpenRouter(systemPrompt, currentPrompt, openrouterKey);
        modelUsed = 'openrouter';
      } catch (e) {
        console.error(`OpenRouter attempt ${attempt + 1} failed:`, e.message);
      }
    }

    if (!note) continue;

    lastNote = note;
    lastValidation = validateClinicalContent(note, noteType, targetEHR);

    if (lastValidation.valid) {
      return { note, validation: lastValidation, modelUsed, attempts: attempt + 1 };
    }

    if (attempt < 2) {
      currentPrompt = buildRetryPrompt(userPrompt, lastValidation, noteType);
    }
  }

  return {
    note: lastNote,
    validation: lastValidation || { valid: false, issues: ['All retries failed'], warnings: [] },
    modelUsed: 'unknown',
    attempts: 3
  };
}

async function callGroq(systemPrompt, userPrompt, apiKey) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1024
    })
  });
  if (!response.ok) throw new Error(`Groq ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOpenRouter(systemPrompt, userPrompt, apiKey) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Mr-Midas/ai-scribe',
      'X-Title': 'Note Scribe AI'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-70b-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1024
    })
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

function formatForEHR(structured, targetEHR) {
  if (targetEhr === 'therapyboss') return formatTherapyBOSS(structured);
  if (targetEhr === 'kinnser') return formatKinnser(structured);
  throw new Error(`Unsupported EHR: ${targetEhr}`);
}

function formatTherapyBOSS(data) {
  return {
    note_type: 'progress_note',
    current_status: data.subjective || '',
    treatments: data.objective || '',
    assessments: data.assessment || '',
    outcomes: data.plan || '',
    functional_abilities: {
      goals: data.functional_abilities?.goals || [],
      activities: data.functional_abilities?.activities || [],
      current_level: data.functional_abilities?.current_level || null,
      target_level: data.functional_abilities?.target_level || null,
      rom_measurements: data.functional_abilities?.rom_measurements || [],
      strength_grades: data.functional_abilities?.strength_grades || []
    },
    safety_observations: {
      hand_placements: data.safety_observations?.hand_placements || [],
      time_to_complete: data.safety_observations?.time_to_complete || null,
      attempts: data.safety_observations?.attempts || null,
      cues: data.safety_observations?.cues || [],
      fall_risk: data.safety_observations?.fall_risk || false
    },
    skin_integrity: {
      intact: data.skin_integrity?.intact ?? true,
      areas_of_concern: data.skin_integrity?.areas_of_concern || [],
      breakdown: data.skin_integrity?.breakdown || null
    },
    codes: {
      g_codes: data.codes?.g_codes || [],
      modifiers: data.codes?.modifiers || [],
      cpt_codes: data.codes?.cpt_codes || []
    },
    equipment_used: data.equipment_used || []
  };
}

function formatKinnser(data) {
  return {
    document_type: 'progress_note',
    clinical_note: {
      subjective: data.subjective || '',
      objective: data.objective || '',
      assessment: data.assessment || '',
      plan: data.plan || ''
    },
    functional_status: {
      current_level: data.functional_abilities?.current_level || null,
      target_level: data.functional_abilities?.target_level || null,
      goals: data.functional_abilities?.goals || [],
      activities: data.functional_abilities?.activities || [],
      rom_measurements: data.functional_abilities?.rom_measurements || [],
      strength_grades: data.functional_abilities?.strength_grades || []
    },
    skin_integrity: {
      intact: data.skin_integrity?.intact ?? true,
      areas_of_concern: data.skin_integrity?.areas_of_concern || [],
      breakdown: data.skin_integrity?.breakdown || null,
      staging: data.skin_integrity?.staging || null
    },
    safety_data: {
      hand_placements: data.safety_observations?.hand_placements || [],
      time_to_complete: data.safety_observations?.time_to_complete || null,
      attempts: data.safety_observations?.attempts || null,
      cues: data.safety_observations?.cues || [],
      fall_risk: data.safety_observations?.fall_risk || false
    },
    billing_codes: {
      g_codes: data.codes?.g_codes || [],
      modifiers: data.codes?.modifiers || [],
      cpt_codes: data.codes?.cpt_codes || []
    },
    equipment_used: data.equipment_used || []
  };
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

async function auditLog(event) {
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

    const logUrl = CLOUDFLARE_ENV.AUDIT_LOG_URL;
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
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    headers['X-Signature'] = generateSignature(payload, secret);
  }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: 'note.generated',
      timestamp: new Date().toISOString(),
      data: payload
    })
  });
  return { success: response.ok, status: response.status };
}

function generateSignature(payload, secret) {
  const data = JSON.stringify(payload);
  let hash = 0;
  const combined = data + secret;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
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

async function handleApiRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method === 'GET' && path === '/api/v1/health') {
    return jsonResponse({ status: 'healthy', version: '3.1.0', timestamp: new Date().toISOString() });
  }

  if (request.method === 'GET' && path === '/api/v1/usage') {
    return handleUsageStats(request);
  }

  const auth = await authenticateRequest(request);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error }, 401);
  }

  const rateLimit = await checkRateLimit(auth.key, auth.tier);
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'Rate limit exceeded', retry_after_ms: rateLimit.reset - Date.now() }, 429);
  }

  const rateHeaders = {
    'X-RateLimit-Limit': auth.tier === 'unlimited' ? 'unlimited' : String(auth.tier === 'premium' ? 1000 : 100),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rateLimit.reset / 1000))
  };

  let response;
  if (request.method === 'POST' && path === '/api/v1/notes/generate') {
    response = await handleGenerateNote(request);
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
      standard: '100 requests/minute',
      premium: '1000 requests/minute',
      unlimited: 'No limit'
    },
    timestamp: new Date().toISOString()
  });
}

async function handleGenerateNote(request) {
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

    const result = await generateWithRetry(prompt, userPrompt, note_type, target_ehr);

    if (!result.note) {
      return jsonResponse({ error: 'All models failed after retries' }, 500);
    }

    const structured = extractStructuredData(result.note, note_type);
    const formatted = target_ehr ? formatForEHR(structured, targetEhr) : null;

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
    });

    if (webhook_url && formatted) {
      deliverWebhook(webhook_url, formatted, webhook_secret).catch(e =>
        console.error('Webhook delivery failed:', e.message)
      );
    }

    return jsonResponse({
      success: true,
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
    const validation = validateClinicalContent(body.note_text, body.note_type || 'general', body.target_ehr);
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

addEventListener('fetch', event => {
  event.respondWith(handleApiRequest(event.request));
});
