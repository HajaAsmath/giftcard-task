import { getReport, withHarness } from './harness';
import { readFixtureLines, replayFixtures } from '../src/replay';

const counts = async (pool: import('pg').Pool) =>
  (await pool.query(
    `SELECT (SELECT count(*) FROM ledger_entries)::int AS ledger, (SELECT count(*) FROM refused_movements)::int AS refused,
            (SELECT count(*) FROM cards)::int AS cards, (SELECT count(*) FROM idempotency_keys)::int AS keys`)).rows[0];

test('replaying the whole fixture twice leaves the report, the ledger and the refusals unchanged', () =>
  withHarness(async (h) => {
    await replayFixtures(h.baseUrl);
    const reportAfterFirst = (await getReport(h.baseUrl, '2026-09')).json;
    const countsAfterFirst = await counts(h.pool);
    // 8 issues + 7 redeems (lines 2, 5, 9, one of 11/12, 13, 16, 18) + 1 reverse + 2 offline + 1 reload = 19 entries.
    // 3 refused movements (loser of 11/12, line 15, line 19); 20 distinct Idempotency Keys.
    expect(countsAfterFirst).toEqual({ ledger: 19, refused: 3, cards: 8, keys: 20 });

    const second = await replayFixtures(h.baseUrl);
    expect((await getReport(h.baseUrl, '2026-09')).json).toEqual(reportAfterFirst);
    expect(await counts(h.pool)).toEqual(countsAfterFirst);
    expect(second.filter((r) => r.status >= 500)).toEqual([]);
  }));

test('the report is identical whichever of lines 11 and 12 loses the race', async () => {
  const lines = readFixtureLines().map(({ concurrent_group, ...rest }) => rest); // sequential, so the order decides the winner
  const [l11, l12] = [lines[10], lines[11]];
  const run = (order: typeof lines) =>
    withHarness(async (h) => {
      const results = await replayFixtures(h.baseUrl, order);
      return { report: (await getReport(h.baseUrl, '2026-09')).json, results };
    });

  const line11Wins = await run(lines);
  const line12Wins = await run([...lines.slice(0, 10), l12, l11, ...lines.slice(12)]);

  expect(line11Wins.results[10].status).toBe(201); // line 11 first, so it wins
  expect(line12Wins.results[10].status).toBe(201); // line 12 first, so it wins
  expect(line11Wins.results[11].status).toBe(422);
  expect(line12Wins.results[11].status).toBe(422);
  expect(line12Wins.report).toEqual(line11Wins.report);
  expect(line11Wins.report.flags.refused_movements).toContainEqual(
    { card_number: '6036280000001003', store_id: 's3', amount_minor: 2000, code: 'insufficient_funds' });
});
