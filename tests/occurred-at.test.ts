import { freshBatch, freshIssue, freshRedeem, freshReload, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const digits = (req: { body: unknown }) => (req.body as any).card_number.replace(/ /g, '');
const balanceOf = async (req: { body: unknown }) => (await get(h.baseUrl, `/cards/${digits(req)}/balance`)).json.balance_minor;
const codeOf = (res: { text: string }) => JSON.parse(res.text).error.code;
const refusedCount = async (key: string) =>
  Number((await h.pool.query('SELECT count(*) FROM refused_movements WHERE idempotency_key = $1', [key])).rows[0].count);
const entryCount = async (req: { body: unknown }) =>
  Number((await h.pool.query(
    `SELECT count(*) FROM ledger_entries WHERE card_id = (SELECT card_id FROM cards WHERE card_number = $1)`,
    [digits(req)])).rows[0].count);

async function issued(occurred_at: string) {
  const issue = freshIssue({ occurred_at });
  expect((await send(h.baseUrl, issue)).status).toBe(201);
  return issue;
}

test('a redemption dated before the card was issued is refused and recorded', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const redeem = freshRedeem(card, 3000, { occurred_at: '2026-08-15T00:00:00Z' });
  const res = await send(h.baseUrl, redeem);
  expect(res.status).toBe(422);
  expect(codeOf(res)).toBe('occurred_before_issue');
  expect(await balanceOf(card)).toBe(10000);
  expect(await refusedCount(redeem.headers['Idempotency-Key'])).toBe(1);
});

test('a redemption dated exactly at the issue instant is accepted', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const res = await send(h.baseUrl, freshRedeem(card, 1000, { occurred_at: '2026-09-10T00:00:00Z' }));
  expect(res.status).toBe(201);
  expect(await balanceOf(card)).toBe(9000);
});

test('a reload dated before the card was issued is refused', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const res = await send(h.baseUrl, freshReload(card, 500, { occurred_at: '2026-08-15T00:00:00Z' }));
  expect(res.status).toBe(422);
  expect(codeOf(res)).toBe('occurred_before_issue');
  expect(await balanceOf(card)).toBe(10000);
});

test('an offline batch item dated before the card was issued refuses the whole batch', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const batch = freshBatch([
    { card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z' },
    { card, amount: '1.00', occurred_at: '2026-08-25T08:00:00Z' },
  ]);
  const res = await send(h.baseUrl, batch);
  expect(res.status).toBe(422);
  expect(codeOf(res)).toBe('occurred_before_issue');
  expect(await balanceOf(card)).toBe(10000);
  expect(await entryCount(card)).toBe(1); // the issue entry only
});

test('a reversal dated before its redemption is refused', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const redeem = freshRedeem(card, 4000, { occurred_at: '2026-09-20T00:00:00Z' });
  expect((await send(h.baseUrl, redeem)).status).toBe(201);
  const res = await send(h.baseUrl, {
    method: 'POST', path: '/reversals', headers: { 'Idempotency-Key': 'k-early-rev' },
    body: { redemption_ref: (redeem.body as any).redemption_ref, occurred_at: '2026-09-19T00:00:00Z' },
  });
  expect(res.status).toBe(422);
  expect(codeOf(res)).toBe('reversal_before_redemption');
  expect(await balanceOf(card)).toBe(6000);
});

test('a reversal dated exactly at the redemption instant is accepted', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const redeem = freshRedeem(card, 4000, { occurred_at: '2026-09-20T00:00:00Z' });
  expect((await send(h.baseUrl, redeem)).status).toBe(201);
  const res = await send(h.baseUrl, {
    method: 'POST', path: '/reversals', headers: { 'Idempotency-Key': 'k-at-rev' },
    body: { redemption_ref: (redeem.body as any).redemption_ref, occurred_at: '2026-09-20T00:00:00Z' },
  });
  expect(res.status).toBe(201);
  expect(await balanceOf(card)).toBe(10000);
});

test('a refused before-issue redemption replays byte-for-byte', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  const redeem = freshRedeem(card, 3000, { occurred_at: '2026-08-15T00:00:00Z' });
  const first = await send(h.baseUrl, redeem);
  expect(await send(h.baseUrl, redeem)).toEqual(first);
  expect(await refusedCount(redeem.headers['Idempotency-Key'])).toBe(1);
});

test('a report for a month before the card existed is unaffected by later activity', async () => {
  const card = await issued('2026-09-10T00:00:00Z');
  await send(h.baseUrl, freshRedeem(card, 1000, { occurred_at: '2026-09-20T00:00:00Z' }));
  const { json } = await get(h.baseUrl, '/reports/liability?month=2026-08');
  expect(json.group).toMatchObject({ opening_minor: 0, closing_minor: 0 });
  expect(json.flags.overdrawn_cards).toEqual([]);
});
