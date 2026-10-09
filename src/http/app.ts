import express, { NextFunction, Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { errorBody, HttpError } from '../errors';
import { getCard, issueCard, recordConflictingRedemption, recordOfflineBatch, redeemOnline, reloadCard, reverseRedemption } from '../ledger';
import { idempotent, WriteResult } from '../idempotency';
import { liabilityReport } from '../report';
import * as v from './validate';

export function createApp(pool: Pool) {
  const app = express();
  app.use(express.json());

  app.post('/cards/issue', writeRoute(pool, (b) => ({
    card_number: v.cardNumber(b), pin: v.pin(b), store_id: v.storeId(b),
    amount_minor: v.amountMinor(b), occurred_at: v.occurredAt(b),
  }), async (client, input) => ({ status: 201, body: await issueCard(client, input) })));

  app.post('/redemptions', writeRoute(pool, (b) => ({
    card_number: v.cardNumber(b), pin: v.pin(b), store_id: v.storeId(b), amount_minor: v.amountMinor(b),
    redemption_ref: v.redemptionRef(b), occurred_at: v.occurredAt(b),
  }), async (client, input) => ({ status: 201, body: await redeemOnline(client, input) }),
  (client, input, key, fp) => recordConflictingRedemption(client, input, key, fp)));

  app.post('/cards/reload', writeRoute(pool, (b) => ({
    card_number: v.cardNumber(b), store_id: v.storeId(b), amount_minor: v.amountMinor(b), occurred_at: v.occurredAt(b),
  }), async (client, input) => ({ status: 201, body: await reloadCard(client, input) })));

  app.post('/reversals', writeRoute(pool, (b) => {
    v.reason(b);
    return { redemption_ref: v.redemptionRef(b), occurred_at: v.occurredAt(b) };
  }, async (client, input) => ({ status: 201, body: await reverseRedemption(client, input) })));

  app.post('/offline-batches', writeRoute(pool, v.offlineBatch,
    async (client, input) => ({ status: 201, body: await recordOfflineBatch(client, input) })));

  app.get('/reports/liability', async (req, res) => {
    res.json(await liabilityReport(pool, req.query.month));
  });

  app.get('/cards/:card_number/balance', async (req, res) => {
    res.json(await getCard(pool, req.params.card_number));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(errorBody(err));
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'malformed_json', message: 'Request body is not valid JSON' } });
      return;
    }
    console.error(err instanceof Error ? err.message : 'unexpected error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  return app;
}

/** Parses the request, then runs `write` at most once per Idempotency Key. */
function writeRoute<I>(
  pool: Pool,
  parse: (body: Record<string, unknown>) => I,
  write: (client: PoolClient, input: I) => Promise<WriteResult>,
  onConflict?: (client: PoolClient, input: I, key: string, fingerprint: string) => Promise<void>,
) {
  return async (req: Request, res: Response) => {
    const key = v.idempotencyKey(req);
    const b = v.body(req);
    const input = parse(b);
    const out = await idempotent(
      pool,
      { key, method: req.method, path: req.path, body: b },
      (client) => write(client, input),
      onConflict && ((client, fp) => onConflict(client, input, key, fp)),
    );
    res.status(out.status).type('application/json').send(out.body);
  };
}
