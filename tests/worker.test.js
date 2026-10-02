import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

const memoryKV = initial => {
  const store = new Map(Object.entries(initial));
  return { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
};
const env = () => ({
  MASTER_KEY: 'nscrb_master_test',
  API_KEYS: memoryKV({
    nscrb_active: JSON.stringify({ active: true, tier: 'standard' }),
    nscrb_off: JSON.stringify({ active: false, tier: 'premium' })
  }),
  RATE_LIMITS: memoryKV({})
});
const call = (path, headers = {}, e = env()) =>
  worker.fetch(new Request(`https://api.test${path}`, { headers }), e, { waitUntil() {} });

test('the web app is served at / with a restrictive content security policy', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /text\/html/);
  assert.match(res.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.match(await res.text(), /<title>Note Scribe<\/title>/);
});

test('auth check accepts active keys and the master secret, rejects others', async () => {
  assert.equal((await call('/api/v1/auth/check', { 'X-API-Key': 'nscrb_active' })).status, 200);
  assert.equal((await call('/api/v1/auth/check', { 'X-API-Key': 'nscrb_master_test' })).status, 200);
  const off = await call('/api/v1/auth/check', { 'X-API-Key': 'nscrb_off' });
  assert.equal(off.status, 401);
  assert.equal((await off.json()).error, 'API key deactivated');
  assert.equal((await call('/api/v1/auth/check', { 'X-API-Key': 'nscrb_master_2026' })).status, 401);
  assert.equal((await call('/api/v1/auth/check')).status, 401);
});

test('there is no master key when the secret is not set', async () => {
  const e = env();
  delete e.MASTER_KEY;
  assert.equal((await call('/api/v1/auth/check', { 'X-API-Key': 'undefined' }, e)).status, 401);
  assert.equal((await call('/api/v1/auth/check', { 'X-API-Key': '' }, e)).status, 401);
});
