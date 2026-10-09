import { fixtureLine, freshBatch, freshIssue, freshRedeem, get, Harness, send, startHarness } from './harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const digits = (req: { body: unknown }) => (req.body as any).card_number.replace(/ /g, '');
const balanceOf = async (req: { body: unknown }) => (await get(h.baseUrl, `/cards/${digits(req)}/balance`)).json.balance_minor;
const codeOf = (res: { text: string }) => JSON.parse(res.text).error.code;

async function issued(overrides: Record<string, unknown> = {}) {
  const issue = freshIssue(overrides);
  expect((await send(h.baseUrl, issue)).status).toBe(201);
  return issue;
}

const entryCount = async (issue: { body: unknown }) =>
  Number((await h.pool.query(
    `SELECT count(*) FROM ledger_entries WHERE card_id = (SELECT card_id FROM cards WHERE card_number = $1)`, [digits(issue)])).rows[0].count);

test('line 20 is applied in full and takes card 1005 to -1000', async () => {
  expect((await send(h.baseUrl, fixtureLine(10))).status).toBe(201);
  const res = await send(h.baseUrl, fixtureLine(20));
  expect(res.status).toBe(201);
  expect((await get(h.baseUrl, '/cards/6036280000001005/balance')).json.balance_minor).toBe(-1000);
});

test('offline redemptions are recorded as offline_redeem entries for the batch store and terminal', async () => {
  const card = await issued();
  const batch = freshBatch([{ card, amount: '24.99', occurred_at: '2026-09-25T09:12:00Z' }], { store_id: 's2', terminal_id: 't-s2-09' });
  expect((await send(h.baseUrl, batch)).status).toBe(201);
  const { rows } = await h.pool.query(
    `SELECT kind, amount_minor::int AS amount_minor, store_id, terminal_id FROM ledger_entries
     WHERE redemption_ref = $1`, [(batch.body as any).redemptions[0].redemption_ref]);
  expect(rows).toEqual([{ kind: 'offline_redeem', amount_minor: -2499, store_id: 's2', terminal_id: 't-s2-09' }]);
  expect(await balanceOf(card)).toBe(7501);
});

