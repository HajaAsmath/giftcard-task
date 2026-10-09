import { fixtureLine, freshIssue, freshRedeem, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const digits = (req: { body: unknown }) => (req.body as any).card_number.replace(/ /g, '');
const balanceOf = async (req: { body: unknown }) => (await get(h.baseUrl, `/cards/${digits(req)}/balance`)).json.balance_minor;
const refusedCount = async (key: string) =>
  Number((await h.pool.query('SELECT count(*) FROM refused_movements WHERE idempotency_key = $1', [key])).rows[0].count);
const codeOf = (res: { text: string }) => JSON.parse(res.text).error.code;

async function issued(overrides: Record<string, unknown> = {}) {
  const issue = freshIssue(overrides);
  expect((await send(h.baseUrl, issue)).status).toBe(201);
  return issue;
}

test('an accepted redemption lowers the balance and records the performing store', async () => {
  const card = await issued();
  const redeem = freshRedeem(card, 2500, { store_id: 's2' });
  const res = await send(h.baseUrl, redeem);
  expect(res.status).toBe(201);
  expect(JSON.parse(res.text)).toMatchObject({ amount_minor: 2500, balance_minor: 7500, store_id: 's2' });
  expect(await balanceOf(card)).toBe(7500);
  const { rows } = await h.pool.query(
    `SELECT kind, amount_minor::int AS amount_minor, store_id FROM ledger_entries WHERE redemption_ref = $1`,
    [(redeem.body as any).redemption_ref],
  );
  expect(rows).toEqual([{ kind: 'redeem', amount_minor: -2500, store_id: 's2' }]);
});

test('a cross-store redemption (line 9) keeps the issuing store', async () => {
  expect((await send(h.baseUrl, fixtureLine(3))).status).toBe(201);
  const res = await send(h.baseUrl, fixtureLine(9));
  expect(res.status).toBe(201);
  const balance = await get(h.baseUrl, '/cards/6036280000001001/balance');
  expect(balance.json).toMatchObject({ issuing_store_id: 's1', balance_minor: 7000 });
});

test('a wrong PIN is a 403 and changes nothing', async () => {
  const card = await issued();
  const res = await send(h.baseUrl, freshRedeem(card, 100, { pin: '0000' }));
  expect(res.status).toBe(403);
  expect(codeOf(res)).toBe('invalid_pin');
  expect(await balanceOf(card)).toBe(10000);
});

test('an unknown card is a 404', async () => {
  const res = await send(h.baseUrl, freshRedeem(freshIssue(), 100));
  expect(res.status).toBe(404);
  expect(codeOf(res)).toBe('card_not_found');
});

test('spending more than the balance is a 422 insufficient_funds and is recorded as a refused movement', async () => {
  const card = await issued();
  const redeem = freshRedeem(card, 10001);
  const res = await send(h.baseUrl, redeem);
  expect(res.status).toBe(422);
  expect(codeOf(res)).toBe('insufficient_funds');
  expect(await balanceOf(card)).toBe(10000);
  expect(await refusedCount(redeem.headers['Idempotency-Key'])).toBe(1);
});

test('a retried refusal replays byte-for-byte and records no second refused movement', async () => {
  const card = await issued();
  const redeem = freshRedeem(card, 10001);
  const first = await send(h.baseUrl, redeem);
  expect(await send(h.baseUrl, redeem)).toEqual(first);
  expect(await refusedCount(redeem.headers['Idempotency-Key'])).toBe(1);
});

test('expiry is checked against occurred_at: line 18 is accepted and line 19 is card_expired', async () => {
  expect((await send(h.baseUrl, fixtureLine(1))).status).toBe(201);
  expect((await send(h.baseUrl, fixtureLine(18))).status).toBe(201);
  const late = await send(h.baseUrl, fixtureLine(19));
  expect(late.status).toBe(422);
  expect(codeOf(late)).toBe('card_expired');
  expect((await get(h.baseUrl, '/cards/6036280000001002/balance')).json.balance_minor).toBe(3500);
});

test('the expiry instant itself is still spendable, and one millisecond later is not', async () => {
  // A card sold 2023-09-20 12:00 Sydney expires at 2026-09-20T13:59:59.999Z.
  const atTheInstant = freshIssue({ occurred_at: '2023-09-20T02:00:00Z' });
  expect((await send(h.baseUrl, atTheInstant)).status).toBe(201);
  const at = await send(h.baseUrl, freshRedeem(atTheInstant, 100, { occurred_at: '2026-09-20T13:59:59.999Z' }));
  expect(at.status).toBe(201);

  const justAfter = freshIssue({ occurred_at: '2023-09-20T02:00:00Z' });
  expect((await send(h.baseUrl, justAfter)).status).toBe(201);
  const after = await send(h.baseUrl, freshRedeem(justAfter, 100, { occurred_at: '2026-09-20T14:00:00.000Z' }));
  expect(after.status).toBe(422);
  expect(codeOf(after)).toBe('card_expired');
});

test('lines 11 and 12 sent together give exactly one 201 and one 422, and the balance is 1000', async () => {
  expect((await send(h.baseUrl, fixtureLine(6))).status).toBe(201);
  const results = await Promise.all([send(h.baseUrl, fixtureLine(11)), send(h.baseUrl, fixtureLine(12))]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
  expect((await get(h.baseUrl, '/cards/6036280000001003/balance')).json.balance_minor).toBe(1000);
});

test('twenty tills spending the same card at once never overspend it', async () => {
  const card = await issued(); // 10000
  const results = await Promise.all(Array.from({ length: 20 }, () => send(h.baseUrl, freshRedeem(card, 1000))));
  const statuses = results.map((r) => r.status);
  expect(statuses.filter((s) => s === 201)).toHaveLength(10);
  expect(statuses.filter((s) => s === 422)).toHaveLength(10);
  expect(await balanceOf(card)).toBe(0);
});

test('line 14 replays line 13; line 15 reuses the key with a new body and is a 409 that leaves card 1004 at 200', async () => {
  expect((await send(h.baseUrl, fixtureLine(7))).status).toBe(201);
  const first = await send(h.baseUrl, fixtureLine(13));
  expect(first.status).toBe(201);
  expect(await send(h.baseUrl, fixtureLine(14))).toEqual(first);

  const conflict = await send(h.baseUrl, fixtureLine(15));
  expect(conflict.status).toBe(409);
  expect(codeOf(conflict)).toBe('idempotency_conflict');
  expect((await get(h.baseUrl, '/cards/6036280000001004/balance')).json.balance_minor).toBe(200);

  // The conflicting request is auditable once, and the original answer is untouched.
  expect(await send(h.baseUrl, fixtureLine(15))).toEqual(conflict);
  expect(await refusedCount('k-77')).toBe(1);
  expect(await send(h.baseUrl, fixtureLine(13))).toEqual(first);
});

test('a redemption_ref reused under a new key is refused and spends nothing twice', async () => {
  const card = await issued();
  const first = freshRedeem(card, 1000);
  expect((await send(h.baseUrl, first)).status).toBe(201);
  const again = freshRedeem(card, 1000, { redemption_ref: (first.body as any).redemption_ref });
  const res = await send(h.baseUrl, again);
  expect(res.status).toBe(409);
  expect(codeOf(res)).toBe('duplicate_redemption_ref');
  expect(await balanceOf(card)).toBe(9000);
});

test.each([
  ['missing_occurred_at', { occurred_at: undefined }],
  ['invalid_occurred_at', { occurred_at: 'yesterday' }],
  ['invalid_amount', { amount_minor: 0 }],
  ['invalid_amount', { amount_minor: 12.5 }],
  ['invalid_redemption_ref', { redemption_ref: undefined }],
  ['invalid_card_number', { card_number: 'abc' }],
  ['invalid_pin', { pin: '12' }],
  ['unknown_store', { store_id: 's9' }],
])('a malformed redemption is a 400 %s', async (code, patch) => {
  const base = freshRedeem(freshIssue(), 100);
  const body = Object.fromEntries(Object.entries({ ...(base.body as object), ...patch }).filter(([, v]) => v !== undefined));
  const res = await send(h.baseUrl, { ...base, body });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe(code);
});

test('a redemption without an Idempotency-Key is a 400', async () => {
  const res = await send(h.baseUrl, { ...freshRedeem(freshIssue(), 100), headers: {} });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe('missing_idempotency_key');
});
