import { fixtureLine, freshIssue, freshRedeem, freshReverse, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const digits = (req: { body: unknown }) => (req.body as any).card_number.replace(/ /g, '');
const balanceOf = async (req: { body: unknown }) => (await get(h.baseUrl, `/cards/${digits(req)}/balance`)).json.balance_minor;
const codeOf = (res: { text: string }) => JSON.parse(res.text).error.code;

/** An issued card (10000) with one accepted redemption of `amount` at `store`. */
async function redeemed(amount = 4000, store?: string) {
  const issue = freshIssue();
  expect((await send(h.baseUrl, issue)).status).toBe(201);
  const redeem = freshRedeem(issue, amount, store ? { store_id: store } : {});
  expect((await send(h.baseUrl, redeem)).status).toBe(201);
  return { issue, redeem };
}

test('lines 16 and 17 return card 1006 to 6000', async () => {
  expect((await send(h.baseUrl, fixtureLine(8))).status).toBe(201);
  expect((await send(h.baseUrl, fixtureLine(16))).status).toBe(201);
  expect((await get(h.baseUrl, '/cards/6036280000001006/balance')).json.balance_minor).toBe(2000);
  const res = await send(h.baseUrl, fixtureLine(17));
  expect(res.status).toBe(201);
  expect((await get(h.baseUrl, '/cards/6036280000001006/balance')).json.balance_minor).toBe(6000);
});

test('a reversal appends a linked positive entry and leaves the original redemption untouched', async () => {
  const { issue, redeem } = await redeemed(4000, 's2');
  const res = await send(h.baseUrl, freshReverse(redeem));
  expect(JSON.parse(res.text)).toMatchObject({ amount_minor: 4000, balance_minor: 10000, store_id: 's2' });

  const { rows } = await h.pool.query(
    `SELECT e.kind, e.amount_minor::int AS amount_minor, e.store_id, e.redemption_ref,
            (e.reverses_entry_id = o.entry_id) AS linked
     FROM ledger_entries e
     LEFT JOIN ledger_entries o ON o.entry_id = e.reverses_entry_id
     WHERE e.card_id = (SELECT card_id FROM cards WHERE card_number = $1) AND e.kind IN ('redeem', 'reverse')
     ORDER BY e.entry_id`,
    [digits(issue)],
  );
  expect(rows).toEqual([
    { kind: 'redeem', amount_minor: -4000, store_id: 's2', redemption_ref: (redeem.body as any).redemption_ref, linked: null },
    { kind: 'reverse', amount_minor: 4000, store_id: 's2', redemption_ref: null, linked: true },
  ]);
});

test('the reversal amount comes from the original redemption, not the caller', async () => {
  const { issue, redeem } = await redeemed(4000);
  const res = await send(h.baseUrl, freshReverse(redeem, { amount_minor: 1 }));
  expect(res.status).toBe(201);
  expect(await balanceOf(issue)).toBe(10000);
});

test('a retried reversal replays byte-for-byte and restores value once', async () => {
  const { issue, redeem } = await redeemed();
  const reverse = freshReverse(redeem);
  const first = await send(h.baseUrl, reverse);
  expect(await send(h.baseUrl, reverse)).toEqual(first);
  expect(await balanceOf(issue)).toBe(10000);
});

test('a second reversal under a new key is a 409 already_reversed and restores nothing more', async () => {
  const { issue, redeem } = await redeemed();
  expect((await send(h.baseUrl, freshReverse(redeem))).status).toBe(201);
  const second = await send(h.baseUrl, freshReverse(redeem));
  expect(second.status).toBe(409);
  expect(codeOf(second)).toBe('already_reversed');
  expect(await balanceOf(issue)).toBe(10000);
});

test('reusing a reversal key with a different body is a 409 idempotency_conflict', async () => {
  const { redeem } = await redeemed();
  const other = await redeemed();
  const reverse = freshReverse(redeem);
  expect((await send(h.baseUrl, reverse)).status).toBe(201);
  const res = await send(h.baseUrl, { ...reverse, body: freshReverse(other.redeem).body });
  expect(res.status).toBe(409);
  expect(codeOf(res)).toBe('idempotency_conflict');
  expect(await balanceOf(other.issue)).toBe(6000);
});

test('ten concurrent reversals of one redemption restore its value exactly once', async () => {
  const { issue, redeem } = await redeemed();
  const results = await Promise.all(Array.from({ length: 10 }, () => send(h.baseUrl, freshReverse(redeem))));
  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  const refused = results.filter((r) => r.status !== 201);
  expect(refused.map(codeOf)).toEqual(Array(9).fill('already_reversed'));
  expect(await balanceOf(issue)).toBe(10000);
});

test('an unknown redemption_ref is a 404 and changes nothing', async () => {
  const { issue, redeem } = await redeemed();
  const res = await send(h.baseUrl, freshReverse(redeem, { redemption_ref: 'rd-does-not-exist' }));
  expect(res.status).toBe(404);
  expect(codeOf(res)).toBe('redemption_not_found');
  expect(await balanceOf(issue)).toBe(6000);
});

test('a refused redemption cannot be reversed because it never reached the ledger', async () => {
  const issue = freshIssue();
  await send(h.baseUrl, issue);
  const tooMuch = freshRedeem(issue, 99999);
  expect((await send(h.baseUrl, tooMuch)).status).toBe(422);
  const res = await send(h.baseUrl, freshReverse(tooMuch));
  expect(res.status).toBe(404);
  expect(codeOf(res)).toBe('redemption_not_found');
  expect(await balanceOf(issue)).toBe(10000);
});

test('the cached balance equals the ledger sum after a reversal', async () => {
  const { issue, redeem } = await redeemed(2500);
  await send(h.baseUrl, freshReverse(redeem));
  const { rows: [row] } = await h.pool.query(
    `SELECT c.balance_minor::int AS cached, (SELECT SUM(amount_minor)::int FROM ledger_entries WHERE card_id = c.card_id) AS summed
     FROM cards c WHERE card_number = $1`,
    [digits(issue)],
  );
  expect(row).toEqual({ cached: 10000, summed: 10000 });
});

test.each([
  ['invalid_redemption_ref', { redemption_ref: undefined }],
  ['missing_occurred_at', { occurred_at: undefined }],
  ['invalid_occurred_at', { occurred_at: '2026-13-01T00:00:00Z' }],
  ['invalid_reason', { reason: 42 }],
])('a malformed reversal is a 400 %s', async (code, patch) => {
  const { redeem } = await redeemed();
  const base = freshReverse(redeem);
  const body = Object.fromEntries(Object.entries({ ...(base.body as object), ...patch }).filter(([, v]) => v !== undefined));
  const res = await send(h.baseUrl, { ...base, body });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe(code);
});

test('a reversal without an Idempotency-Key is a 400', async () => {
  const { redeem } = await redeemed();
  const res = await send(h.baseUrl, { ...freshReverse(redeem), headers: {} });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe('missing_idempotency_key');
});
