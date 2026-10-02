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

async function authenticateRequest(request, env) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return { valid: false, error: 'Missing X-API-Key header' };
  if (apiKey === MASTER_KEY) return { valid: true, key: apiKey, tier: 'unlimited' };
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

async function checkRateLimit(apiKey, tier, env) {
  const now = Date.now();
  const windowMs = 60000;
  const limits = { standard: 100, premium: 1000, unlimited: Infinity };
  const limit = limits[tier] || 100;
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
    'Always use exactly these four headers, each on its own line: "Subjective:", "Objective:", "Assessment:", "Plan:".',
    'Never invent findings, measurements, scores or codes. If a section has no supporting data, write "Not documented this session." under its header.',
    'Use skilled language: "Therapist facilitated...", "Instructed patient in...", "Tactile cues required for..."',
    'Include exact sets, reps, distances, and assistance levels.',
    'Tie every intervention to a functional goal.',
    'Do NOT output billing codes (CPT, HCPCS, G-codes, ICD-10) unless they appear in the raw notes; coding is the clinician\'s responsibility. Medicare functional limitation G-codes were discontinued on 1/1/2019.'
  ].join('\n');

  const measures = 'Measurements (only when given in the raw notes): ROM as side + joint + motion + AROM/PROM + degrees, e.g. "R hip flexion AROM 0-90 degrees". Strength as MMT grade on the 0-5 scale with optional +/-, e.g. "R hip abduction 3+/5". Never write MMT grades as degrees or degrees as MMT grades.';

  const assist = 'Assistance levels (use exact terms; percentages are the share of effort the PATIENT performs): Independent, Supervision (verbal/visual only), Standby Assist/SBA (ready, no contact), Contact Guard Assist/CGA (light touch), Min A (patient 75%+), Mod A (patient 50-74%), Max A (patient 25-49%), Total Assist (patient <25%). State the level per activity.';

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
    ehrRules = 'THERAPYBOSS FORMAT: Emphasize Section GG functional abilities (self-care, mobility) and measurable outcomes. When the raw notes give enough detail, the matching OASIS Section GG performance level may be noted (06 Independent, 05 Setup/clean-up, 04 Supervision/touching, 03 Partial/moderate, 02 Substantial/maximal, 01 Dependent).';
  } else if (targetEHR === 'kinnser') {
    ehrRules = 'KINNSER FORMAT: Emphasize intake assessment structure (age, weight, height, initial impression, plan), progress note outcomes, and discharge summary fields. Include functional status measurements and safety data.';
  }

  return `${rules}\n\n${measures}\n\n${assist}\n\n${equip}\n\n${noteTypeRules}\n\n${context}\n\n${ehrRules}\n\nOutput ONLY the SOAP note text. No explanations, no markdown, no JSON wrapper.`;
}

