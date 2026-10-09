import express, { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';
import { errorBody, HttpError } from '../errors';
import { getCard, issueCard } from '../ledger';

export function createApp(pool: Pool) {
  const app = express();
  app.use(express.json());

  app.post('/cards/issue', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const card = await issueCard(client, req.body);
      await client.query('COMMIT');
      res.status(201).json(card);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  app.get('/cards/:card_number/balance', async (req, res) => {
    res.json(await getCard(pool, req.params.card_number));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(errorBody(err));
      return;
    }
    console.error(err instanceof Error ? err.message : 'unexpected error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  return app;
}
