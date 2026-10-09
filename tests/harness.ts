import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from '../src/migrate';
import { createApp } from '../src/http/app';

export interface Harness {
  baseUrl: string;
  pool: Pool;
  stop(): Promise<void>;
}

/** A fresh, migrated Postgres and the Express app listening on an ephemeral port. */
export async function startHarness(): Promise<Harness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(pool);
  const server: Server = createApp(pool).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pool,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
      await container.stop();
    },
  };
}

export interface FixtureRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fixture line N (1-based) from fixtures/requests.jsonl. */
export function fixtureLine(n: number): FixtureRequest {
  const lines = require('node:fs').readFileSync(`${__dirname}/../fixtures/requests.jsonl`, 'utf8').trim().split('\n');
  return JSON.parse(lines[n - 1]);
}

export async function send(baseUrl: string, req: FixtureRequest): Promise<{ status: number; text: string }> {
  const res = await fetch(baseUrl + req.path, {
    method: req.method,
    headers: { 'Content-Type': 'application/json', ...req.headers },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  });
  return { status: res.status, text: await res.text() };
}

export async function get(baseUrl: string, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(baseUrl + path);
  return { status: res.status, json: await res.json() };
}

let seq = 0;

/** An issue request for a card number and key no other test uses, so tests never share state. */
export function freshIssue(overrides: Record<string, unknown> = {}): FixtureRequest {
  seq += 1;
  const base = fixtureLine(3);
  const tag = String(seq).padStart(4, '0');
  return {
    ...base,
    headers: { 'Idempotency-Key': `k-fresh-${tag}` },
    body: { ...(base.body as object), card_number: `6036 2800 0001 ${tag}`, ...overrides },
  };
}

/** An online redemption for a card from `freshIssue`, with a key and redemption_ref no other test uses. */
export function freshRedeem(issue: FixtureRequest, amountMinor: number, overrides: Record<string, unknown> = {}): FixtureRequest {
  seq += 1;
  const tag = String(seq).padStart(4, '0');
  const b = issue.body as Record<string, unknown>;
  return {
    method: 'POST',
    path: '/redemptions',
    headers: { 'Idempotency-Key': `k-fresh-r-${tag}` },
    body: {
      card_number: b.card_number, pin: b.pin, store_id: b.store_id, amount_minor: amountMinor,
      redemption_ref: `rd-fresh-${tag}`, occurred_at: '2026-09-02T00:00:00Z', ...overrides,
    },
  };
}

/** A reload for a card from `freshIssue`, with a key no other test uses. */
export function freshReload(issue: FixtureRequest, amountMinor: number, overrides: Record<string, unknown> = {}): FixtureRequest {
  seq += 1;
  const tag = String(seq).padStart(4, '0');
  const b = issue.body as Record<string, unknown>;
  return {
    method: 'POST',
    path: '/cards/reload',
    headers: { 'Idempotency-Key': `k-fresh-rl-${tag}` },
    body: { card_number: b.card_number, store_id: b.store_id, amount_minor: amountMinor, occurred_at: '2026-09-03T00:00:00Z', ...overrides },
  };
}

/** A reversal of the redemption in `redeem`, with a key no other test uses. */
export function freshReverse(redeem: FixtureRequest, overrides: Record<string, unknown> = {}): FixtureRequest {
  seq += 1;
  const tag = String(seq).padStart(4, '0');
  return {
    method: 'POST',
    path: '/reversals',
    headers: { 'Idempotency-Key': `k-fresh-rv-${tag}` },
    body: { redemption_ref: (redeem.body as any).redemption_ref, reason: 'order refunded', occurred_at: '2026-09-04T00:00:00Z', ...overrides },
  };
}

export interface BatchItem {
  card: FixtureRequest;
  amount: unknown;
  occurred_at: string;
  redemption_ref?: string;
}

/** An offline batch for cards from `freshIssue`, with a key and redemption_refs no other test uses. */
export function freshBatch(items: BatchItem[], overrides: Record<string, unknown> = {}): FixtureRequest {
  seq += 1;
  const tag = String(seq).padStart(4, '0');
  return {
    method: 'POST',
    path: '/offline-batches',
    headers: { 'Idempotency-Key': `k-fresh-batch-${tag}` },
    body: {
      terminal_id: 't-test-01',
      store_id: 's1',
      redemptions: items.map((item, i) => ({
        card_number: (item.card.body as any).card_number,
        amount: item.amount,
        redemption_ref: item.redemption_ref ?? `rd-batch-${tag}-${i}`,
        order_ref: `o-batch-${tag}-${i}`,
        occurred_at: item.occurred_at,
      })),
      ...overrides,
    },
  };
}

export async function getReport(baseUrl: string, month: string) {
  return get(baseUrl, `/reports/liability?month=${encodeURIComponent(month)}`);
}

/** Runs `fn` against a fresh container, and always stops it. */
export async function withHarness<T>(fn: (h: Harness) => Promise<T>): Promise<T> {
  const h = await startHarness();
  try { return await fn(h); } finally { await h.stop(); }
}
