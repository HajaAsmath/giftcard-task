import { getReport, Harness, startHarness } from './harness';
import { replayFixtures } from '../src/replay';

let h: Harness;
let replayed: Awaited<ReturnType<typeof replayFixtures>>;
beforeAll(async () => {
  h = await startHarness();
  replayed = await replayFixtures(h.baseUrl); // the same code `npm run replay` uses
});
afterAll(async () => { await h.stop(); });

// Worked out by hand from the spec's success table and the fixture lines, not from the code under test.
const ZERO = { issue: 0, reload: 0, redeem: 0, reverse: 0, offline_redeem: 0 };
const SEPTEMBER = {
  month: '2026-09',
  currency: 'AUD',
  stores: [
    {
      store_id: 's1', name: 'CBD', legal_entity: 'Harbour CBD Pty Ltd',
      period_start: '2026-08-31T14:00:00.000Z', period_end: '2026-09-30T13:59:59.999Z',
      opening_minor: 10000,
      movements_minor: { issue: 8000, reload: 0, redeem: -11300, reverse: 4000, offline_redeem: 0 },
      overdrawn_excluded_minor: { opening: 0, closing: 0 },
      closing_minor: 10700,
    },
    {
      store_id: 's2', name: 'Bondi', legal_entity: 'Harbour Bondi Pty Ltd',
      period_start: '2026-08-31T14:00:00.000Z', period_end: '2026-09-30T13:59:59.999Z',
      opening_minor: 4000,
      movements_minor: { issue: 4000, reload: 0, redeem: -1500, reverse: 0, offline_redeem: -5000 },
      overdrawn_excluded_minor: { opening: 0, closing: 1000 },
      closing_minor: 2500,
    },
    {
      store_id: 's3', name: 'Parramatta', legal_entity: 'Harbour West Pty Ltd',
      period_start: '2026-08-31T14:00:00.000Z', period_end: '2026-09-30T13:59:59.999Z',
      opening_minor: 0,
      movements_minor: { issue: 4000, reload: 1500, redeem: -2000, reverse: 0, offline_redeem: 0 },
      overdrawn_excluded_minor: { opening: 0, closing: 0 },
      closing_minor: 3500,
    },
  ],
  group: {
    opening_minor: 14000,
    movements_minor: { issue: 16000, reload: 1500, redeem: -14800, reverse: 4000, offline_redeem: -5000 },
    overdrawn_excluded_minor: { opening: 0, closing: 1000 },
    closing_minor: 16700,
  },
  flags: {
    overdrawn_cards: [
      { card_number: '6036280000001005', store_id: 's2', balance_minor: -1000,
        cause: 'offline_redeem rd-5-2 from terminal t-s1-03 at s1 took the balance below zero' },
    ],
    expired_with_balance: [
      { card_number: '6036280000001002', store_id: 's2', balance_minor: 2500, expired_at: '2026-09-20T13:59:59.999Z' },
    ],
    intercompany: [
      { owes: 's1', owed_to: 's2', amount_minor: 3000 },
      { owes: 's2', owed_to: 's1', amount_minor: 6500 },
    ],
    refused_movements: [
      { card_number: '6036280000001003', store_id: 's3', amount_minor: 2000, code: 'insufficient_funds' },
      { card_number: '6036280000001004', store_id: 's1', amount_minor: 1200, code: 'idempotency_conflict' },
      { card_number: '6036280000001002', store_id: 's1', amount_minor: 500, code: 'card_expired' },
    ],
  },
};

test('the replay gets the expected status for every fixture line', () => {
  const statuses = replayed.map((r) => r.status);
  // Lines 11 and 12 were sent together: one wins (201), one loses (422), and either order is fine.
  expect(statuses.slice(10, 12).sort()).toEqual([201, 422]);
  expect([...statuses.slice(0, 10), ...statuses.slice(12)]).toEqual([
    201, 201, 201, 201, 201, 201, 201, 201, 201, 201, // lines 1-10 (line 4 replays line 3)
    201, 201, 409, 201, 201, 201, 422, 201, 201, 201, 201, // lines 13-23 (14 replays 13, 15 conflicts, 19 expired)
  ]);
});

test('the September 2026 report matches the spec to the cent', async () => {
  const res = await getReport(h.baseUrl, '2026-09');
  expect(res.status).toBe(200);
  expect(res.json).toEqual(SEPTEMBER);
});

test('group closing liability is 16700 and the overdrawn card is not netted into it', async () => {
  const { json } = await getReport(h.baseUrl, '2026-09');
  expect(json.group.closing_minor).toBe(16700);
  expect(json.stores.find((s: any) => s.store_id === 's2').closing_minor).toBe(2500); // not 1500
});

test('liability sits with the issuing store: line 9 lowers s1, not s2', async () => {
  const { json } = await getReport(h.baseUrl, '2026-09');
  const s1 = json.stores.find((s: any) => s.store_id === 's1');
  expect(s1.movements_minor.redeem).toBe(-11300); // includes the 3000 spent at s2
  expect(json.flags.intercompany).toContainEqual({ owes: 's1', owed_to: 's2', amount_minor: 3000 });
});

test('line 23 books to October: card 1007 is absent from September and opens October', async () => {
  const sep = (await getReport(h.baseUrl, '2026-09')).json;
  const oct = (await getReport(h.baseUrl, '2026-10')).json;
  const s3 = (r: any) => r.stores.find((s: any) => s.store_id === 's3');
  expect(s3(sep).closing_minor).toBe(3500);
  expect(s3(oct)).toMatchObject({ opening_minor: 3500, closing_minor: 6000, movements_minor: { ...ZERO, issue: 2500 } });
  expect(oct.group).toMatchObject({ opening_minor: 16700, closing_minor: 19200 });
});

test('October still carries the overdrawn and expired balances, with no new refusals or intercompany', async () => {
  const { json } = await getReport(h.baseUrl, '2026-10');
  expect(json.flags.overdrawn_cards.map((c: any) => c.card_number)).toEqual(['6036280000001005']);
  expect(json.flags.expired_with_balance.map((c: any) => c.card_number)).toEqual(['6036280000001002']);
  expect(json.flags.intercompany).toEqual([]);
  expect(json.flags.refused_movements).toEqual([]);
});

test('a month with no activity reports zeros', async () => {
  const { json } = await getReport(h.baseUrl, '2020-01');
  expect(json.group).toMatchObject({ opening_minor: 0, closing_minor: 0, movements_minor: ZERO });
});

test('the cached balance equals the ledger sum for every card after the replay', async () => {
  const { rows } = await h.pool.query(
    `SELECT card_number FROM cards c
     WHERE c.balance_minor <> (SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE card_id = c.card_id)`);
  expect(rows).toEqual([]);
  expect(Number((await h.pool.query('SELECT count(*) FROM cards')).rows[0].count)).toBe(8);
});

test.each(['', '2026-13', '2026-00', '2026-9', '2026-09-01', 'september', '26-09'])('month "%s" is a 400 invalid_month', async (month) => {
  const res = await getReport(h.baseUrl, month);
  expect(res.status).toBe(400);
  expect(res.json).toEqual({ error: { code: 'invalid_month', message: expect.any(String) } });
});

test('a missing month is a 400 invalid_month', async () => {
  const res = await fetch(`${h.baseUrl}/reports/liability`);
  expect(res.status).toBe(400);
  expect((await res.json()).error.code).toBe('invalid_month');
});
