import express, { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';
import { errorBody, HttpError } from '../errors';
import { getCard, issueCard } from '../ledger';
import { idempotent } from '../idempotency';
import * as v from './validate';

export function createApp(pool: Pool) {
  const app = express();
  app.use(express.json());

  app.post('/cards/issue', async (req, res) => {
    const key = v.idempotencyKey(req);
    const b = v.body(req);
    const input = {
      card_number: v.cardNumber(b), pin: v.pin(b), store_id: v.storeId(b),
      amount_minor: v.amountMinor(b), occurred_at: v.occurredAt(b),
    };
    const out = await idempotent(pool, { key, method: req.method, path: req.path, body: b }, async (client) => ({
      status: 201,
      body: await issueCard(client, input),
    }));
    res.status(out.status).type('application/json').send(out.body);
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
