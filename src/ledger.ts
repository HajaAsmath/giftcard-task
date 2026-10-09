import { PoolClient, Pool } from 'pg';
import { NotFound } from './errors';
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
}

/** Creates the card and its opening issue entry. Runs inside the caller's transaction. */
export async function issueCard(client: PoolClient, input: IssueInput): Promise<CardView> {
  const cardNumber = normaliseCardNumber(input.card_number);
  const { rows: [card] } = await client.query(
    `INSERT INTO cards (card_number, pin_hash, issuing_store_id) VALUES ($1, $2, $3) RETURNING card_id`,
    [cardNumber, hashPin(input.pin), input.store_id],
  );
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
    `SELECT c.card_number, c.issuing_store_id, c.balance_minor::int AS balance_minor, s.currency
     FROM cards c JOIN stores s ON s.store_id = c.issuing_store_id
     WHERE c.card_number = $1`,
    [cardNumber],
  );
  if (!row) throw new NotFound('card_not_found', `No gift card ${cardNumber}`);
  return row;
}
