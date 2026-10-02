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

test('a number reused for a different measure is rejected (3/5 does not ground "3 sets")', () => {
  const source = 'R hip abd MMT 3/5. sidelying hip abd 10 reps.';
  assert.deepEqual(findUngroundedValues('R hip abduction 3/5. Sidelying hip abduction 10 reps.', source), []);
  assert.deepEqual(findUngroundedValues('Sidelying hip abduction 3 sets of 10 reps.', source), ['3 sets']);
  assert.deepEqual(findUngroundedValues('R hip abduction 3 degrees.', source), ['3 degrees']);
  assert.deepEqual(findUngroundedValues('Pain 3/10.', source), ['3/10']);
  assert.deepEqual(findUngroundedValues('Ambulated 10 feet.', source), ['10 feet']);
});

test('sets and reps are not swapped', () => {
  const source = 'sit to stand 3x10';
  assert.deepEqual(findUngroundedValues('Sit to stand 3 sets of 10 repetitions.', source), []);
  assert.deepEqual(findUngroundedValues('Sit to stand 10 sets of 3 reps.', source), ['10 sets', '3 reps']);
});

test('equivalent units and wording are accepted', () => {
  const cases = [
    ['Treatment session 60 minutes.', 'tx 1 hour'],
    ['Treatment session 1 hour.', 'tx 60 min'],
    ['Treatment session 30 minutes.', 'tx half an hour'],
    ['Single leg stance 30 seconds.', 'SLS 30 sec'],
    ['Return in 14 days.', 'recheck 2 wks'],
    ['Ambulated 150 feet with RW.', 'amb 150 ft RW'],
    ['Ambulated 46 meters with RW.', 'amb 150 ft RW'],
    ['Ambulated 10 ft.', "amb 10'"],
    ['HEP twice daily.', 'HEP 2x/day'],
    ['HEP 2 times per day.', 'HEP BID'],
    ['Completed 3 sets of 10.', 'three sets of ten'],
    ['Pain 4/10 in L knee.', 'pain four out of ten L knee'],
    ['Pain 6/10.', 'pain 6'],
    ['72-year-old female.', '72yo F'],
    ['R shoulder flexion 0-85 degrees.', 'R shoulder flex AROM 0-85'],
    ['R knee flexion 110 degrees.', 'R knee flex 110'],
    ['Seen 9/12/2026.', 'DOS September 12, 2026'],
    ['Stage II pressure injury.', 'stage 2 PI sacrum'],
    ['Bed mobility with Contact Guard Assist.', 'bed mob CGA'],
    ['Transfers with minimal assistance.', 'transfers min A'],
    ['C5 SCI.', 'c5 sci']
  ];
  for (const [note, source] of cases) {
    assert.deepEqual(findUngroundedValues(note, source), [], `"${note}" should be grounded by "${source}"`);
  }
});

test('wrong values and wrong conversions are rejected', () => {
  const cases = [
    ['Treatment session 60 minutes.', 'tx 1 hour 10 min', []],
    ['Treatment session 45 minutes.', 'tx 1 hour', ['45 minutes']],
    ['Ambulated 150 meters.', 'amb 150 ft', ['150 meters']],
    ['Ambulated 10 minutes.', 'amb 10 ft', ['10 minutes']],
    ['HEP 2x/week.', 'HEP 2x/day', ['2x/week']],
    ['Return in 2 weeks.', '2 days post injury', ['2 weeks']],
    ['R grip 4/5.', 'R grip 4-/5', ['4/5']],
    ['Stage 3 pressure injury.', 'stage 2 PI', ['Stage 3']],
    ['Seen 9/13/2026.', 'DOS 9/12/2026', ['9/13/2026']],
    ['Transfers Mod A.', 'transfers min A', ['Mod A']],
    ['Goal: Independent with LB dressing.', 'LB dressing max A', ['Independent']],
    ['GG 06 Independent.', 'toilet transfer max A', ['06 Independent']],
    ['L4-L5 radiculopathy.', 'LBP', ['L4', 'L5']]
  ];
  for (const [note, source, expected] of cases) {
    assert.deepEqual(findUngroundedValues(note, source), expected, `"${note}" vs "${source}"`);
  }
});

test('number words, minutes and stray words are not misread', () => {
  // "one leg" is not a value; "5 min" is time, not Min A; a 5-digit code is caught.
  assert.deepEqual(findUngroundedValues('Single leg stance on one leg. Ambulated 5 min.', 'SLS, amb 5 min'), []);
  assert.deepEqual(findUngroundedValues('Ambulated 5 min.', 'amb 5 min'), []);
  assert.deepEqual(findUngroundedValues('Pt independent with HEP.', 'pt indep w/ HEP'), []);
});

test('every fixture grounds itself, and faithful rewrites of new fixtures pass', () => {
  for (const { id, raw_notes } of RAW_NOTES) {
    assert.deepEqual(findUngroundedValues(raw_notes, raw_notes), [], id);
  }
  assert.deepEqual(findUngroundedValues(
    'R hip abduction 3/5, R knee extension 4-/5. Sidelying hip abduction 3 sets of 10 reps, long arc quads 2 sets of 15 reps R LE. Pain 3/10 after exercise.',
    raw('mmt-and-exercise-counts')), []);
  assert.deepEqual(findUngroundedValues(
    'Treatment session 60 minutes. NuStep 10 minutes level 3. Single leg stance 30 seconds x3 each LE with Contact Guard Assist. HEP twice daily, follow up in 2 weeks.',
    raw('time-and-frequency')), []);
  assert.deepEqual(findUngroundedValues(
    'Date of service 9/12/2026. 81-year-old male s/p R TKA on September 1, 2026. Ambulated 150 feet with RW, Standby Assist; 4 steps with 1 rail, Min A. R knee flexion AROM 0-95 degrees, extension lag 10 degrees. Pain 5/10 R knee.',
    raw('gait-distance-date')), []);
});

test('values from the new fixtures cannot be reused for another measure', () => {
  // 3 appears only as an MMT grade, sets count and pain score, never as minutes or feet.
  assert.deepEqual(findUngroundedValues('Hip abduction 3 minutes. Ambulated 3 feet.', raw('mmt-and-exercise-counts')).sort(), ['3 feet', '3 minutes']);
  // 10 is minutes (NuStep), not reps; 30 is seconds, not degrees.
  assert.deepEqual(findUngroundedValues('NuStep 10 reps. Hip flexion 30 degrees.', raw('time-and-frequency')).sort(), ['10 reps', '30 degrees']);
  // 150 is feet, not degrees; 10 is degrees, not minutes.
  assert.deepEqual(findUngroundedValues('Knee flexion 150 degrees. Ambulated 10 minutes.', raw('gait-distance-date')).sort(), ['10 minutes', '150 degrees']);
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
