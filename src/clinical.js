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
    noteTypeRules = 'INITIAL EVALUATION: Document OBSERVATIONS ONLY. Include baseline ROM (degrees), MMT grades (0-5 scale), balance scores, assistance levels for each activity. Document safety: hand placements, time to complete tasks (minutes), number of attempts, and verbal/visual/tactile cues provided. Do NOT document progress. If the raw notes state goals, write them as target assistance levels; do not create goals.';
  } else if (noteType === 'treatment') {
    noteTypeRules = 'TREATMENT/RE-EVAL: Document progress only where the raw notes describe it. Compare assistance levels (e.g., "Improved from Mod A to Standby Assist") only when the raw notes give both levels. Note measurement changes (ROM, MMT) only when the raw notes give both values. Do not create goals.';
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
    const rawFacts = extractFacts(sourceNotes).facts;
    const grounded = (type, value, site) => isGrounded({ readings: [{ type, value, site }] }, rawFacts);
    structured.functional_abilities.rom_measurements = structured.functional_abilities.rom_measurements.filter(m => {
      const site = { side: m.side, joint: m.joint, motion: siteIn(m.movement).motion, mode: m.type };
      return grounded('rom', Math.abs(m.degrees), site) && (m.start_degrees === null || grounded('rom', Math.abs(m.start_degrees), site));
    });
    structured.functional_abilities.strength_grades = structured.functional_abilities.strength_grades.filter(m => {
      const site = { ...siteIn(m.muscle_group || ''), side: m.side, mode: null };
      return grounded('mmt', m.label, site);
    });
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

// A further measurement of the same motion, e.g. the ", PROM 0-150" in
// "R shoulder flexion AROM 0-120, PROM 0-150".
const ROM_CONTINUATION_RE = /\s*[,;/]?\s*(?:and\s+)?\(?(AROM|PROM|AAROM)\)?[:\s]*(?:(-?\d{1,3})\s*(?:-|–|to)\s*)?(-?\d{1,3})(?![\d.]|\s*[+-]?\s*\/\s*5)\s*(°|deg(?:rees)?\b)?/iy;

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
    const site = {
      side: normalizeSide(side),
      joint: joint ? joint.toLowerCase() : null,
      movement: movement.toLowerCase()
    };
    results.push({
      ...site,
      type: type ? type.toUpperCase() : null,
      start_degrees: from !== undefined ? parseInt(from, 10) : null,
      degrees
    });
    ROM_CONTINUATION_RE.lastIndex = m.index + m[0].length;
    let next;
    while ((next = ROM_CONTINUATION_RE.exec(m.input)) !== null) {
      const [, nextType, nextFrom, nextTo] = next;
      if (Math.abs(parseInt(nextTo, 10)) <= 180) {
        results.push({
          ...site,
          type: nextType.toUpperCase(),
          start_degrees: nextFrom !== undefined ? parseInt(nextFrom, 10) : null,
          degrees: parseInt(nextTo, 10)
        });
      }
    }
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

// ---------------------------------------------------------------------------
// Grounding: every value in a generated note must match a value the clinician
// wrote FOR THE SAME MEASURE. "3 sets" is not grounded by "3/5" (an MMT grade),
// while "60 minutes" is grounded by "1 hour". Each value is read as a fact with
// one or more readings ({ type, value }); a reading is ambiguous only when the
// text itself is (e.g. "hip flex 90" may be degrees or reps).
// ---------------------------------------------------------------------------

const WORD_NUMS = Object.keys(NUMBER_WORDS).filter(w => !['once', 'twice', 'thrice', 'half'].includes(w)).join('|');
// A number written as digits (not part of an identifier like "C5" or "SpO2", but
// allowed after the "x" in "3x10") or as a word.
const N = String.raw`(?:(?<![A-WYZa-wyz\d.])\d+(?:\.\d+)?|\b(?:${WORD_NUMS})\b)`;
const TO = String.raw`\s*(?:-|–|to)\s*`;
const TIME_UNIT = String.raw`(seconds?|secs?|s|minutes?|mins?|hours?|hrs?|h|days?|weeks?|wks?|months?|mos?|years?|yrs?)\b`;
const DIST_UNIT = String.raw`(?:(feet|foot|ft|meters?|metres?|m|yards?|yds?|yd|km|miles?|mi|cm|inches|inch)\b|(['′]))`;
const MOTION_SHORT = String.raw`(?:flex(?:ion)?|ext(?:ension)?|abd(?:uction)?|add(?:uction)?|IR|ER|int(?:ernal)?\.?\s*rot(?:ation)?|ext(?:ernal)?\.?\s*rot(?:ation)?|rotation|sup(?:ination)?|pron(?:ation)?|DF|PF|dorsiflexion|plantar\s*flexion|plantarflexion|inv(?:ersion)?|ev(?:ersion)?|(?:radial|ulnar|rad|uln)\.?\s*dev(?:iation)?)`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Effort the patient performs is not a number the clinician wrote, so the
// prompt's own assist-level definitions ("Min A (patient 75%+)") are exempt.
const ASSIST_DEFINITION_RE = /\(\s*(?:patient\s*)?(?:<\s*)?\d{1,3}\s*%?\s*(?:-\s*\d{1,3}\s*)?%\s*\+?\s*\)/gi;
const GG_CODE_RE = /\b0([1-6])\s*[-–:]?\s*(?:Independent|Set-?up(?:\s*(?:or|\/)\s*clean-?up)?|Supervision(?:\s*(?:or|\/)\s*touching(?:\s*assistance)?)?|Partial\s*\/\s*moderate(?:\s*assistance)?|Substantial\s*\/\s*maximal(?:\s*assistance)?|Dependent)/gi;

// Assist levels as a clinician or model would write them. Stricter than
// ASSIST_LEVELS so "5 min ambulation" is not read as "Min A".
const ASSIST_GROUNDING = [
  { level: 'Total Assist', pattern: /\b(?:total(?:ly)?\.?\s*(?:a\b|assist\w*)|dependent)\b/gi },
  { level: 'Max A', pattern: /\bmax(?:imal|imum)?\.?\s*(?:a\b|assist\w*)/gi },
  { level: 'Mod A', pattern: /\bmod(?:erate)?\.?\s*(?:a\b|assist\w*)/gi },
  { level: 'Min A', pattern: /\bmin(?:imal|imum)?\.?\s*(?:a\b|assist\w*)/gi },
  { level: 'Contact Guard Assist', pattern: /\b(?:contact\s*guard\w*|CGA)\b/gi },
  { level: 'Standby Assist', pattern: /\b(?:stand\s*-?\s*by\s*(?:assist\w*)?|SBA)\b/gi },
  { level: 'Supervision', pattern: /\b(?:supervision|supervised)\b/gi },
  { level: 'Independent', pattern: /\b(?:independent(?:ly)?|indep|mod(?:ified)?\.?\s*(?:I|indep\w*))\b/gi }
];

// OASIS Section GG performance codes and the assist levels each one describes.
const GG_LEVELS = {
  6: ['Independent'],
  5: ['Independent', 'Supervision'],
  4: ['Supervision', 'Standby Assist', 'Contact Guard Assist'],
  3: ['Min A', 'Mod A'],
  2: ['Max A'],
  1: ['Total Assist']
};

const SECONDS = { s: 1, mi: 60, h: 3600, d: 86400, w: 604800, mo: 2629800, y: 31557600 };
function secondsPer(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('mo')) return SECONDS.mo;
  if (u.startsWith('mi')) return SECONDS.mi;
  return SECONDS[u[0]];
}

