import { fixtureLine, freshIssue, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const digits = (req: { body: unknown }) => (req.body as any).card_number.replace(/ /g, '');

test('line 4 replays line 3 byte-for-byte without issuing twice', async () => {
  const first = await send(h.baseUrl, fixtureLine(3));
  const retry = await send(h.baseUrl, fixtureLine(4));
  expect(first.status).toBe(201);
  expect(retry).toEqual(first);
  expect((await get(h.baseUrl, '/cards/6036280000001001/balance')).json.balance_minor).toBe(10000);
});

test('a retry with the same body in a different key order is still a replay', async () => {
  const issue = freshIssue();
  const first = await send(h.baseUrl, issue);
  const reordered = Object.fromEntries(Object.entries(issue.body as object).reverse());
  expect(await send(h.baseUrl, { ...issue, body: reordered })).toEqual(first);
});

test('reusing a key with a different body is a 409 and the second request is not applied', async () => {
  const issue = freshIssue();
  expect((await send(h.baseUrl, issue)).status).toBe(201);

  const other = freshIssue();
  const res = await send(h.baseUrl, { ...issue, body: other.body });
  expect(res.status).toBe(409);
  expect(JSON.parse(res.text)).toEqual({ error: { code: 'idempotency_conflict', message: expect.any(String) } });
  expect((await get(h.baseUrl, `/cards/${digits(other)}/balance`)).status).toBe(404);
});

test('reusing a key with a different PIN is a conflict', async () => {
  const issue = freshIssue();
  expect((await send(h.baseUrl, issue)).status).toBe(201);
  const res = await send(h.baseUrl, { ...issue, body: { ...(issue.body as object), pin: '0000' } });
  expect(res.status).toBe(409);
  expect(JSON.parse(res.text).error.code).toBe('idempotency_conflict');
});

test('a refusal is stored and replayed byte-for-byte', async () => {
  const issue = freshIssue();
  expect((await send(h.baseUrl, issue)).status).toBe(201);

  const duplicate = { ...issue, headers: { 'Idempotency-Key': 'k-dup-of-fresh' } };
  const first = await send(h.baseUrl, duplicate);
  expect(first.status).toBe(409);
  expect(JSON.parse(first.text).error.code).toBe('card_exists');
  expect(await send(h.baseUrl, duplicate)).toEqual(first);
});

test('responses never echo the PIN', async () => {
  const issue = freshIssue({ pin: '7351' });
  const first = await send(h.baseUrl, issue);
  const replay = await send(h.baseUrl, issue);
  expect(first.status).toBe(201);
  expect(first.text).not.toContain('7351');
  expect(replay.text).not.toContain('7351');
});

test('concurrent matching issue requests create one gift card and all get the same response', async () => {
  const issue = freshIssue();
  const results = await Promise.all(Array.from({ length: 8 }, () => send(h.baseUrl, issue)));
  expect(results[0].status).toBe(201);
  for (const r of results) expect(r).toEqual(results[0]);
  expect((await get(h.baseUrl, `/cards/${digits(issue)}/balance`)).json.balance_minor).toBe(10000);
});

test('concurrent issues of the same card under different keys create it once', async () => {
  const issue = freshIssue();
  const results = await Promise.all(
    ['k-race-a', 'k-race-b', 'k-race-c'].map((k) => send(h.baseUrl, { ...issue, headers: { 'Idempotency-Key': k } })),
  );
  expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  expect((await get(h.baseUrl, `/cards/${digits(issue)}/balance`)).json.balance_minor).toBe(10000);
});
