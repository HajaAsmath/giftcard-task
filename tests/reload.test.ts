import { fixtureLine, freshIssue, freshRedeem, freshReload, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const digits = (req: { body: unknown }) => (req.body as any).card_number.replace(/ /g, '');
const card = async (req: { body: unknown }) => (await get(h.baseUrl, `/cards/${digits(req)}/balance`)).json;
const codeOf = (res: { text: string }) => JSON.parse(res.text).error.code;

async function issued(overrides: Record<string, unknown> = {}) {
  const issue = freshIssue(overrides);
  expect((await send(h.baseUrl, issue)).status).toBe(201);
  return issue;
}

/** The cached balance must equal the sum of the card's ledger entries. */
async function cacheMatchesLedger(req: { body: unknown }) {
  const { rows: [row] } = await h.pool.query(
    `SELECT c.balance_minor::int AS cached,
            (SELECT COALESCE(SUM(amount_minor), 0)::int FROM ledger_entries WHERE card_id = c.card_id) AS summed
     FROM cards c WHERE c.card_number = $1`,
    [digits(req)],
  );
  return row;
}

test('line 22 reloads the card issued by line 21 to 2500', async () => {
  expect((await send(h.baseUrl, fixtureLine(21))).status).toBe(201);
  const res = await send(h.baseUrl, fixtureLine(22));
  expect(res.status).toBe(201);
  expect((await get(h.baseUrl, '/cards/6036280000001008/balance')).json.balance_minor).toBe(2500);
});

test('a reload is a positive entry attributed to the performing store and keeps issuing store and expiry', async () => {
  const issue = await issued();
  const before = await card(issue);
  const reload = freshReload(issue, 2500, { store_id: 's2' });
  const res = await send(h.baseUrl, reload);
  expect(res.status).toBe(201);
  expect(JSON.parse(res.text)).toMatchObject({ amount_minor: 2500, balance_minor: 12500, store_id: 's2' });

  const after = await card(issue);
  expect(after).toMatchObject({ balance_minor: 12500, issuing_store_id: before.issuing_store_id, expires_at: before.expires_at });
  const { rows } = await h.pool.query(
    `SELECT kind, amount_minor::int AS amount_minor, store_id, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at
     FROM ledger_entries WHERE card_id = (SELECT card_id FROM cards WHERE card_number = $1) AND kind = 'reload'`,
    [digits(issue)],
  );
  expect(rows).toEqual([{ kind: 'reload', amount_minor: 2500, store_id: 's2', occurred_at: '2026-09-03T00:00:00Z' }]);
});

test('a retried reload replays byte-for-byte and adds value once', async () => {
  const issue = await issued();
  const reload = freshReload(issue, 500);
  const first = await send(h.baseUrl, reload);
  expect(await send(h.baseUrl, reload)).toEqual(first);
  expect((await card(issue)).balance_minor).toBe(10500);
});

test('reusing a reload key with a different body is a 409 and adds nothing', async () => {
  const issue = await issued();
  const reload = freshReload(issue, 500);
  expect((await send(h.baseUrl, reload)).status).toBe(201);
  const res = await send(h.baseUrl, { ...reload, body: { ...(reload.body as object), amount_minor: 9999 } });
  expect(res.status).toBe(409);
  expect(codeOf(res)).toBe('idempotency_conflict');
  expect((await card(issue)).balance_minor).toBe(10500);
});

test('reloading an unknown card is a 404, and the refusal is replayed', async () => {
  const reload = freshReload(freshIssue(), 500);
  const first = await send(h.baseUrl, reload);
  expect(first.status).toBe(404);
  expect(codeOf(first)).toBe('card_not_found');
  expect(await send(h.baseUrl, reload)).toEqual(first);
});

test('a refused redemption stays refused when retried after a reload raises the balance', async () => {
  const issue = await issued(); // 10000
  const redeem = freshRedeem(issue, 12000);
  const refused = await send(h.baseUrl, redeem);
  expect(refused.status).toBe(422);

  expect((await send(h.baseUrl, freshReload(issue, 5000))).status).toBe(201);
  expect((await card(issue)).balance_minor).toBe(15000);

  expect(await send(h.baseUrl, redeem)).toEqual(refused);
  expect((await card(issue)).balance_minor).toBe(15000);
});

test('twenty concurrent reloads all land and the cached balance equals the ledger sum', async () => {
  const issue = await issued();
  const results = await Promise.all(Array.from({ length: 20 }, () => send(h.baseUrl, freshReload(issue, 100))));
  expect(results.every((r) => r.status === 201)).toBe(true);
  expect(await cacheMatchesLedger(issue)).toEqual({ cached: 12000, summed: 12000 });
  expect((await card(issue)).balance_minor).toBe(12000);
});

test('the cached balance equals the ledger sum after issue, redeem and reload', async () => {
  const issue = await issued();
  await send(h.baseUrl, freshRedeem(issue, 3000));
  await send(h.baseUrl, freshReload(issue, 700));
  expect(await cacheMatchesLedger(issue)).toEqual({ cached: 7700, summed: 7700 });
});

test.each([
  ['missing_occurred_at', { occurred_at: undefined }],
  ['invalid_occurred_at', { occurred_at: 'soon' }],
  ['invalid_amount', { amount_minor: -5 }],
  ['invalid_amount', { amount_minor: '500' }],
  ['invalid_card_number', { card_number: undefined }],
  ['unknown_store', { store_id: 's9' }],
])('a malformed reload is a 400 %s', async (code, patch) => {
  const base = freshReload(freshIssue(), 500);
  const body = Object.fromEntries(Object.entries({ ...(base.body as object), ...patch }).filter(([, v]) => v !== undefined));
  const res = await send(h.baseUrl, { ...base, body });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe(code);
});

test('a reload without an Idempotency-Key is a 400', async () => {
  const res = await send(h.baseUrl, { ...freshReload(freshIssue(), 500), headers: {} });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe('missing_idempotency_key');
});
