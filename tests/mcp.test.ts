import { Pool } from 'pg';
import { Harness, startHarness, getReport } from './harness';
import { liabilityReport } from '../src/report';
import { liabilityReportTool } from '../src/mcp/tool';
import { replayFixtures } from '../src/replay';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await replayFixtures(h.baseUrl);
});
afterAll(async () => { await h.stop(); });

const readOnly = () => new Pool({ connectionString: h.readOnlyUrl });

test('the handler returns exactly the report the HTTP endpoint returns', async () => {
  const { json } = await getReport(h.baseUrl, '2026-09');
  expect(await liabilityReportTool(h.pool, { month: '2026-09' })).toEqual(json);
});

test('an omitted store returns the whole group', async () => {
  const report = await liabilityReportTool(h.pool, { month: '2026-09' });
  expect(report.stores.map((s) => s.store_id)).toEqual(['s1', 's2', 's3']);
  expect(report.group.closing_minor).toBe(16700);
});

test('a known store returns only that store, with no card-level flags', async () => {
  const report = await liabilityReportTool(h.pool, { month: '2026-09', store_id: 's2' });
  expect(report.stores.map((s) => s.store_id)).toEqual(['s2']);
  expect(report.stores[0].closing_minor).toBe(2500);
  expect(report.group.closing_minor).toBe(2500);
  expect(report.flags.overdrawn_cards).toEqual([]);
  expect(report.flags.expired_with_balance).toEqual([]);
  expect(report.flags.refused_movements).toEqual([]);
  // The overdrawn card is still counted where it belongs, in the store's excluded total.
  expect(report.group.overdrawn_excluded_minor.closing).toBe(1000);
});

test('a store-scoped report keeps the intercompany rows that involve that store', async () => {
  const s2 = await liabilityReportTool(h.pool, { month: '2026-09', store_id: 's2' });
  expect(s2.flags.intercompany).toEqual([
    { owes: 's1', owed_to: 's2', amount_minor: 3000 },
    { owes: 's2', owed_to: 's1', amount_minor: 6500 },
  ]);
});

test('a store with no cards is still a valid, empty report', async () => {
  const report = await liabilityReportTool(h.pool, { month: '2020-01', store_id: 's3' });
  expect(report.stores.map((s) => s.store_id)).toEqual(['s3']);
  expect(report.group.closing_minor).toBe(0);
});

test('an unknown store is refused, not answered with an empty report', async () => {
  await expect(liabilityReportTool(h.pool, { month: '2026-09', store_id: 's9' }))
    .rejects.toMatchObject({ status: 404, code: 'unknown_store' });
});

test.each(['', '2026-13', '2026-00', '2026-9', '2026-09-01', 'september', '26-09', null, 202609, {}])(
  'month %p is refused as invalid_month',
  async (month) => {
    await expect(liabilityReportTool(h.pool, { month })).rejects.toMatchObject({ status: 400, code: 'invalid_month' });
  },
);

test('a store_id that is not a string is refused', async () => {
  await expect(liabilityReportTool(h.pool, { month: '2026-09', store_id: 7 }))
    .rejects.toMatchObject({ status: 400, code: 'invalid_store_id' });
});

test('the read-only role can read the report', async () => {
  const pool = readOnly();
  try {
    expect((await liabilityReport(pool, '2026-09')).group.closing_minor).toBe(16700);
  } finally {
    await pool.end();
  }
});

test('the read-only role is refused every kind of write by Postgres itself', async () => {
  const pool = readOnly();
  try {
    const writes = [
      `INSERT INTO cards (card_number, pin_hash, issuing_store_id, expires_at) VALUES ('9999', 'x', 's1', now())`,
      `INSERT INTO ledger_entries (card_id, kind, amount_minor, occurred_at, store_id) VALUES (1, 'reload', 100, now(), 's1')`,
      `UPDATE cards SET balance_minor = 0`,
      `DELETE FROM ledger_entries`,
      `INSERT INTO refused_movements (card_id, store_id, amount_minor, code, occurred_at, idempotency_key, request_fingerprint) VALUES (1,'s1',1,'x',now(),'k','f')`,
      `UPDATE idempotency_keys SET response_body = '{}'`,
      `CREATE TABLE sneaky (x int)`,
    ];
    for (const sql of writes) {
      await expect(pool.query(sql)).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|42P01)$/) });
    }
  } finally {
    await pool.end();
  }
});
