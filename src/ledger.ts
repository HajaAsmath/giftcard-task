import { PoolClient, Pool } from 'pg';
import { BadRequest, Conflict, HttpError, NotFound, Refused, RefusedMovement } from './errors';
import { hashPin, verifyPin } from './pin';

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
  const pinHash = await hashPin(input.pin);
  const { rows: [card] } = await client.query(
    // Expiry: end of the local date 36 months after the local sale date, on the issuing store's clock (ADR 0002).
    // Postgres month arithmetic clamps 29 Feb to 28 Feb.
    `INSERT INTO cards (card_number, pin_hash, issuing_store_id, expires_at)
     SELECT $1, $2, s.store_id,
            ((date_trunc('day', $4::timestamptz AT TIME ZONE s.timezone) + interval '36 months' + interval '1 day')
              AT TIME ZONE s.timezone) - interval '1 millisecond'
     FROM stores s WHERE s.store_id = $3
     RETURNING card_id`,
    [cardNumber, pinHash, input.store_id, input.occurred_at],
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

export interface RedeemInput {
  card_number: string;
  pin: string;
  store_id: string;
  amount_minor: number;
  redemption_ref: string;
  occurred_at: string;
}

export interface RedemptionView {
  card_number: string;
  redemption_ref: string;
  store_id: string;
  amount_minor: number;
  balance_minor: number;
  occurred_at: string;
}

/**
 * Online redemption. The guest is present, so the ledger can still refuse it.
 * Locks the card row, so two tills cannot spend the same balance.
 */
export async function redeemOnline(client: PoolClient, input: RedeemInput): Promise<RedemptionView> {
  await requireStore(client, input.store_id);
  const cardNumber = normaliseCardNumber(input.card_number);
  const { rows: [card] } = await client.query(
    `SELECT card_id, pin_hash, expires_at < $2::timestamptz AS expired
     FROM cards WHERE card_number = $1 FOR UPDATE`,
    [cardNumber, input.occurred_at],
  );
  if (!card) throw new NotFound('card_not_found', `No gift card ${cardNumber}`);
  if (!(await verifyPin(input.pin, card.pin_hash))) throw new HttpError(403, 'invalid_pin', 'Wrong PIN');

  const movement: RefusedMovement = {
    card_id: card.card_id, store_id: input.store_id, amount_minor: input.amount_minor, occurred_at: input.occurred_at,
  };
  if (card.expired) throw new Refused(422, 'card_expired', `Gift card ${cardNumber} had expired`, movement);
  const balance = await sumBalance(client, card.card_id);
  if (balance < input.amount_minor) {
    throw new Refused(422, 'insufficient_funds', `Balance ${balance} is less than ${input.amount_minor}`, movement);
  }

  await client.query(
    `INSERT INTO ledger_entries (card_id, kind, amount_minor, occurred_at, store_id, redemption_ref)
     VALUES ($1, 'redeem', $2, $3, $4, $5)`,
    [card.card_id, -input.amount_minor, input.occurred_at, input.store_id, input.redemption_ref],
  ).catch((err) => {
    if (err.code === '23505') throw new Conflict('duplicate_redemption_ref', `redemption_ref ${input.redemption_ref} was already used`);
    throw err;
  });
  await recomputeBalance(client, card.card_id);
  return {
    card_number: cardNumber, redemption_ref: input.redemption_ref, store_id: input.store_id,
    amount_minor: input.amount_minor, balance_minor: balance - input.amount_minor, occurred_at: input.occurred_at,
  };
}

/** Records a declined movement once per (Idempotency Key, request fingerprint). */
export async function recordRefusedMovement(
  client: PoolClient, movement: RefusedMovement, code: string, key: string, fingerprint: string,
): Promise<void> {
  await client.query(
    `INSERT INTO refused_movements (card_id, store_id, amount_minor, code, occurred_at, idempotency_key, request_fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key, request_fingerprint) DO NOTHING`,
    [movement.card_id, movement.store_id, movement.amount_minor, code, movement.occurred_at, key, fingerprint],
  );
}

/** Audit of a conflicting key reuse; nothing is recorded if the card or store is unknown. */
export async function recordConflictingRedemption(
  client: PoolClient, input: RedeemInput, key: string, fingerprint: string,
): Promise<void> {
  const { rows: [card] } = await client.query(`SELECT card_id FROM cards WHERE card_number = $1`, [normaliseCardNumber(input.card_number)]);
  const { rows: [store] } = await client.query(`SELECT 1 AS ok FROM stores WHERE store_id = $1`, [input.store_id]);
  if (!card || !store) return;
  await recordRefusedMovement(
    client,
    { card_id: card.card_id, store_id: input.store_id, amount_minor: input.amount_minor, occurred_at: input.occurred_at },
    'idempotency_conflict', key, fingerprint,
  );
}

async function requireStore(client: PoolClient, storeId: string): Promise<void> {
  const { rowCount } = await client.query(`SELECT 1 FROM stores WHERE store_id = $1`, [storeId]);
  if (!rowCount) throw new BadRequest('unknown_store', `No store ${storeId}`);
}

async function sumBalance(client: PoolClient, cardId: string): Promise<number> {
  const { rows: [row] } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::int AS balance FROM ledger_entries WHERE card_id = $1`, [cardId]);
  return row.balance;
}

export interface ReloadInput {
  card_number: string;
  store_id: string;
  amount_minor: number;
  occurred_at: string;
}

export interface ReloadView {
  card_number: string;
  store_id: string;
  amount_minor: number;
  balance_minor: number;
  occurred_at: string;
}

/** Adds value to an existing card. The issuing store and the stored expiry do not change. */
export async function reloadCard(client: PoolClient, input: ReloadInput): Promise<ReloadView> {
  await requireStore(client, input.store_id);
  const cardNumber = normaliseCardNumber(input.card_number);
  const { rows: [card] } = await client.query(`SELECT card_id FROM cards WHERE card_number = $1 FOR UPDATE`, [cardNumber]);
  if (!card) throw new NotFound('card_not_found', `No gift card ${cardNumber}`);
  await client.query(
    `INSERT INTO ledger_entries (card_id, kind, amount_minor, occurred_at, store_id) VALUES ($1, 'reload', $2, $3, $4)`,
    [card.card_id, input.amount_minor, input.occurred_at, input.store_id],
  );
  await recomputeBalance(client, card.card_id);
  return {
    card_number: cardNumber, store_id: input.store_id, amount_minor: input.amount_minor,
    balance_minor: await sumBalance(client, card.card_id), occurred_at: input.occurred_at,
  };
}

export interface ReverseInput {
  redemption_ref: string;
  occurred_at: string;
}

export interface ReversalView {
  redemption_ref: string;
  card_number: string;
  store_id: string;
  amount_minor: number;
  balance_minor: number;
  occurred_at: string;
}

/**
 * Undoes a redemption in full. The amount and the store come from the original entry, never from the caller.
 * A redemption can be reversed once.
 */
export async function reverseRedemption(client: PoolClient, input: ReverseInput): Promise<ReversalView> {
  const { rows: [original] } = await client.query(
    `SELECT e.entry_id, e.card_id, e.store_id, (-e.amount_minor)::int AS amount_minor, c.card_number
     FROM ledger_entries e JOIN cards c ON c.card_id = e.card_id
     WHERE e.redemption_ref = $1 AND e.kind IN ('redeem', 'offline_redeem')`,
    [input.redemption_ref],
  );
  if (!original) throw new NotFound('redemption_not_found', `No redemption ${input.redemption_ref}`);

  await client.query(`SELECT 1 FROM cards WHERE card_id = $1 FOR UPDATE`, [original.card_id]);
  const { rowCount: alreadyReversed } = await client.query(`SELECT 1 FROM ledger_entries WHERE reverses_entry_id = $1`, [original.entry_id]);
  if (alreadyReversed) throw new Conflict('already_reversed', `Redemption ${input.redemption_ref} was already reversed`);

  await client.query(
    `INSERT INTO ledger_entries (card_id, kind, amount_minor, occurred_at, store_id, reverses_entry_id)
     VALUES ($1, 'reverse', $2, $3, $4, $5)`,
    [original.card_id, original.amount_minor, input.occurred_at, original.store_id, original.entry_id],
  ).catch((err) => {
    if (err.code === '23505') throw new Conflict('already_reversed', `Redemption ${input.redemption_ref} was already reversed`);
    throw err;
  });
  await recomputeBalance(client, original.card_id);
  return {
    redemption_ref: input.redemption_ref, card_number: original.card_number, store_id: original.store_id,
    amount_minor: original.amount_minor, balance_minor: await sumBalance(client, original.card_id), occurred_at: input.occurred_at,
  };
}

export interface OfflineBatchInput {
  terminal_id: string;
  store_id: string;
  redemptions: { card_number: string; amount_minor: number; redemption_ref: string; occurred_at: string }[];
}

export interface OfflineBatchView {
  terminal_id: string;
  store_id: string;
  applied: number;
  cards: { card_number: string; balance_minor: number }[];
}

/**
 * Records redemptions a terminal already authorised. The guest has the goods, so nothing is refused:
 * no PIN, expiry or balance check, and a card may go negative. The whole batch commits or none of it does.
 */
export async function recordOfflineBatch(client: PoolClient, input: OfflineBatchInput): Promise<OfflineBatchView> {
  await requireStore(client, input.store_id);
  const items = input.redemptions
    .map((r, index) => ({ ...r, card_number: normaliseCardNumber(r.card_number), index, at: Date.parse(r.occurred_at) }))
    .sort((a, b) => a.at - b.at || a.index - b.index);

  // Lock every card in one global order (card number), so concurrent batches cannot deadlock.
  const cardIds = new Map<string, string>();
  for (const number of [...new Set(items.map((i) => i.card_number))].sort()) {
    const { rows: [card] } = await client.query(`SELECT card_id FROM cards WHERE card_number = $1 FOR UPDATE`, [number]);
    if (!card) throw new NotFound('card_not_found', `No gift card ${number}`);
    cardIds.set(number, card.card_id);
  }

  for (const item of items) {
    await client.query(
      `INSERT INTO ledger_entries (card_id, kind, amount_minor, occurred_at, store_id, redemption_ref, terminal_id)
       VALUES ($1, 'offline_redeem', $2, $3, $4, $5, $6)`,
      [cardIds.get(item.card_number), -item.amount_minor, item.occurred_at, input.store_id, item.redemption_ref, input.terminal_id],
    ).catch((err) => {
      if (err.code === '23505') throw new Conflict('duplicate_redemption_ref', `redemption_ref ${item.redemption_ref} was already used`);
      throw err;
    });
  }

  const cards: OfflineBatchView['cards'] = [];
  for (const [number, id] of cardIds) {
    await recomputeBalance(client, id);
    cards.push({ card_number: number, balance_minor: await sumBalance(client, id) });
  }
  return { terminal_id: input.terminal_id, store_id: input.store_id, applied: items.length, cards };
}
