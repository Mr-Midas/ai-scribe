// Clinical logic for Note Scribe AI: prompt construction, SOAP parsing,
// structured extraction, validation and EHR formatting. Pure functions with no
// network or Cloudflare dependencies, so they can be unit tested in Node.

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
    'Convert occupational and physical therapy shorthand notes to SOAP format.',
    'Plain text only. No markdown or placeholders.',
    'Always use exactly these four headers, each on its own line: "Subjective:", "Objective:", "Assessment:", "Plan:".',
    'Never invent findings, measurements, scores or codes. If a section has no supporting data, write "Not documented this session." under its header.',
    'Use skilled language: "Therapist facilitated...", "Instructed patient in...", "Tactile cues required for..."',
    'Include sets, reps, distances, times and assistance levels exactly as written in the raw notes. If a value is not given, do not estimate it.',
    'Relate interventions to the functional goals stated in the raw notes. Do not create goals, timeframes, visit frequencies or diagnoses that are not stated.',
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

function extractStructuredData(noteText, noteType, sourceNotes) {
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

  const activityMatches = noteText.match(/(?:Instructed|Facilitated|Trained|Performed|Educated|Taught|Progressed)\s+([^.]+)/gi) || [];
  structured.functional_abilities.activities = activityMatches.map(a => a.trim());

  structured.functional_abilities.rom_measurements = extractROM(noteText);
  structured.functional_abilities.strength_grades = extractMMT(noteText);
  if (sourceNotes) {
    // Structured fields go straight into EHR records, so a measurement the model
    // added on its own is dropped here even if it slipped past validation.
    const grounded = numbersIn(sourceNotes);
    structured.functional_abilities.rom_measurements = structured.functional_abilities.rom_measurements
      .filter(m => grounded.has(String(m.degrees)) && (m.start_degrees === null || grounded.has(String(m.start_degrees))));
    structured.functional_abilities.strength_grades = structured.functional_abilities.strength_grades
      .filter(m => grounded.has(String(m.grade)));
  }

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
// a line and need a colon or bold ("**P**"), so a line reading just "a" is content;
// full-word headers may also appear inline when followed by a colon.
const SOAP_HEADER_RE = /^[ \t]*(?:#{1,6}[ \t]*)?\**[ \t]*(?:(Subjective|Objective|Assessment|Plan)[ \t]*\**[ \t]*(?::|$)|([SOAP])[ \t]*(?::|\*\*[ \t]*:?[ \t]*$))\**|\b(Subjective|Objective|Assessment|Plan)[ \t]*:/gim;

const SOAP_KEYS = { s: 'subjective', o: 'objective', a: 'assessment', p: 'plan' };

// HCPCS G-codes (G + 4 digits), CPT codes, and "code-like" 5-digit numbers next to
// billing words. Bare 5-digit numbers elsewhere (e.g. a ZIP) are ignored.
function findBillingCodes(text) {
  const str = String(text || '');
  const gcodes = str.match(/\bG\d{4}\b/g) || [];
  const labelled = [...str.matchAll(/\b(?:CPT|HCPCS|G-?codes?|codes?|billing)\b[^\n]{0,120}/gi)]
    .flatMap(m => m[0].match(/\b\d{5}\b/g) || []);
  const listed = [...str.matchAll(/\b(\d{5})\s*[-:]\s*[A-Z][a-z]+/g)].map(m => m[1]);
  return [...gcodes, ...labelled, ...listed];
}

const NUMBER_WORDS = {
  once: 1, twice: 2, thrice: 3, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100, half: 0.5
};

function numbersIn(text) {
  const values = new Set();
  const str = String(text || '').toLowerCase();
  for (const m of str.matchAll(/\d+(?:\.\d+)?/g)) values.add(String(parseFloat(m[0])));
  for (const m of str.matchAll(/\b[a-z]+\b/g)) {
    if (m[0] in NUMBER_WORDS) values.add(String(NUMBER_WORDS[m[0]]));
  }
  return values;
}

// Every measurement, count, grade, score or date in a generated note must come from
// the clinician's raw notes. Returns the values that don't, with their unit, so the
// retry prompt can name them. Numbers the prompt itself supplies are exempt: the
// assist-level percentage definitions, the "/5" and "/10" scale denominators, and
// OASIS Section GG codes (01-06).
function findUngroundedValues(noteText, sourceNotes) {
  const grounded = numbersIn(sourceNotes);
  const note = String(noteText || '')
    .replace(/\(\s*(?:patient\s*)?(?:<\s*)?\d{1,3}\s*%?\s*(?:-\s*\d{1,3}\s*)?%\s*\+?\s*\)/gi, '')
    .replace(/\b0[1-6]\b(?=\s*[-–:]?\s*(?:Independent|Setup|Supervision|Partial|Substantial|Dependent))/gi, '');
  const ungrounded = [];
  // The optional suffix keeps "4-/5" or "3/10" together, so the scale denominator is
  // never checked on its own and the retry prompt names the full value.
  for (const m of note.matchAll(/(\d+(?:\.\d+)?)([+-]?\s*\/\s*(?:5|10)\b|\s*(?:%|°|[a-z]+))?/gi)) {
    if (!grounded.has(String(parseFloat(m[1])))) ungrounded.push(`${m[1]}${m[2] || ''}`.trim());
  }
  // Severity grades and stages ("Grade I sprain", "Stage 2") are clinical
  // judgements the model must not add on its own.
  const source = String(sourceNotes || '').toLowerCase();
  for (const m of note.matchAll(/\b(grade|stage)\s+(I{1,3}V?|IV|[0-4])\b/gi)) {
    if (!source.includes(m[1].toLowerCase())) ungrounded.push(m[0]);
  }
  return [...new Set(ungrounded)];
}

function parseSOAP(text) {
  const source = String(text || '');
  const headers = [];
  for (const match of source.matchAll(SOAP_HEADER_RE)) {
    const label = match[1] || match[2] || match[3];
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
    const invented = [...new Set(findBillingCodes(text).filter(code => !source.includes(code)))];
    if (invented.length > 0) {
      issues.push(`Remove billing codes not present in the raw notes: ${invented.join(', ')}`);
    }
    const ungrounded = findUngroundedValues(text, source).filter(v => !invented.some(code => v.startsWith(code)));
    if (ungrounded.length > 0) {
      issues.push(`Remove values not present in the raw notes (do not estimate or invent): ${ungrounded.join(', ')}`);
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

export {
  ASSIST_LEVELS,
  buildSystemPrompt,
  extractStructuredData,
  extractROM,
  extractMMT,
  findBillingCodes,
  findUngroundedValues,
  parseSOAP,
  validateClinicalContent,
  buildRetryPrompt,
  formatForEHR
};
