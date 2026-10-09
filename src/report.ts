import { Pool, PoolClient } from 'pg';
import { BadRequest, NotFound } from './errors';

export const KINDS = ['issue', 'reload', 'redeem', 'reverse', 'offline_redeem'] as const;
export type Kind = typeof KINDS[number];
export type Movements = Record<Kind, number>;

export interface StoreLiability {
  store_id: string;
  name: string;
  legal_entity: string;
  period_start: string;
  period_end: string;
  opening_minor: number;
  movements_minor: Movements;
  overdrawn_excluded_minor: { opening: number; closing: number };
  closing_minor: number;
}

export interface LiabilityReport {
  month: string;
  currency: string;
  stores: StoreLiability[];
  group: Omit<StoreLiability, 'store_id' | 'name' | 'legal_entity' | 'period_start' | 'period_end'>;
  flags: {
    overdrawn_cards: { card_number: string; store_id: string; balance_minor: number; cause: string }[];
    expired_with_balance: { card_number: string; store_id: string; balance_minor: number; expired_at: string }[];
    intercompany: { owes: string; owed_to: string; amount_minor: number }[];
    refused_movements: { card_number: string; store_id: string; amount_minor: number; code: string }[];
  };
}

export function parseMonth(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    throw new BadRequest('invalid_month', 'month must be YYYY-MM, for example 2026-09');
  }
  return raw;
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

// Every ledger entry, tagged with the local calendar month of the store that performed it (ADR 0002).
const ENTRIES = `
  entries AS (
    SELECT le.entry_id, le.card_id, le.kind, le.amount_minor, le.occurred_at, le.redemption_ref, le.terminal_id,
           le.store_id AS performing_store_id, c.issuing_store_id, c.card_number,
           to_char(le.occurred_at AT TIME ZONE ps.timezone, 'YYYY-MM') AS month
    FROM ledger_entries le
    JOIN cards c ON c.card_id = le.card_id
    JOIN stores ps ON ps.store_id = le.store_id
  )`;

const CLOSING = `
  closing AS (
    SELECT card_id, SUM(amount_minor) AS balance FROM entries WHERE month <= $1 GROUP BY card_id
  )`;

/**
 * Point-in-time liability for one month, by issuing store, from ledger entries by occurred_at.
 * With a store id, the same report is scoped to that store and its card-level flags are left out.
 */
