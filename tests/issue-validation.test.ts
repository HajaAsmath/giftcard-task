import { fixtureLine, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const base = fixtureLine(3);
const body = base.body as Record<string, unknown>;
const without = (field: string) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== field));

test.each([
  ['missing_occurred_at', without('occurred_at')],
  ['invalid_occurred_at', { ...body, occurred_at: '2026-08-01 00:30' }],
  ['invalid_occurred_at', { ...body, occurred_at: '2026-02-30T00:00:00Z' }],
  ['invalid_amount', { ...body, amount_minor: 100.5 }],
  ['invalid_amount', { ...body, amount_minor: '10000' }],
  ['invalid_amount', { ...body, amount_minor: 0 }],
  ['invalid_amount', without('amount_minor')],
  ['invalid_pin', { ...body, pin: '12345' }],
  ['invalid_pin', without('pin')],
  ['invalid_card_number', { ...body, card_number: '6036-2800-0000-1001' }],
  ['invalid_card_number', without('card_number')],
  ['unknown_store', { ...body, store_id: 's9' }],
])('a malformed issue is refused with 400 %s', async (code, malformed) => {
  const res = await send(h.baseUrl, { ...base, headers: { 'Idempotency-Key': `k-bad-${Math.random()}` }, body: malformed });
  expect(res.status).toBe(400);
  expect(JSON.parse(res.text)).toEqual({ error: { code, message: expect.any(String) } });
});

test('an issue without an Idempotency-Key is refused with 400', async () => {
  const res = await send(h.baseUrl, { ...base, headers: {} });
  expect(res.status).toBe(400);
  expect(JSON.parse(res.text)).toEqual({ error: { code: 'missing_idempotency_key', message: expect.any(String) } });
});

test('a body that is not JSON is refused with 400', async () => {
  const res = await fetch(h.baseUrl + '/cards/issue', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-notjson' }, body: '{"card_number":',
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: { code: 'malformed_json', message: expect.any(String) } });
});
