import { fixtureLine, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const line3 = fixtureLine(3);
const body3 = line3.body as Record<string, unknown>;

test('line 4 replays line 3 byte-for-byte without issuing twice', async () => {
  const first = await send(h.baseUrl, line3);
  const retry = await send(h.baseUrl, fixtureLine(4));
  expect(first.status).toBe(201);
  expect(retry).toEqual(first);
  expect((await get(h.baseUrl, '/cards/6036280000001001/balance')).json.balance_minor).toBe(10000);
});

test('a retry with the same body in a different key order is still a replay', async () => {
  const reordered = Object.fromEntries(Object.entries(body3).reverse());
  const retry = await send(h.baseUrl, { ...line3, body: reordered });
  expect(retry.status).toBe(201);
});

test('reusing a key with a different body is a 409 and the second request is not applied', async () => {
  const res = await send(h.baseUrl, { ...line3, body: { ...body3, card_number: '6036 2800 0000 1099' } });
  expect(res.status).toBe(409);
  expect(JSON.parse(res.text)).toEqual({ error: { code: 'idempotency_conflict', message: expect.any(String) } });
  expect((await get(h.baseUrl, '/cards/6036280000001099/balance')).status).toBe(404);
});

test('reusing a key with a different PIN is a conflict', async () => {
  const res = await send(h.baseUrl, { ...line3, body: { ...body3, pin: '0000' } });
  expect(res.status).toBe(409);
});

test('a refusal is stored and replayed byte-for-byte', async () => {
  const dup = { ...line3, headers: { 'Idempotency-Key': 'k-dup-1001' } };
  const first = await send(h.baseUrl, dup);
  expect(first.status).toBe(409);
  expect(JSON.parse(first.text).error.code).toBe('card_exists');
  expect(await send(h.baseUrl, dup)).toEqual(first);
});

test('responses never echo the PIN', async () => {
  const res = await send(h.baseUrl, fixtureLine(4));
  expect(res.text).not.toContain('9038');
});

test('concurrent matching issue requests create one gift card and all get the same response', async () => {
  const line6 = fixtureLine(6);
  const results = await Promise.all(Array.from({ length: 8 }, () => send(h.baseUrl, line6)));
  expect(results[0].status).toBe(201);
  for (const r of results) expect(r).toEqual(results[0]);
  expect((await get(h.baseUrl, '/cards/6036280000001003/balance')).json.balance_minor).toBe(3000);
});

test('concurrent issues of the same card under different keys create it once', async () => {
  const line7 = fixtureLine(7);
  const results = await Promise.all(
    ['k-race-a', 'k-race-b', 'k-race-c'].map((k) => send(h.baseUrl, { ...line7, headers: { 'Idempotency-Key': k } })),
  );
  expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  expect((await get(h.baseUrl, '/cards/6036280000001004/balance')).json.balance_minor).toBe(2000);
});
