import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { Conflict, errorBody, HttpError } from './errors';
import { keyedPinHash } from './pin';

export interface WriteRequest {
  key: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export interface WriteResult {
  status: number;
  body: unknown;
}

export interface StoredResponse {
  status: number;
  body: string;
}

/** What the caller wants recorded alongside an idempotent write. */
export interface WriteHooks {
  /** Audit a request whose Idempotency Key was reused for a different body. */
  onConflict?: (client: PoolClient, fingerprint: string) => Promise<void>;
  /** Record a refusal, if this kind of refusal is one the caller wants kept. */
  onRefusal?: (client: PoolClient, err: HttpError, key: string, fingerprint: string) => Promise<void>;
}

/**
 * Runs `write` at most once per Idempotency Key, in one transaction with the stored outcome.
 *
 * Same key and fingerprint: replays the stored status and body verbatim, refusals included.
 * Same key, different fingerprint: 409 idempotency_conflict; the second request is not applied.
 * An HttpError thrown by `write` is a refusal: its writes are rolled back, the refusal is stored.
 */
export async function idempotent(
  pool: Pool,
  req: WriteRequest,
  write: (client: PoolClient) => Promise<WriteResult>,
  hooks?: WriteHooks,
): Promise<StoredResponse> {
  const fp = await fingerprint(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A concurrent holder of the same key makes this wait until it commits, then do nothing.
    const claimed = await client.query(
      `INSERT INTO idempotency_keys (key, fingerprint) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [req.key, fp],
    );
    if (claimed.rowCount === 0) {
      await client.query('COMMIT');
      return replay(client, req.key, fp, hooks);
    }

    await client.query('SAVEPOINT write');
    let result: WriteResult;
    try {
      result = await write(client);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      await client.query('ROLLBACK TO SAVEPOINT write');
      await hooks?.onRefusal?.(client, err, req.key, fp);
      result = { status: err.status, body: errorBody(err) };
    }
    const stored = { status: result.status, body: JSON.stringify(result.body) };
    await client.query(
      `UPDATE idempotency_keys SET status_code = $2, response_body = $3 WHERE key = $1`,
      [req.key, stored.status, stored.body],
    );
    await client.query('COMMIT');
    return stored;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function replay(client: PoolClient, key: string, fp: string, hooks?: WriteHooks): Promise<StoredResponse> {
  const { rows: [row] } = await client.query(
    `SELECT fingerprint, status_code, response_body FROM idempotency_keys WHERE key = $1`,
    [key],
  );
  if (row.fingerprint !== fp) {
    await hooks?.onConflict?.(client, fp);
    throw new Conflict('idempotency_conflict', `Idempotency-Key ${key} was already used for a different request`);
  }
  return { status: row.status_code, body: row.response_body };
}

/** sha256 over method, path and canonical body. The PIN enters only as a hash salted by the key. */
async function fingerprint(req: WriteRequest): Promise<string> {
  const body = { ...req.body };
  if (typeof body.pin === 'string') body.pin = await keyedPinHash(body.pin, `idempotency:${req.key}`);
  return createHash('sha256').update(`${req.method}\n${req.path}\n${canonicalJson(body)}`).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