const FEET = { ft: 1, feet: 1, foot: 1, m: 3.28084, meter: 3.28084, metre: 3.28084, yd: 3, yard: 3, km: 3280.84, mi: 5280, mile: 5280, cm: 0.0328084, inch: 1 / 12, inche: 1 / 12 };
function feetPer(unit) {
  if (!unit) return 1; // ' or ′
  const u = unit.toLowerCase().replace(/s$/, '');
  return FEET[u];
}

function toNumber(text) {
  const t = String(text).trim().toLowerCase();
  return /\d/.test(t) ? parseFloat(t) : NUMBER_WORDS[t];
}

function romanToNumber(text) {
  const t = text.toUpperCase();
  return { I: 1, II: 2, III: 3, IV: 4 }[t] ?? parseInt(t, 10);
}

function normalizePeriod(text) {
  const t = text.toLowerCase();
  if (t.startsWith('d')) return 'day';
  if (t.startsWith('w')) return 'week';
  return 'month';
}

function isCalendarDate(month, day) {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function normalizeYear(year) {
  if (year === undefined) return undefined;
  const y = parseInt(year, 10);
  return y < 100 ? 2000 + y : y;
}

// Body site of an ROM or MMT value: side, joint, motion and (ROM only) AROM/PROM.
// Clinicians write "R hip flex 90 deg, abd 30 deg", so side and joint carry over
// within a sentence, while the motion and mode are the last ones before the value.
const SITE_SIDE_RE = /\b(right|left|bilateral|bilat|R|L|B)\b/gi;
const SITE_JOINT_RE = /\b(shoulder|elbow|wrist|forearm|hand|hip|knee|ankle|cervical|lumbar|trunk|thumb|finger|digit)s?\b/gi;
const SITE_MOTIONS = [
  ['plantarflexion', String.raw`plantar\s*flex(?:ion)?|plantarflexion|PF`],
  ['dorsiflexion', String.raw`dorsi\s*flex(?:ion)?|DF`],
  ['internal rotation', String.raw`int(?:ernal)?\.?\s*rot(?:ation)?|IR`],
  ['external rotation', String.raw`ext(?:ernal)?\.?\s*rot(?:ation)?|ER`],
  ['radial deviation', String.raw`rad(?:ial)?\.?\s*dev(?:iation)?`],
  ['ulnar deviation', String.raw`uln(?:ar)?\.?\s*dev(?:iation)?`],
  ['flexion', String.raw`flex(?:ion|ors?)?`],
  ['extension', String.raw`ext(?:ension|ensors?)?`],
  ['abduction', String.raw`abd(?:uction|uctors?)?`],
  ['adduction', String.raw`add(?:uction|uctors?)?`],
  ['supination', String.raw`sup(?:ination|inators?)?`],
  ['pronation', String.raw`pron(?:ation|ators?)?`],
  ['inversion', String.raw`inv(?:ersion)?`],
  ['eversion', String.raw`ev(?:ersion)?`],
  ['rotation', 'rotation'],
  ['grip', 'grip'],
  ['pinch', 'pinch']
];
const SITE_MOTION_RE = new RegExp(SITE_MOTIONS.map(([, re]) => String.raw`\b(${re})\b`).join('|'), 'gi');
const SITE_MODE_RE = /\b(AAROM|AROM|PROM)\b/gi;
const SITE_BOUNDARY_RE = /[.;\n](?!\d)/g;

function lastMatch(re, text) {
  let last = null;
  for (const m of text.matchAll(re)) last = m;
  return last;
}

function siteIn(text) {
  const side = lastMatch(SITE_SIDE_RE, text);
  const joint = lastMatch(SITE_JOINT_RE, text);
  const motion = lastMatch(SITE_MOTION_RE, text);
  // AROM/PROM only applies when it comes after the motion it describes.
  const mode = lastMatch(SITE_MODE_RE, motion ? text.slice(motion.index) : text);
  return {
    side: side ? normalizeSide(side[1]) : null,
    joint: joint ? joint[1].toLowerCase() : null,
    motion: motion ? SITE_MOTIONS[motion.slice(1).findIndex(Boolean)][0] : null,
    mode: mode ? mode[1].toUpperCase() : null
  };
}

function siteAt(original, valueStart, matchEnd) {
  let sentenceStart = 0;
  for (const b of original.slice(0, valueStart).matchAll(SITE_BOUNDARY_RE)) sentenceStart = b.index + 1;
  const site = siteIn(original.slice(sentenceStart, valueStart));
  // "90 degrees of R hip flexion": the site follows the value.
  const after = original.slice(matchEnd).match(/^\s*(?:of|in|for|at)\s+([^,.;\n]{0,40})/i);
  if (after) {
    const following = siteIn(after[1]);
    for (const key of Object.keys(site)) site[key] = site[key] || following[key];
  }
  return site;
}

function sameSite(a, b) {
  if (!a || !b) return true;
  return Object.keys(a).every(key => {
    if (!a[key] || !b[key] || a[key] === b[key]) return true;
    // Plain "rotation" is compatible with internal or external rotation.
    return key === 'motion' && [a[key], b[key]].includes('rotation') && /rotation/.test(a[key] + b[key]);
  });
}

// Reads every value in `text` with what it measures. Patterns run from most to
// least specific, and each match is blanked out so later patterns skip it.
// A bare number word ("stood on one leg") is only a value in the raw notes;
// in a generated note it needs a unit ("two weeks") to count.
function extractFacts(text, { bareWords = true } = {}) {
  const original = String(text || '');
  let buf = original;
  const facts = [];
  const gg = [];

  const scan = (re, toFacts) => {
    buf = buf.replace(re, (...args) => {
      const match = args[0];
      const offset = args[args.length - 2];
      const produced = toFacts(args.slice(1, -2), match, offset);
      if (produced === null) return match; // not a value after all; leave for later patterns
      for (const fact of [].concat(produced)) facts.push({ text: match.trim(), ...fact });
      return ' '.repeat(match.length);
    });
  };
  const blank = re => { buf = buf.replace(re, m => ' '.repeat(m.length)); };
  const one = (type, value) => ({ readings: [{ type, value }] });
  const at = (match, offset) => siteAt(original, offset + Math.max(0, match.search(/-?\d/)), offset + match.length);
  const rom = (value, site) => ({ readings: [{ type: 'rom', value: Math.abs(toNumber(value)), site }] });

  blank(ASSIST_DEFINITION_RE);
  buf = buf.replace(GG_CODE_RE, (m, code) => { gg.push({ text: m.trim(), code: parseInt(code, 10) }); return ' '.repeat(m.length); });

  // Dates with a year: 9/12/2026, 9-12-26
  scan(/(?<![\d/.-])(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?![\d/])/g, ([m, d, y]) => {
    const month = parseInt(m, 10), day = parseInt(d, 10);
    return isCalendarDate(month, day) ? one('date', { month, day, year: normalizeYear(y) }) : null;
  });
  // Dates with a month name: Sept 12, September 12th, 2026
  scan(new RegExp(String.raw`\b(${MONTHS.join('|')})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4})\b)?`, 'gi'), ([mon, d, y]) => {
    const month = MONTHS.indexOf(mon.toLowerCase().slice(0, 3)) + 1, day = parseInt(d, 10);
    return isCalendarDate(month, day) ? one('date', { month, day, year: normalizeYear(y) }) : null;
  });

  // MMT grades: 3/5, 4-/5, 3+ / 5, "four out of five"
  scan(/(?<![\d/.])([0-5])\s*([+-])?\s*\/\s*5(?![\d/])/g, ([grade, mod], match, offset) => {
    // Always a grade, never a date: reading "2/5" as Feb 5 would let a grade
    // moved to another muscle through as a "date".
    return { readings: [{ type: 'mmt', value: `${grade}${mod || ''}/5`, site: at(match, offset) }] };
  });
  scan(new RegExp(String.raw`(${N})\s*out\s*of\s*(?:5|five)\b`, 'gi'), ([g], match, offset) => {
    const grade = toNumber(g);
    return grade <= 5 ? { readings: [{ type: 'mmt', value: `${grade}/5`, site: at(match, offset) }] } : null;
  });

  // Pain and other 0-10 scores: 4/10, "four out of ten"
  scan(/(?<![\d/.])(\d{1,2}(?:\.\d)?)\s*\/\s*10(?![\d/])/g, ([score]) => {
    const value = parseFloat(score);
    if (value > 10) return null;
    const readings = [{ type: 'pain', value }];
    if (isCalendarDate(value, 10)) readings.push({ type: 'date', value: { month: value, day: 10 } });
    return { readings };
  });
  scan(new RegExp(String.raw`(${N})\s*out\s*of\s*(?:10|ten)\b`, 'gi'), ([score]) => one('pain', toNumber(score)));

  // Frequency: 2x/day, 3 times per week, 2x daily, twice a day, BID
  scan(new RegExp(String.raw`(${N})\s*(?:x|×|times?)\s*(?:\/|per|a|an|each|every)?\s*(days?|d|weeks?|wks?|months?|mos?)\b`, 'gi'),
    ([n, period]) => one('frequency', `${toNumber(n)}/${normalizePeriod(period)}`));
  scan(new RegExp(String.raw`(${N})\s*(?:x|×|times?)\s*(daily|weekly|monthly)\b`, 'gi'),
    ([n, period]) => one('frequency', `${toNumber(n)}/${normalizePeriod(period)}`));
  scan(/\b(once|twice|thrice)\s*(?:a|an|per|each|every|\/)?\s*(daily|weekly|monthly|days?|weeks?|wks?|months?)\b/gi,
    ([n, period]) => one('frequency', `${NUMBER_WORDS[n.toLowerCase()]}/${normalizePeriod(period)}`));
  scan(/\b(QD|BID|TID|QID)\b/g, ([abbr]) => one('frequency', `${{ QD: 1, BID: 2, TID: 3, QID: 4 }[abbr]}/day`));

  // Age: 72yo, 72 y/o, 72-year-old
  scan(new RegExp(String.raw`(${N})\s*-?\s*(?:yo\b|y\/o\b|y\.o\.?|(?:years?|yrs?)[\s-]*old\b)`, 'gi'), ([n]) => one('age', toNumber(n)));

  // ROM in degrees: 90 deg, 0-85°, -10 degrees
  scan(new RegExp(String.raw`(-?${N})(?:${TO}(-?${N}))?\s*(?:°|degrees?\b|degs?\b)`, 'gi'),
    ([a, b], match, offset) => [a, b].filter(v => v !== undefined).map(v => rom(v, at(match, offset))));
  // ROM tagged by AROM/PROM/ROM: "PROM 0-140", "AROM: 85"
  scan(new RegExp(String.raw`\b(?:AA|A|P)?ROM\b[:\s]*(?:of\s*|is\s*|=\s*)?(-?${N})(?:${TO}(-?${N}))?(?!\s*[+-]?\s*\/)`, 'gi'),
    ([a, b], match, offset) => [a, b].filter(v => v !== undefined).map(v => rom(v, at(match, offset))));

  // Sets x reps: 3x10, 3 sets of 10 reps, 3 x 30 sec, 2 x 150 ft
  scan(new RegExp(String.raw`(${N})\s*(sets?\s*(?:of|x|×)?|x|×)\s*(${N})\s*(?:(reps?|repetitions?)\b|${TIME_UNIT}|${DIST_UNIT})?`, 'gi'),
    ([s, sep, r, , timeUnit, distUnit, distMark]) => {
      const setsText = /set/i.test(sep) ? `${s} sets` : `${s} x`;
      const sets = { text: setsText, readings: [{ type: 'sets', value: toNumber(s) }] };
      if (timeUnit) return [sets, { text: `${r} ${timeUnit}`, ...one('time', toNumber(r) * secondsPer(timeUnit)) }];
      if (distUnit || distMark) return [sets, { text: `${r} ${distUnit || distMark}`, ...one('distance', toNumber(r) * feetPer(distUnit)) }];
      return [sets, { text: `${r} reps`, ...one('reps', toNumber(r)) }];
    });
  scan(new RegExp(String.raw`(${N})\s*sets?\b`, 'gi'), ([n]) => one('sets', toNumber(n)));
  scan(new RegExp(String.raw`(${N})(?:${TO}(${N}))?\s*(?:reps?|repetitions?)\b`, 'gi'),
    ([a, b]) => [a, b].filter(v => v !== undefined).map(v => one('reps', toNumber(v))));

  // Distance: 10 ft, 150 feet, 45 m, 10'
  scan(new RegExp(String.raw`(${N})(?:${TO}(${N}))?\s*-?\s*${DIST_UNIT}`, 'gi'),
    ([a, b, unit]) => [a, b].filter(v => v !== undefined).map(v => one('distance', toNumber(v) * feetPer(unit))));

  // Time: 12 min, 1 hour, 30 sec, 2 days, 4 weeks, half an hour
  scan(/\bhalf\s+an?\s+hour\b/gi, () => one('time', 1800));
  scan(/\ban\s+hour\b/gi, () => one('time', 3600));
  scan(new RegExp(String.raw`(${N})(?:${TO}(${N}))?\s*-?\s*${TIME_UNIT}`, 'gi'),
    ([a, b, unit]) => [a, b].filter(v => v !== undefined).map(v => one('time', toNumber(v) * secondsPer(unit))));

  scan(new RegExp(String.raw`(${N})\s*(?:%|percent\b)`, 'gi'), ([n]) => one('percent', toNumber(n)));

  // Counts: 2 attempts, 3 trials, 12 steps, x3, 2x
  scan(new RegExp(String.raw`(${N})\s*(?:attempts?|trials?|times|bouts?|rounds?|laps?|steps?|stairs?|episodes?|cues?|VCs?|TCs?|LOBs?|falls?|(?:rest\s*)?breaks?)\b`, 'gi'),
    ([n]) => one('count', toNumber(n)));
  scan(/(?<![A-Za-z\d])[x×]\s*(\d+)\b/gi, ([n]) => ({ readings: ['count', 'reps', 'sets'].map(type => ({ type, value: toNumber(n) })) }));
  scan(/(?<![A-Za-z\d.])(\d+)\s*x\b/gi, ([n]) => one('count', toNumber(n)));
  scan(/(?<![A-Za-z\d.])(\d+)(?:st|nd|rd|th)\b/gi, ([n]) => ({ readings: ['count', 'other'].map(type => ({ type, value: toNumber(n) })) }));

  // Motion followed by a bare number: "hip flex 90" may be degrees or reps.
  scan(new RegExp(String.raw`\b${MOTION_SHORT}\b[:\s]*(-?${N})(?:${TO}(-?${N}))?(?!\s*(?:[+-]?\s*\/|[x×]\b|\d))`, 'gi'),
    ([a, b], match, offset) => [a, b].filter(v => v !== undefined).map(v => {
      const value = toNumber(v);
      return { readings: [{ type: 'rom', value: Math.abs(value), site: at(match, offset) },{ type: 'reps', value }, { type: 'other', value }] };
    }));

  // Severity grades and stages: "Grade I sprain", "Stage 2 pressure injury"
  scan(/\b(stage|grade)\s+(IV|I{1,3}|[0-4])\b(?!\s*[+-]?\s*\/)/gi, ([kind, level]) => one(kind.toLowerCase(), romanToNumber(level)));

  // Identifiers such as spinal levels (C5, L4-L5) must appear verbatim.
  scan(/\b[A-Za-z]+\d[A-Za-z\d]*\b/g, (_, match) => /^(?:sp)?o2$/i.test(match) ? [] : one('identifier', match.toLowerCase()));

  // Remaining "a/b": a date (9/12) or a ratio such as blood pressure (120/80).
  scan(/(?<![\d/.])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d/])/g, ([a, b], match) => {
    const month = parseInt(a, 10), day = parseInt(b, 10);
    if (isCalendarDate(month, day)) return one('date', { month, day });
    return one('ratio', match.replace(/\s/g, ''));
  });

  // Bare numbers. "pain 4" is a pain score; anything else is an unlabelled value.
  scan(new RegExp(String.raw`(-?${N})`, 'gi'), ([n], match, offset) => {
    const value = toNumber(n);
    if (value === undefined || Number.isNaN(value) || (!bareWords && !/\d/.test(n))) return null;
    const before = original.slice(Math.max(0, offset - 30), offset);
    const readings = [{ type: 'other', value: Math.abs(value) }];
    if (/pain[^.\n\d]{0,20}$/i.test(before)) readings.push({ type: 'pain', value: Math.abs(value) });
    return { readings };
  });

  const assist = [];
  for (const { level, pattern } of ASSIST_GROUNDING) {
    for (const m of buf.matchAll(pattern)) assist.push({ text: m[0].trim(), level });
  }

  return { facts, gg, assist };
}