export async function liabilityReport(db: Pool | PoolClient, rawMonth: unknown, storeId?: string): Promise<LiabilityReport> {
  const month = parseMonth(rawMonth);
  if (storeId !== undefined) {
    const { rowCount } = await db.query('SELECT 1 FROM stores WHERE store_id = $1', [storeId]);
    if (!rowCount) throw new NotFound('unknown_store', `No store ${storeId}`);
  }
  if (db instanceof Pool) {
    const client = await db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const report = await build(client, month, storeId);
      await client.query('COMMIT');
      return report;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return build(db, month, storeId);
}

async function build(db: PoolClient | Pool, month: string, storeId?: string): Promise<LiabilityReport> {
  const q = async (sql: string) => (await db.query(sql, [month])).rows;

  const stores = await q(
    `SELECT store_id, name, legal_entity, currency,
            to_char((($1::text || '-01')::date::timestamp AT TIME ZONE timezone) AT TIME ZONE 'UTC', ${ISO}) AS period_start,
            to_char(((((($1::text || '-01')::date + interval '1 month')::timestamp AT TIME ZONE timezone) - interval '1 millisecond')) AT TIME ZONE 'UTC', ${ISO}) AS period_end
     FROM stores ORDER BY store_id`);

  // Liability counts positive balances only; an overdrawn card is excluded and reported separately.
  const balances = await q(
    `WITH ${ENTRIES}, per_card AS (
       SELECT issuing_store_id,
              COALESCE(SUM(amount_minor) FILTER (WHERE month < $1), 0) AS opening,
              COALESCE(SUM(amount_minor) FILTER (WHERE month <= $1), 0) AS closing
       FROM entries GROUP BY card_id, issuing_store_id)
     SELECT issuing_store_id AS store_id,
            SUM(GREATEST(opening, 0))::text AS opening, SUM(GREATEST(-opening, 0))::text AS opening_overdrawn,
            SUM(GREATEST(closing, 0))::text AS closing, SUM(GREATEST(-closing, 0))::text AS closing_overdrawn
     FROM per_card GROUP BY issuing_store_id`);

  const movements = await q(
    `WITH ${ENTRIES}
     SELECT issuing_store_id AS store_id, kind, SUM(amount_minor)::text AS total
     FROM entries WHERE month = $1 GROUP BY issuing_store_id, kind`);

  // The cause of an overdrawn card is the entry that took it below zero for the last time.
  const overdrawn = await q(
    `WITH ${ENTRIES}, ${CLOSING}, running AS (
       SELECT e.*, SUM(e.amount_minor) OVER w AS running, ROW_NUMBER() OVER w AS rn
       FROM entries e WHERE e.month <= $1
       WINDOW w AS (PARTITION BY e.card_id ORDER BY e.occurred_at, e.entry_id)
     ), last_ok AS (
       SELECT card_id, COALESCE(MAX(rn) FILTER (WHERE running >= 0), 0) AS rn FROM running GROUP BY card_id
     )
     SELECT r.card_number, r.issuing_store_id AS store_id, cl.balance::text AS balance,
            r.kind, r.redemption_ref, r.terminal_id, r.performing_store_id
     FROM running r
     JOIN last_ok lo ON lo.card_id = r.card_id AND r.rn = lo.rn + 1
     JOIN closing cl ON cl.card_id = r.card_id
     WHERE cl.balance < 0
     ORDER BY r.card_number`);

  const expired = await q(
    `WITH ${ENTRIES}, ${CLOSING}
     SELECT c.card_number, c.issuing_store_id AS store_id, cl.balance::text AS balance,
            to_char(c.expires_at AT TIME ZONE 'UTC', ${ISO}) AS expired_at
     FROM closing cl
     JOIN cards c ON c.card_id = cl.card_id
     JOIN stores s ON s.store_id = c.issuing_store_id
     WHERE cl.balance > 0
       AND c.expires_at <= ((($1::text || '-01')::date + interval '1 month')::timestamp AT TIME ZONE s.timezone) - interval '1 millisecond'
     ORDER BY c.card_number`);

  // Cross-store spending: the issuing store owes the store that took the redemption. A reversal gives it back.
  const intercompany = await q(
    `WITH ${ENTRIES}
     SELECT issuing_store_id AS owes, performing_store_id AS owed_to, SUM(-amount_minor)::text AS amount
     FROM entries
     WHERE month = $1 AND performing_store_id <> issuing_store_id AND kind IN ('redeem', 'offline_redeem', 'reverse')
     GROUP BY issuing_store_id, performing_store_id
     HAVING SUM(-amount_minor) <> 0
     ORDER BY issuing_store_id, performing_store_id`);

  // No redemption_ref here, so the report is the same whichever of two racing requests loses.
  const refused = await q(
    `SELECT c.card_number, r.store_id, r.amount_minor::text AS amount, r.code
     FROM refused_movements r
     JOIN cards c ON c.card_id = r.card_id
     JOIN stores ps ON ps.store_id = r.store_id
     WHERE to_char(r.occurred_at AT TIME ZONE ps.timezone, 'YYYY-MM') = $1
     ORDER BY r.occurred_at, c.card_number, r.store_id, r.amount_minor, r.code`);

  const zero = (): Movements => ({ issue: 0, reload: 0, redeem: 0, reverse: 0, offline_redeem: 0 });
  const storeRows: StoreLiability[] = stores.filter((s) => storeId === undefined || s.store_id === storeId).map((s) => {
    const b = balances.find((r) => r.store_id === s.store_id);
    const m = zero();
    for (const row of movements.filter((r) => r.store_id === s.store_id)) m[row.kind as Kind] = Number(row.total);
    return {
      store_id: s.store_id, name: s.name, legal_entity: s.legal_entity, period_start: s.period_start, period_end: s.period_end,
      opening_minor: Number(b?.opening ?? 0), movements_minor: m,
      overdrawn_excluded_minor: { opening: Number(b?.opening_overdrawn ?? 0), closing: Number(b?.closing_overdrawn ?? 0) },
      closing_minor: Number(b?.closing ?? 0),
    };
  });

  const group = {
    opening_minor: sum(storeRows.map((s) => s.opening_minor)),
    movements_minor: Object.fromEntries(KINDS.map((k) => [k, sum(storeRows.map((s) => s.movements_minor[k]))])) as Movements,
    overdrawn_excluded_minor: {
      opening: sum(storeRows.map((s) => s.overdrawn_excluded_minor.opening)),
      closing: sum(storeRows.map((s) => s.overdrawn_excluded_minor.closing)),
    },
    closing_minor: sum(storeRows.map((s) => s.closing_minor)),
  };

  // A store-scoped report names no other store's cards, and keeps only its own intercompany rows.
  const cardLevel = <T>(rows: T[]) => (storeId === undefined ? rows : []);
  return {
    month,
    currency: stores[0]?.currency ?? 'AUD',
    stores: storeRows,
    group,
    flags: {
      overdrawn_cards: cardLevel(overdrawn.map((r) => ({
        card_number: r.card_number, store_id: r.store_id, balance_minor: Number(r.balance), cause: causeOf(r),
      }))),
      expired_with_balance: cardLevel(expired.map((r) => ({
        card_number: r.card_number, store_id: r.store_id, balance_minor: Number(r.balance), expired_at: r.expired_at,
      }))),
      intercompany: intercompany
        .filter((r) => storeId === undefined || r.owes === storeId || r.owed_to === storeId)
        .map((r) => ({ owes: r.owes, owed_to: r.owed_to, amount_minor: Number(r.amount) })),
      refused_movements: cardLevel(refused.map((r) => ({
        card_number: r.card_number, store_id: r.store_id, amount_minor: Number(r.amount), code: r.code,
      }))),
    },
  };
}

function causeOf(r: { kind: string; redemption_ref: string | null; terminal_id: string | null; performing_store_id: string }): string {
  const what = r.redemption_ref ? `${r.kind} ${r.redemption_ref}` : r.kind;
  const from = r.terminal_id ? ` from terminal ${r.terminal_id}` : '';
  return `${what}${from} at ${r.performing_store_id} took the balance below zero`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
