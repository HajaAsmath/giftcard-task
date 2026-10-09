import { PoolClient, Pool } from 'pg';
import { BadRequest, Conflict, NotFound } from './errors';
import { hashPin } from './pin';

export interface IssueInput {
  card_number: string;
  pin: string;
  store_id: string;
  amount_minor: number;
  occurred_at: string;
}

export interface CardView {
  card_number: string;
  issuing_store_id: string;
  balance_minor: number;
  currency: string;
  expires_at: string;
}

/** Creates the card and its opening issue entry. Runs inside the caller's transaction. */
export async function issueCard(client: PoolClient, input: IssueInput): Promise<CardView> {
  const cardNumber = normaliseCardNumber(input.card_number);
  const { rows: [card] } = await client.query(
    // Expiry: end of the local date 36 months after the local sale date, on the issuing store's clock (ADR 0002).
    // Postgres month arithmetic clamps 29 Feb to 28 Feb.
    `INSERT INTO cards (card_number, pin_hash, issuing_store_id, expires_at)
     SELECT $1, $2, s.store_id,
            ((date_trunc('day', $4::timestamptz AT TIME ZONE s.timezone) + interval '36 months' + interval '1 day')
              AT TIME ZONE s.timezone) - interval '1 millisecond'
     FROM stores s WHERE s.store_id = $3
     RETURNING card_id`,
    [cardNumber, hashPin(input.pin), input.store_id, input.occurred_at],
  ).catch((err) => {
    if (err.code === '23505') throw new Conflict('card_exists', `Gift card ${cardNumber} was already issued`);
    throw err;
  });
  if (!card) throw new BadRequest('unknown_store', `No store ${input.store_id}`);
  await client.query(
    `INSERT INTO ledger_entries (card_id, kind, amount_minor, occurred_at, store_id)
     VALUES ($1, 'issue', $2, $3, $4)`,
    [card.card_id, input.amount_minor, input.occurred_at, input.store_id],
  );
  await recomputeBalance(client, card.card_id);
  return readCard(client, cardNumber);
}

export async function getCard(db: Pool | PoolClient, cardNumber: string): Promise<CardView> {
  return readCard(db, normaliseCardNumber(cardNumber));
}

/** The same card arrives with and without spaces. */
export function normaliseCardNumber(raw: string): string {
  return raw.replace(/ /g, '');
}

async function recomputeBalance(client: PoolClient, cardId: string): Promise<void> {
  await client.query(
    `UPDATE cards SET balance_minor = (SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE card_id = $1)
     WHERE card_id = $1`,
    [cardId],
  );
}

async function readCard(db: Pool | PoolClient, cardNumber: string): Promise<CardView> {
  const { rows: [row] } = await db.query(
    `SELECT c.card_number, c.issuing_store_id, c.balance_minor::int AS balance_minor, s.currency,
            to_char(c.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
     FROM cards c JOIN stores s ON s.store_id = c.issuing_store_id
     WHERE c.card_number = $1`,
    [cardNumber],
  );
  if (!row) throw new NotFound('card_not_found', `No gift card ${cardNumber}`);
  return row;
}
