// Payer documentation checklists. Each requirement is checked against the
// clinician's RAW notes (not the AI's rewrite, whose skilled-sounding wording
// proves nothing about what the clinician documented). Results are reminders for
// the clinician: they are never sent back to the model, because asking it to
// "add" a missing requirement is how fabricated documentation happens.
//
// These rules were drafted from CMS manuals and have NOT yet been verified by a
// billing or compliance professional. Update REVIEW whenever someone qualified
// checks them against the current manuals.
import { extractFacts } from './clinical.js';

const REVIEW = {
  last_reviewed: '2026-10-02',
  verified_by_expert: false,
  disclaimer: 'Documentation reminders only, not a coverage or billing determination. Rules change; verify with your agency\'s billing or compliance team.'
};

const MEASURE_TYPES = new Set(['rom', 'mmt', 'distance', 'time', 'reps', 'sets', 'count', 'pain', 'percent', 'frequency']);
const ASSIST_RE = /\b(?:independent|indep|mod(?:ified)?\.?\s*I|supervision|SBA|stand\s*-?\s*by|CGA|contact\s*guard|min(?:imal|imum)?\.?\s*(?:a\b|assist)|mod(?:erate)?\.?\s*(?:a\b|assist)|max(?:imal|imum)?\.?\s*(?:a\b|assist)|total(?:ly)?\.?\s*(?:a\b|assist)|dependent)/i;

function hasObjectiveMeasure(raw) {
  if (ASSIST_RE.test(raw)) return true;
  return extractFacts(raw).facts.some(f => f.readings.some(r => MEASURE_TYPES.has(r.type)));
}

const HH_SOURCE = {
  homebound: 'Medicare Benefit Policy Manual (Pub. 100-02), Ch. 7, §30.1.1; 42 CFR 409.42(a)',
  skilled: 'Medicare Benefit Policy Manual (Pub. 100-02), Ch. 7, §40.2; 42 CFR 409.44(c)',
  documentation: 'Medicare Benefit Policy Manual (Pub. 100-02), Ch. 7, §40.2.1',
  planOfCare: 'Medicare Benefit Policy Manual (Pub. 100-02), Ch. 7, §30.2; 42 CFR 484.60(a)',
  claims: 'Medicare Claims Processing Manual (Pub. 100-04), Ch. 10'
};

// status: 'found' | 'missing' | 'reminder'
const MEDICARE_HOME_HEALTH = [
  {
    id: 'homebound',
    requirement: 'Homebound status',
    hint: 'Say why leaving home takes a considerable and taxing effort (for example, needs a walker and assistance to leave home).',
    source: HH_SOURCE.homebound,
    found: raw => /\bhome\s*-?\s*bound\b|confined to (?:the )?home|taxing effort|(?:unable|difficult\w*) to leave (?:the )?home|leav(?:e|ing) (?:the )?home|(?:assist\w*|help|device|w\/c|wheelchair)\s+to\s+leave/i.test(raw)
  },
  {
    id: 'skilled_need',
    requirement: 'Skilled service provided',
    hint: 'Describe what you did that needed a therapist\'s skills: instruction, training, cueing, assessment, or adjusting the treatment.',
    source: HH_SOURCE.skilled,
    found: raw => /\b(?:instruct|train|educat|taught|teach|facilitat|cue|cues|cueing|VCs?|TCs?|assess|evaluat|progress(?:ed|ion)|modif|adjust|graded|adapt|recommend|HEP)\w*/i.test(raw)
  },
  {
    id: 'objective_measures',
    requirement: 'Objective measurement of function',
    hint: 'Include at least one measurement: assistance level, distance, time, repetitions, ROM, strength or a test score.',
    source: HH_SOURCE.documentation,
    found: raw => hasObjectiveMeasure(raw)
  },
  {
    id: 'patient_response',
    requirement: 'Patient\'s response to treatment',
    hint: 'Note how the patient tolerated or responded to treatment (for example, tolerated well, fatigued after 10 minutes, pain increased).',
    source: HH_SOURCE.documentation,
    found: raw => /\b(?:toler\w*|respon\w*|fatigu\w*|tired|SOB|short(?:ness)? of breath|c\/o|complain\w*|reports?|reported|states?|stated|denie[sd]|pain|vitals|HR|BP|O2|sats?|dizz\w*|improv\w*|declin\w*)\b/i.test(raw)
  },
  {
    id: 'goals',
    requirement: 'Functional goals and progress toward them',
    hint: 'Name the functional goal this visit works toward, and progress made, in your own words.',
    source: HH_SOURCE.documentation,
    found: raw => /\bgoals?\b|\b[LS]TGs?\b|\btoward\b|progress\w*\s+(?:to|toward)|\bin order to\b|\bto (?:improve|increase|return|be able|enable|allow|safely)\b|\bfor (?:safe|independen)\w*/i.test(raw)
  },
  {
    id: 'frequency_duration',
    requirement: 'Plan of care: visit frequency and duration',
    hint: 'State how often and for how long (for example, 2w4 = twice a week for 4 weeks).',
    source: HH_SOURCE.planOfCare,
    noteTypes: ['initial-eval'],
    found: raw => (/\b\d+\s*w\s*\d+\b/i.test(raw))
      || (/\b\d+\s*(?:x|times)\s*(?:\/|per|a)?\s*(?:wk|week)\b|\bfreq(?:uency)?\b/i.test(raw)
        && /\bfor\s+\d+\s*(?:wks?|weeks?|months?)\b|\bx\s*\d+\s*(?:wks?|weeks?)\b|\bduration\b/i.test(raw))
  },
  {
    id: 'visit_length',
    requirement: 'Visit length',
    hint: 'Record time in and out, or total visit minutes. The visit length is reported on the home health claim.',
    source: HH_SOURCE.claims,
    found: raw => /\btime\s*(?:in|out)\b|\b\d{1,2}:\d{2}\b|\b(?:visit|session|tx|treatment)\b[^.\n]{0,20}?\b\d+\s*(?:min|mins|minutes|hrs?|hours?)\b|\b\d+\s*(?:min|mins|minutes|hrs?|hours?)\s+(?:visit|session|tx|treatment)\b/i.test(raw)
  },
  {
    id: 'reassessment_30_day',
    requirement: 'Functional reassessment at least every 30 days',
    hint: 'A therapist must reassess function at least once every 30 days, recording objective measurements compared with earlier ones. If this visit is that reassessment, include the measurements and the comparison.',
    source: HH_SOURCE.documentation,
    noteTypes: ['treatment'],
    reminder: true
  }
];

const CHECKLISTS = {
  'medicare-home-health': { name: 'Medicare home health', rules: MEDICARE_HOME_HEALTH }
};

const SUPPORTED_PAYERS = Object.keys(CHECKLISTS);

function checkReimbursement(rawNotes, noteType, payer) {
  const checklist = CHECKLISTS[payer];
  if (!checklist) return null;
  const raw = String(rawNotes || '');
  const items = checklist.rules
    .filter(rule => !rule.noteTypes || rule.noteTypes.includes(noteType))
    .map(rule => ({
      id: rule.id,
      requirement: rule.requirement,
      status: rule.reminder ? 'reminder' : (rule.found(raw) ? 'found' : 'missing'),
      hint: rule.hint,
      source: rule.source
    }));
  return { payer, payer_name: checklist.name, ...REVIEW, items };
}

export { checkReimbursement, SUPPORTED_PAYERS };
