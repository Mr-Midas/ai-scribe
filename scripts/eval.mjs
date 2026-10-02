// Live evaluation: sends every fixture in tests/fixtures.js through the real
// /api/v1/notes/generate pipeline and checks the output is safe to file.
//
// Local (calls the models directly through worker.js):
//   GROQ_API_KEY=... OPENROUTER_API_KEY=... npm run eval
// Deployed API:
//   EVAL_BASE_URL=https://<your-worker>.workers.dev EVAL_API_KEY=nscrb_... npm run eval
//
// EVAL_API_KEY_FILE=<path> reads the key from a file instead, so it never has to
// be typed or pasted.
// EVAL_RUNS=3 repeats each note to measure consistency (default 1).
// Exits 1 if any run fails, so it can gate a deploy.
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import { parseSOAP, findUngroundedValues, findBillingCodes } from '../src/clinical.js';
import { RAW_NOTES } from '../tests/fixtures.js';

const runs = parseInt(process.env.EVAL_RUNS || '1', 10);
const baseUrl = process.env.EVAL_BASE_URL;
const apiKey = process.env.EVAL_API_KEY_FILE
  ? readFileSync(process.env.EVAL_API_KEY_FILE, 'utf8').trim()
  : process.env.EVAL_API_KEY;

if (!baseUrl && !process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.log('Skipping live eval: set GROQ_API_KEY and/or OPENROUTER_API_KEY, or EVAL_BASE_URL + EVAL_API_KEY.');
  process.exit(0);
}

const memoryKV = initial => {
  const store = new Map(Object.entries(initial));
  return { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
};
const EVAL_KEY = 'nscrb_eval_local';
const env = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_FALLBACK: process.env.OPENROUTER_FALLBACK,
  GROQ_MODEL: process.env.GROQ_MODEL,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  API_KEYS: memoryKV({ [EVAL_KEY]: JSON.stringify({ active: true, tier: 'unlimited' }) }),
  RATE_LIMITS: memoryKV({})
};
const ctx = { waitUntil() {} };

async function generate(fixture) {
  const url = `${baseUrl || 'https://eval.local'}/api/v1/notes/generate`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': baseUrl ? apiKey : EVAL_KEY },
    body: JSON.stringify({ raw_notes: fixture.raw_notes, note_type: fixture.note_type, target_ehr: fixture.target_ehr })
  };
  const response = baseUrl ? await fetch(url, init) : await worker.fetch(new Request(url, init), env, ctx);
  return { status: response.status, body: await response.json() };
}

function check(fixture, { status, body }) {
  const failures = [];
  if (status !== 200 || !body.success) return [`HTTP ${status}: ${body.error || 'no success flag'}`];
  const sections = parseSOAP(body.note);
  for (const key of ['subjective', 'objective', 'assessment', 'plan']) {
    if (!(key in sections)) failures.push(`missing ${key}`);
  }
  const invented = findUngroundedValues(body.note, fixture.raw_notes);
  if (invented.length) failures.push(`invented values: ${invented.join(', ')}`);
  const codes = findBillingCodes(body.note).filter(c => !fixture.raw_notes.includes(c));
  if (codes.length) failures.push(`invented codes: ${codes.join(', ')}`);
  if (body.review_required) failures.push(`review_required: ${body.validation.issues.join('; ')}`);
  return failures;
}

let failed = 0;
const rows = [];
for (const fixture of RAW_NOTES) {
  for (let i = 0; i < runs; i++) {
    const started = Date.now();
    let failures;
    let meta = {};
    try {
      const result = await generate(fixture);
      failures = check(fixture, result);
      meta = result.body.metadata || {};
      if (failures.length && process.env.EVAL_VERBOSE) console.log(`\n--- ${fixture.id} ---\n${result.body.note ?? JSON.stringify(result.body)}\n`);
    } catch (e) {
      failures = [`error: ${e.message}`];
    }
    if (failures.length) failed++;
    rows.push({
      fixture: fixture.id,
      run: i + 1,
      result: failures.length ? 'FAIL' : 'pass',
      model: meta.model_used || '-',
      attempts: meta.attempts || '-',
      ms: Date.now() - started,
      detail: failures.join(' | ')
    });
  }
}

console.table(rows);
const total = rows.length;
console.log(`\n${total - failed}/${total} runs passed (${Math.round(100 * (total - failed) / total)}%).`);
process.exit(failed ? 1 : 0);
