import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSOAP,
  validateClinicalContent,
  extractStructuredData,
  findUngroundedValues,
  findBillingCodes
} from '../src/clinical.js';
import { RAW_NOTES } from './fixtures.js';

const raw = id => RAW_NOTES.find(n => n.id === id).raw_notes;

test('parseSOAP reads full, abbreviated and markdown headers', () => {
  const variants = [
    'Subjective: a\nObjective: b\nAssessment: c\nPlan: d',
    'S:\na\nO:\nb\nA:\nc\nP:\nd',
    '**S:** a\n## O:\nb\n**Assessment:**\nc\n**P**\nd'
  ];
  for (const text of variants) {
    assert.deepEqual(parseSOAP(text), { subjective: 'a', objective: 'b', assessment: 'c', plan: 'd' });
  }
});

test('parseSOAP does not split on "plan" inside a sentence', () => {
  const sections = parseSOAP('Assessment:\nProgressing. Plan to continue.\nPlan:\nHEP');
  assert.equal(sections.assessment, 'Progressing. Plan to continue.');
  assert.equal(sections.plan, 'HEP');
});

test('a faithful ankle-sprain note passes validation', () => {
  const note = `Subjective:
Patient reports slight L ankle sprain sustained during kickboxing, 2 days prior to session.

Objective:
Therapist facilitated single leg balance with UE support, progressed to single leg balance without support, then single leg balance with eyes closed. Instructed patient in ankle alphabet exercises.

Assessment:
Patient tolerated balance progression within session.

Plan:
Patient instructed to perform ankle alphabets on R ankle as prehab.`;
  const v = validateClinicalContent(note, 'treatment', 'kinnser', raw('ankle-sprain-balance'));
  assert.equal(v.valid, true, JSON.stringify(v.issues));
});

test('an embellished ankle-sprain note is rejected for every invented value', () => {
  const note = `Subjective:
Patient reports Grade I L ankle sprain from kickboxing 2 days ago. Pain 3/10.

Objective:
Single leg balance 3 x 30 sec. L ankle dorsiflexion 15 degrees. L ankle eversion 4-/5. CPT 97112, 97110.

Assessment:
Goal: return to kickboxing in 2 weeks.

Plan:
Continue 2x/week for 4 weeks.`;
  const v = validateClinicalContent(note, 'treatment', 'kinnser', raw('ankle-sprain-balance'));
  assert.equal(v.valid, false);
  const all = v.issues.join(' ');
  for (const invented of ['97112', '97110', 'Grade I', '3/10', '3 x', '30 sec', '15 degrees', '4-/5', '4 weeks']) {
    assert.ok(all.includes(invented), `expected "${invented}" to be flagged in: ${all}`);
  }
  assert.ok(!/\b2 days\b/.test(all), '"2 days" is in the raw notes and must not be flagged');
});

test('values in the raw notes are accepted, including number words', () => {
  const note = 'Subjective:\nPain 4/10 L knee.\nObjective:\n3 x 10 sit to stand with Supervision.\nAssessment:\nOk.\nPlan:\nContinue.';
  assert.deepEqual(findUngroundedValues(note, raw('number-words')), []);
});

test('assist-level definitions and Section GG codes are not treated as invented', () => {
  const note = 'UB dressing Min A (patient 75%+). GG self-care: 03 Partial/moderate assistance.';
  assert.deepEqual(findUngroundedValues(note, 'UB dressing min A'), []);
});

test('findBillingCodes catches every code in a list', () => {
  assert.deepEqual(findBillingCodes('CPT 97112, 97110 and 97530'), ['97112', '97110', '97530']);
  assert.deepEqual(findBillingCodes('G8978 reported'), ['G8978']);
});

test('ROM and MMT are extracted separately and MMT is never read as degrees', () => {
  const s = extractStructuredData('ROM: R hip flexion 90 degrees, abduction 30 degrees. Strength: R hip flexion 3/5, abduction 2/5.', 'treatment');
  assert.deepEqual(s.functional_abilities.rom_measurements.map(m => m.degrees), [90, 30]);
  assert.deepEqual(s.functional_abilities.strength_grades.map(m => m.label), ['3/5', '2/5']);
  assert.equal(s.functional_abilities.rom_measurements[0].side, 'R');
  assert.equal(s.functional_abilities.rom_measurements[0].joint, 'hip');
});

test('AROM/PROM ranges and +/- grades are captured', () => {
  const s = extractStructuredData('R shoulder flexion AROM 0-85 degrees. R grip 3-/5.', 'initial-eval');
  assert.deepEqual(s.functional_abilities.rom_measurements[0], {
    side: 'R', joint: 'shoulder', movement: 'flexion', type: 'AROM', start_degrees: 0, degrees: 85
  });
  assert.equal(s.functional_abilities.strength_grades[0].label, '3-/5');
});

test('exercise counts are not mistaken for ROM', () => {
  const s = extractStructuredData('Hip flexion 2 x 10 reps.', 'treatment');
  assert.deepEqual(s.functional_abilities.rom_measurements, []);
});

test('structured ROM/MMT drops values not present in the raw notes', () => {
  const s = extractStructuredData('L ankle dorsiflexion 15 degrees. L ankle eversion 4-/5.', 'treatment', raw('ankle-sprain-balance'));
  assert.deepEqual(s.functional_abilities.rom_measurements, []);
  assert.deepEqual(s.functional_abilities.strength_grades, []);
});

test('skin integrity is null unless documented', () => {
  assert.equal(extractStructuredData('Pt reports pain and swelling.', 'treatment').skin_integrity.intact, null);
  assert.equal(extractStructuredData('Skin intact.', 'treatment').skin_integrity.intact, true);
  const wound = extractStructuredData(raw('wound-skin'), 'treatment').skin_integrity;
  assert.equal(wound.intact, false);
  assert.equal(wound.staging, '2');
});

test('missing sections are issues; missing assist level is only a warning', () => {
  const v = validateClinicalContent('S: tired\nO: sit to stand', 'treatment', 'kinnser', raw('sparse-note'));
  assert.deepEqual(v.issues, ['Missing Assessment section', 'Missing Plan section']);
  assert.ok(v.warnings.includes('No assistance level documented'));
});