function extractStructuredData(noteText, noteType) {
  const structured = {
    subjective: '', objective: '', assessment: '', plan: '',
    functional_abilities: { goals: [], activities: [], current_level: null, target_level: null, rom_measurements: [], strength_grades: [] },
    skin_integrity: { intact: null, areas_of_concern: [], breakdown: null, staging: null },
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

  structured.functional_abilities.rom_measurements = extractROM(noteText);
  structured.functional_abilities.strength_grades = extractMMT(noteText);

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

  // Skin integrity is only set when the note documents it; pain or edema alone
  // say nothing about the skin. null means "not assessed / not documented".
  const skinFindings = [];
  if (/redness|erythema|non-?blanchable/i.test(noteText)) skinFindings.push('redness');
  if (/breakdown|ulcer|wound|pressure injur|abrasion|skin tear|laceration/i.test(noteText)) skinFindings.push('breakdown');
  if (/maceration|macerated/i.test(noteText)) skinFindings.push('maceration');
  if (skinFindings.length > 0) {
    structured.skin_integrity.intact = false;
    structured.skin_integrity.areas_of_concern = skinFindings;
    structured.skin_integrity.breakdown = skinFindings.includes('breakdown');
    const stageMatch = noteText.match(/stage\s*(\d|I{1,3}V?|IV)\b/i);
    if (stageMatch) structured.skin_integrity.staging = stageMatch[1];
  } else if (/skin (?:is |was |remains )?intact|skin integrity (?:is |was )?(?:intact|WNL|within normal limits)/i.test(noteText)) {
    structured.skin_integrity.intact = true;
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

const SIDE = String.raw`(?:(R|L|B|right|left|bilateral|bilat)\.?\s+)?`;
const JOINT = String.raw`(?:(shoulder|elbow|wrist|forearm|hip|knee|ankle|cervical|lumbar|trunk|thumb|finger|digit)s?\s+)?`;
const MOTION = String.raw`(flexion|extension|abduction|adduction|internal rotation|external rotation|IR|ER|rotation|supination|pronation|dorsiflexion|plantarflexion|plantar flexion|radial deviation|ulnar deviation|inversion|eversion)`;

// Goniometric ROM, e.g. "R hip flexion AROM 0-90 degrees", "knee extension: -10".
// A number followed by "/5" is an MMT grade and is never taken as degrees.
const ROM_RE = new RegExp(String.raw`\b${SIDE}${JOINT}${MOTION}\b[:\s]*(?:\(?(AROM|PROM|AAROM)\)?[:\s]*)?(?:(-?\d{1,3})\s*(?:-|–|to)\s*)?(-?\d{1,3})(?![\d.]|\s*[+-]?\s*\/\s*5)\s*(°|deg(?:rees)?\b)?`, 'gi');

// Manual muscle testing, e.g. "R hip flexion 3/5", "grip 4-/5", "shoulder abduction 3+/5".
const MMT_RE = new RegExp(String.raw`\b${SIDE}${JOINT}(${MOTION.slice(1, -1)}|grip|pinch|[a-z]+)?[:\s]*(?:MMT[:\s]*)?\b([0-5])([+-])?\s*\/\s*5\b`, 'gi');

function normalizeSide(side) {
  if (!side) return null;
  const s = side.toLowerCase();
  if (s.startsWith('r')) return 'R';
  if (s.startsWith('l')) return 'L';
  return 'B';
}

function extractROM(text) {
  const results = [];
  for (const m of String(text || '').matchAll(ROM_RE)) {
    const [, side, joint, movement, type, from, to, unit] = m;
    const degrees = parseInt(to, 10);
    if (Math.abs(degrees) > 180) continue;
    // Without a unit, AROM/PROM tag, range, or ROM on the same line, a number after
    // "flexion" is as likely to be reps or sets as degrees.
    const lineStart = m.input.lastIndexOf('\n', m.index) + 1;
    const lineEnd = m.input.indexOf('\n', m.index);
    const line = m.input.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (!unit && !type && from === undefined && !/\bROM\b|range of motion/i.test(line)) continue;
    results.push({
      side: normalizeSide(side),
      joint: joint ? joint.toLowerCase() : null,
      movement: movement.toLowerCase(),
      type: type ? type.toUpperCase() : null,
      start_degrees: from !== undefined ? parseInt(from, 10) : null,
      degrees
    });
  }
  return results;
}

function extractMMT(text) {
  const results = [];
  for (const m of String(text || '').matchAll(MMT_RE)) {
    const [, side, joint, group, grade, modifier] = m;
    const muscleGroup = [joint, group].filter(Boolean).join(' ').toLowerCase() || null;
    results.push({
      side: normalizeSide(side),
      muscle_group: muscleGroup,
      grade: parseInt(grade, 10),
      modifier: modifier || null,
      label: `${grade}${modifier || ''}/5`
    });
  }
  return results;
}

function codeDescription(code) {
  const codes = {
    '97530': 'Therapeutic activities', '97110': 'Therapeutic procedure',
    '97535': 'Self-care/home management training', '97537': 'Community/work reintegration',
    '97112': 'Neuromuscular reeducation', '97116': 'Gait training', '97140': 'Manual therapy'
  };
  return codes[code] || code;
}

// Matches SOAP headers in full ("Subjective:") or abbreviated ("S:") form, with
// optional markdown decoration ("## S:", "**O:**"). Abbreviated headers must start
// a line; full-word headers may also appear inline when followed by a colon.
const SOAP_HEADER_RE = /^[ \t]*(?:#{1,6}[ \t]*)?\**[ \t]*(Subjective|Objective|Assessment|Plan|S|O|A|P)[ \t]*\**[ \t]*(?::|$)\**|\b(Subjective|Objective|Assessment|Plan)[ \t]*:/gim;

const SOAP_KEYS = { s: 'subjective', o: 'objective', a: 'assessment', p: 'plan' };

// HCPCS G-codes (G + 4 digits), CPT codes, and "code-like" 5-digit numbers next to
// billing words. Bare 5-digit numbers elsewhere (e.g. a ZIP) are ignored.
function findBillingCodes(text) {
  const str = String(text || '');
  const gcodes = str.match(/\bG\d{4}\b/g) || [];
  const labelled = [...str.matchAll(/\b(?:CPT|HCPCS|G-?codes?|codes?|billing)\b[^\n.]{0,40}?\b(\d{5})\b/gi)].map(m => m[1]);
  const listed = [...str.matchAll(/\b(\d{5})\s*[-:]\s*[A-Z][a-z]+/g)].map(m => m[1]);
  return [...gcodes, ...labelled, ...listed];
}

function parseSOAP(text) {
  const source = String(text || '');
  const headers = [];
  for (const match of source.matchAll(SOAP_HEADER_RE)) {
    const label = match[1] || match[2];
    headers.push({ key: SOAP_KEYS[label[0].toLowerCase()], start: match.index, end: match.index + match[0].length });
  }
  const sections = {};
  headers.forEach((header, i) => {
    if (header.key in sections) return;
    const next = headers[i + 1];
    sections[header.key] = source.slice(header.end, next ? next.start : source.length).trim();
  });
  return sections;
}

function validateClinicalContent(text, noteType, targetEHR, sourceNotes) {
  const issues = [];
  const warnings = [];

  const sections = parseSOAP(text);
  if (!('subjective' in sections)) issues.push('Missing Subjective section');
  if (!('objective' in sections)) issues.push('Missing Objective section');
  if (!('assessment' in sections)) issues.push('Missing Assessment section');
  if (!('plan' in sections)) issues.push('Missing Plan section');

  // A missing assist level is a warning, not a retry trigger: if the raw notes
  // don't contain one, regenerating can only fabricate it.
  const hasAssistLevel = ASSIST_LEVELS.some(({ pattern }) => pattern.test(text));
  if (!hasAssistLevel) warnings.push('No assistance level documented');

  if (sourceNotes) {
    const source = String(sourceNotes);
    const invented = findBillingCodes(text).filter(code => !source.includes(code));
    if (invented.length > 0) {
      issues.push(`Remove billing codes not present in the raw notes: ${[...new Set(invented)].join(', ')}`);
    }
  }

  if (/\b[0-5][+-]?\/5\s*(?:°|deg)/i.test(text)) {
    issues.push('MMT grade written with degrees; use x/5 for strength and degrees for ROM');
  }

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
    if (!/Section GG|self-care|mobility/i.test(text)) {
      warnings.push('TherapyBOSS notes should reference Section GG functional abilities');
    }
    if (!/goal|objective|target/i.test(text)) {
      warnings.push('Section GG requires documented functional goals');
    }
    if (!/assist|supervision|independent|contact guard|standby/i.test(text)) {
      warnings.push('Section GG requires assistance level documentation');
    }
  }

  if (targetEHR === 'kinnser') {
    if (!sections.assessment && !sections.plan && !/intake|discharge/i.test(text)) {
      warnings.push('Kinnser notes should follow intake/assessment/plan structure');
    }
  }

  if ((targetEHR === 'kinnser' || targetEHR === 'therapyboss') && !/skin|integrity|wound|ulcer|breakdown|pressure injur/i.test(text)) {
    warnings.push('Skin integrity not documented (OASIS integumentary items); add only if assessed');
  }

  return { valid: issues.length === 0, issues, warnings };
}

function buildRetryPrompt(originalPrompt, validation) {
  // Only structural issues are fed back. Content warnings (missing skin, goals, etc.)
  // are not, because asking the model to "add" them invites fabricated findings.
  return `${originalPrompt}\n\nIMPORTANT CORRECTIONS NEEDED:\nFix these issues: ${validation.issues.join('; ')}\n\nRegenerate the complete SOAP note. Use only information present in the raw notes; if a section has no supporting data, write "Not documented this session." under its header.`;
}

async function generateWithRetry(systemPrompt, userPrompt, noteType, targetEHR, env, sourceNotes) {
  const groqKey = env.GROQ_API_KEY;
  const openrouterKey = env.OPENROUTER_API_KEY;

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

async function callGroq(systemPrompt, userPrompt, apiKey, model) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 2048
  };
  // gpt-oss models spend output tokens on reasoning; keep it short for latency.
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Groq ${response.status}: ${(await response.text()).slice(0, 200)}`);
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
      temperature: 0.3,
      max_tokens: 1024
    })
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

function formatForEHR(structured, targetEHR) {
  if (targetEHR === 'therapyboss') return formatTherapyBOSS(structured);
  if (targetEHR === 'kinnser') return formatKinnser(structured);
  throw new Error(`Unsupported EHR: ${targetEHR}`);
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
      intact: data.skin_integrity?.intact ?? null,
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
      intact: data.skin_integrity?.intact ?? null,
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

async function handleApiRequest(request, env, ctx) {
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

  const auth = await authenticateRequest(request, env);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error }, 401);
  }

  const rateLimit = await checkRateLimit(auth.key, auth.tier, env);
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

    const structured = extractStructuredData(result.note, note_type);
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
