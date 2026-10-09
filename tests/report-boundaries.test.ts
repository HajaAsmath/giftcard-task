import { freshIssue, freshRedeem, getReport, send, withHarness } from './harness';

const issueAt = (store: string, occurred_at: string, overrides: Record<string, unknown> = {}) =>
  freshIssue({ store_id: store, occurred_at, ...overrides });

const s1 = (report: any) => report.stores.find((s: any) => s.store_id === 's1');

test('the Sydney month ends at 13:59:59.999Z: one millisecond later is October', () =>
  withHarness(async (h) => {
    expect((await send(h.baseUrl, issueAt('s1', '2026-09-30T13:59:59.999Z'))).status).toBe(201);
    expect((await send(h.baseUrl, issueAt('s1', '2026-09-30T14:00:00.000Z'))).status).toBe(201);
    const sep = s1((await getReport(h.baseUrl, '2026-09')).json);
    const oct = s1((await getReport(h.baseUrl, '2026-10')).json);
    expect(sep).toMatchObject({ closing_minor: 10000, movements_minor: { issue: 10000 } });
    expect(oct).toMatchObject({ opening_minor: 10000, closing_minor: 20000, movements_minor: { issue: 10000 } });
  }));

test('after daylight saving starts the Sydney month ends one hour earlier, at 12:59:59.999Z on 31 October', () =>
  withHarness(async (h) => {
    expect((await send(h.baseUrl, issueAt('s1', '2026-10-31T12:59:59.999Z'))).status).toBe(201); // 23:59 AEDT, 31 Oct
    expect((await send(h.baseUrl, issueAt('s1', '2026-10-31T13:00:00.000Z'))).status).toBe(201); // 00:00 AEDT, 1 Nov
    const oct = (await getReport(h.baseUrl, '2026-10')).json;
    const nov = (await getReport(h.baseUrl, '2026-11')).json;
    expect(s1(oct)).toMatchObject({ closing_minor: 10000, period_end: '2026-10-31T12:59:59.999Z' });
    expect(s1(nov)).toMatchObject({ opening_minor: 10000, movements_minor: { issue: 10000 }, period_start: '2026-10-31T13:00:00.000Z' });
  }));

test('a movement is bucketed by the timezone of the store that performed it, read from the stores table', () =>
  withHarness(async (h) => {
    await h.pool.query(`UPDATE stores SET timezone = 'UTC' WHERE store_id = 's3'`);
    const card = issueAt('s1', '2026-08-01T00:00:00Z');
    expect((await send(h.baseUrl, card)).status).toBe(201);
    // 20:00Z on 30 September is 06:00 on 1 October in Sydney, but still 30 September in UTC.
    const spent = freshRedeem(card, 1000, { store_id: 's3', occurred_at: '2026-09-30T20:00:00Z' });
    expect((await send(h.baseUrl, spent)).status).toBe(201);
    const sep = (await getReport(h.baseUrl, '2026-09')).json;
    expect(s1(sep)).toMatchObject({ opening_minor: 10000, closing_minor: 9000, movements_minor: { redeem: -1000 } });
  }));

test('the report is a point in time by occurred_at: later movements do not change an earlier month', () =>
  withHarness(async (h) => {
    const card = issueAt('s1', '2026-08-01T00:00:00Z');
    expect((await send(h.baseUrl, card)).status).toBe(201);
    expect((await send(h.baseUrl, freshRedeem(card, 2500, { occurred_at: '2026-09-03T00:00:00Z' }))).status).toBe(201);
    const before = (await getReport(h.baseUrl, '2026-09')).json;
    expect(s1(before)).toMatchObject({ opening_minor: 10000, closing_minor: 7500 });

    // Recorded now, but it happened in October.
    expect((await send(h.baseUrl, freshRedeem(card, 1000, { occurred_at: '2026-10-05T00:00:00Z' }))).status).toBe(201);
    expect((await getReport(h.baseUrl, '2026-09')).json).toEqual(before);
    expect(s1((await getReport(h.baseUrl, '2026-10')).json)).toMatchObject({ opening_minor: 7500, closing_minor: 6500 });
  }));

test('a reversal returns value to the issuing store in the month it occurred', () =>
  withHarness(async (h) => {
    const card = issueAt('s1', '2026-08-01T00:00:00Z');
    await send(h.baseUrl, card);
    const spent = freshRedeem(card, 4000, { occurred_at: '2026-09-18T09:00:00Z' });
    await send(h.baseUrl, spent);
    await send(h.baseUrl, { method: 'POST', path: '/reversals', headers: { 'Idempotency-Key': 'k-rev-boundary' },
      body: { redemption_ref: (spent.body as any).redemption_ref, occurred_at: '2026-10-02T00:00:00Z' } });
    const sep = s1((await getReport(h.baseUrl, '2026-09')).json);
    const oct = s1((await getReport(h.baseUrl, '2026-10')).json);
    expect(sep).toMatchObject({ closing_minor: 6000, movements_minor: { redeem: -4000, reverse: 0 } });
    expect(oct).toMatchObject({ opening_minor: 6000, closing_minor: 10000, movements_minor: { redeem: 0, reverse: 4000 } });
  }));
