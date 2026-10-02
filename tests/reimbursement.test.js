import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReimbursement } from '../src/reimbursement.js';
import worker from '../worker.js';
import { RAW_NOTES } from './fixtures.js';

const raw = id => RAW_NOTES.find(n => n.id === id).raw_notes;
const statuses = result => Object.fromEntries(result.items.map(i => [i.id, i.status]));

test('a complete home health treatment note has every requirement found', () => {
  const note = 'Visit 45 min. Pt homebound: requires RW and assist of 1 to leave home due to taxing effort. ' +
    'Instructed in LB dressing w/ reacher, VC for hip precautions, mod A. Pt tolerated well, mild fatigue. ' +
    'Progressing toward goal of LB dressing with SBA.';
  assert.deepEqual(statuses(checkReimbursement(note, 'treatment', 'medicare-home-health')), {
    homebound: 'found',
    skilled_need: 'found',
    objective_measures: 'found',
    patient_response: 'found',
    goals: 'found',
    visit_length: 'found',
    reassessment_30_day: 'reminder'
  });
});

test('a sparse note lists what Medicare home health documentation needs', () => {
  const s = statuses(checkReimbursement('worked on sit to stand, needed help.', 'treatment', 'medicare-home-health'));
  for (const id of ['homebound', 'skilled_need', 'objective_measures', 'patient_response', 'goals', 'visit_length']) {
    assert.equal(s[id], 'missing', id);
  }
});

test('initial evaluations check plan-of-care frequency and duration, not the 30-day reminder', () => {
  const withPlan = statuses(checkReimbursement('OT eval. Plan 2w4 for ADL retraining.', 'initial-eval', 'medicare-home-health'));
  assert.equal(withPlan.frequency_duration, 'found');
  assert.equal(withPlan.reassessment_30_day, undefined);
  const longhand = statuses(checkReimbursement('Freq 3x/week for 4 weeks.', 'initial-eval', 'medicare-home-health'));
  assert.equal(longhand.frequency_duration, 'found');
  const frequencyOnly = statuses(checkReimbursement('Freq 3x/week.', 'initial-eval', 'medicare-home-health'));
  assert.equal(frequencyOnly.frequency_duration, 'missing');
  assert.equal(statuses(checkReimbursement('tx 30 min', 'treatment', 'medicare-home-health')).frequency_duration, undefined);
});

test('fixtures: measurements and visit length are recognized in real shorthand', () => {
  const tf = statuses(checkReimbursement(raw('time-and-frequency'), 'treatment', 'medicare-home-health'));
  assert.equal(tf.visit_length, 'found'); // "tx 1 hour"
  assert.equal(tf.objective_measures, 'found');
  assert.equal(tf.homebound, 'missing');
  const hip = statuses(checkReimbursement(raw('hip-ub-dressing'), 'treatment', 'medicare-home-health'));
  assert.equal(hip.objective_measures, 'found');
  assert.equal(hip.visit_length, 'missing');
});

test('every item carries a source, and results say they are unverified', () => {
  const result = checkReimbursement('pt seen', 'treatment', 'medicare-home-health');
  assert.equal(result.verified_by_expert, false);
  assert.match(result.disclaimer, /not a coverage or billing determination/);
  for (const item of result.items) assert.match(item.source, /Medicare|CFR/);
});

test('unknown payers are rejected', async () => {
  assert.equal(checkReimbursement('pt seen', 'treatment', 'aetna'), null);
  const memoryKV = initial => {
    const store = new Map(Object.entries(initial));
    return { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  };
  const env = { API_KEYS: memoryKV({ k: JSON.stringify({ active: true, tier: 'standard' }) }), RATE_LIMITS: memoryKV({}) };
  const post = (path, body) => worker.fetch(new Request(`https://api.test${path}`, {
    method: 'POST', headers: { 'X-API-Key': 'k', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), env, { waitUntil() {} });

  const bad = await post('/api/v1/notes/generate', { raw_notes: 'x', note_type: 'treatment', payer: 'aetna' });
  assert.equal(bad.status, 400);
  const ok = await post('/api/v1/notes/reimbursement-check', { raw_notes: 'tx 30 min', payer: 'medicare-home-health' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).reimbursement.payer, 'medicare-home-health');
});