test('a batch is applied in occurred_at order whatever the order it arrives in', async () => {
  const card = await issued();
  const batch = freshBatch([
    { card, amount: '3.00', occurred_at: '2026-09-25T12:00:00Z', redemption_ref: 'rd-late' },
    { card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z', redemption_ref: 'rd-early' },
    { card, amount: '2.00', occurred_at: '2026-09-25T10:00:00Z', redemption_ref: 'rd-middle' },
  ]);
  expect((await send(h.baseUrl, batch)).status).toBe(201);
  const { rows } = await h.pool.query(
    `SELECT redemption_ref FROM ledger_entries WHERE card_id = (SELECT card_id FROM cards WHERE card_number = $1) AND kind = 'offline_redeem' ORDER BY entry_id`,
    [digits(card)]);
  expect(rows.map((r) => r.redemption_ref)).toEqual(['rd-early', 'rd-middle', 'rd-late']);
  expect(await balanceOf(card)).toBe(9400);
});

test('a redemption after the card expired is still recorded, because the guest already has the goods', async () => {
  expect((await send(h.baseUrl, fixtureLine(1))).status).toBe(201); // card 1002, expires 2026-09-20T13:59:59.999Z
  const batch = freshBatch([{ card: { body: fixtureLine(1).body } as any, amount: '10.00', occurred_at: '2026-10-01T00:00:00Z' }]);
  const res = await send(h.baseUrl, batch);
  expect(res.status).toBe(201);
  expect((await get(h.baseUrl, '/cards/6036280000001002/balance')).json.balance_minor).toBe(4000);
});

test('an unknown card fails the whole batch and nothing is applied', async () => {
  const card = await issued();
  const ghost = freshIssue();
  const batch = freshBatch([
    { card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z' },
    { card: ghost, amount: '1.00', occurred_at: '2026-09-25T09:00:00Z' },
  ]);
  const res = await send(h.baseUrl, batch);
  expect(res.status).toBe(404);
  expect(codeOf(res)).toBe('card_not_found');
  expect(await balanceOf(card)).toBe(10000);
  expect(await entryCount(card)).toBe(1);
});

test('a failure after some entries were inserted rolls all of them back', async () => {
  const card = await issued();
  const taken = freshRedeem(card, 100);
  expect((await send(h.baseUrl, taken)).status).toBe(201);
  const batch = freshBatch([
    { card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z' },
    { card, amount: '2.00', occurred_at: '2026-09-25T09:00:00Z', redemption_ref: (taken.body as any).redemption_ref },
  ]);
  const res = await send(h.baseUrl, batch);
  expect(res.status).toBe(409);
  expect(codeOf(res)).toBe('duplicate_redemption_ref');
  expect(await balanceOf(card)).toBe(9900);
  expect(await entryCount(card)).toBe(2); // issue + the online redemption only
});

test('a retried batch replays byte-for-byte and spends once', async () => {
  const card = await issued();
  const batch = freshBatch([{ card, amount: '8.29', occurred_at: '2026-09-25T08:00:00Z' }]);
  const first = await send(h.baseUrl, batch);
  expect(first.status).toBe(201);
  expect(await send(h.baseUrl, batch)).toEqual(first);
  expect(await balanceOf(card)).toBe(9171);
});

test('re-uploading the same redemptions under a new key is refused and spends nothing twice', async () => {
  const card = await issued();
  const batch = freshBatch([{ card, amount: '8.29', occurred_at: '2026-09-25T08:00:00Z' }]);
  expect((await send(h.baseUrl, batch)).status).toBe(201);
  const again = { ...batch, headers: { 'Idempotency-Key': 'k-reupload-new-key' } };
  const res = await send(h.baseUrl, again);
  expect(res.status).toBe(409);
  expect(codeOf(res)).toBe('duplicate_redemption_ref');
  expect(await balanceOf(card)).toBe(9171);
});

test('reusing a batch key with a different body is a 409 idempotency_conflict', async () => {
  const card = await issued();
  const batch = freshBatch([{ card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z' }]);
  expect((await send(h.baseUrl, batch)).status).toBe(201);
  const other = freshBatch([{ card, amount: '2.00', occurred_at: '2026-09-25T08:00:00Z' }]);
  const res = await send(h.baseUrl, { ...batch, body: other.body });
  expect(res.status).toBe(409);
  expect(codeOf(res)).toBe('idempotency_conflict');
  expect(await balanceOf(card)).toBe(9900);
});

test('concurrent batches touching the same two cards in opposite orders neither deadlock nor lose entries', async () => {
  const x = await issued();
  const y = await issued();
  const at = '2026-09-25T08:00:00Z';
  const batches = Array.from({ length: 16 }, (_, i) =>
    freshBatch(i % 2 === 0
      ? [{ card: x, amount: '1.00', occurred_at: at }, { card: y, amount: '1.00', occurred_at: at }]
      : [{ card: y, amount: '1.00', occurred_at: at }, { card: x, amount: '1.00', occurred_at: at }]));
  const results = await Promise.all(batches.map((b) => send(h.baseUrl, b)));
  expect(results.map((r) => r.status)).toEqual(Array(16).fill(201));
  expect(await balanceOf(x)).toBe(10000 - 1600);
  expect(await balanceOf(y)).toBe(10000 - 1600);
  for (const card of [x, y]) {
    const { rows: [row] } = await h.pool.query(
      `SELECT c.balance_minor::int AS cached, (SELECT SUM(amount_minor)::int FROM ledger_entries WHERE card_id = c.card_id) AS summed
       FROM cards c WHERE card_number = $1`, [digits(card)]);
    expect(row.cached).toBe(row.summed);
  }
});

test.each([
  ['invalid_amount', 'a malformed amount', (b: any) => { b.redemptions[0].amount = '8.299'; }],
  ['invalid_amount', 'a numeric amount', (b: any) => { b.redemptions[0].amount = 8.29; }],
  ['invalid_amount', 'a zero amount', (b: any) => { b.redemptions[0].amount = '0.00'; }],
  ['missing_occurred_at', 'a redemption without occurred_at', (b: any) => { delete b.redemptions[0].occurred_at; }],
  ['invalid_occurred_at', 'a bad occurred_at', (b: any) => { b.redemptions[0].occurred_at = 'noon'; }],
  ['invalid_redemption_ref', 'a redemption without a ref', (b: any) => { delete b.redemptions[0].redemption_ref; }],
  ['invalid_card_number', 'a bad card number', (b: any) => { b.redemptions[0].card_number = 'x'; }],
  ['invalid_batch', 'an empty batch', (b: any) => { b.redemptions = []; }],
  ['invalid_batch', 'redemptions that is not a list', (b: any) => { b.redemptions = 'none'; }],
  ['invalid_terminal_id', 'a missing terminal_id', (b: any) => { delete b.terminal_id; }],
  ['unknown_store', 'an unknown store', (b: any) => { b.store_id = 's9'; }],
])('%s: %s is a 400 and applies nothing', async (code, _label, mutate) => {
  const card = await issued();
  const batch = freshBatch([
    { card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z' },
    { card, amount: '1.00', occurred_at: '2026-09-25T09:00:00Z' },
  ]);
  mutate(batch.body);
  const res = await send(h.baseUrl, batch);
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe(code);
  expect(await balanceOf(card)).toBe(10000);
});

test('a batch without an Idempotency-Key is a 400', async () => {
  const card = await issued();
  const res = await send(h.baseUrl, { ...freshBatch([{ card, amount: '1.00', occurred_at: '2026-09-25T08:00:00Z' }]), headers: {} });
  expect(res.status).toBe(400);
  expect(codeOf(res)).toBe('missing_idempotency_key');
});