// Which reading types in the raw notes can ground a reading of a given type in the
// note. Counts are interchangeable with unlabelled numbers, but sets, reps, MMT,
// ROM, time, etc. must match their own kind.
const COMPATIBLE = {
  other: ['other', 'count', 'sets', 'reps'],
  count: ['count', 'other', 'reps'],
  sets: ['sets', 'other'],
  reps: ['reps', 'other']
};

function sameValue(type, a, b) {
  if (type === 'date') {
    return a.month === b.month && a.day === b.day && (a.year === undefined || a.year === b.year);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    // Unit conversions (ft <-> m) round, so allow 3% for distance; others are exact.
    if (type === 'distance') return Math.abs(a - b) <= 0.03 * Math.max(a, b);
    return Math.abs(a - b) < 1e-6;
  }
  return a === b;
}

function isGrounded(noteFact, rawFacts) {
  return noteFact.readings.some(reading => {
    const accepted = COMPATIBLE[reading.type] || [reading.type];
    return rawFacts.some(raw => raw.readings.some(r => accepted.includes(r.type)
      && sameValue(reading.type, reading.value, r.value)
      && sameSite(reading.site, r.site)));
  });
}

// Every measurement, count, grade, score, date and assist level in a generated
// note must come from the clinician's raw notes, used for the same measure.
// Returns the note text of each value that isn't, so the retry prompt can name it.
// Values the prompt itself supplies are exempt: the assist-level percentage
// definitions and OASIS Section GG codes that match a documented assist level.
function findUngroundedValues(noteText, sourceNotes) {
  const raw = extractFacts(sourceNotes);
  const note = extractFacts(noteText, { bareWords: false });
  const ungrounded = [];
  for (const fact of note.facts) {
    if (!isGrounded(fact, raw.facts)) ungrounded.push(fact.text);
  }
  const rawLevels = new Set(raw.assist.map(a => a.level));
  for (const { text, level } of note.assist) {
    if (!rawLevels.has(level)) ungrounded.push(text);
  }
  for (const { text, code } of note.gg) {
    if (!GG_LEVELS[code].some(level => rawLevels.has(level))) ungrounded.push(text);
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
