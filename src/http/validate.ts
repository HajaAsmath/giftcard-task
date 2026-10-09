import { Request } from 'express';
import { BadRequest } from '../errors';
import { parseAmountToCents } from '../money';

type Body = Record<string, unknown>;

export function idempotencyKey(req: Request): string {
  const key = req.get('Idempotency-Key');
  if (!key || !key.trim()) throw new BadRequest('missing_idempotency_key', 'Idempotency-Key header is required');
  return key;
}

export function body(req: Request): Body {
  if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
    throw new BadRequest('malformed_body', 'Request body must be a JSON object');
  }
  return req.body;
}

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A caller-reported business time; the server clock never stands in for it. */
export function occurredAt(b: Body): string {
  const raw = b.occurred_at;
  if (raw === undefined || raw === null) throw new BadRequest('missing_occurred_at', 'occurred_at is required');
  const m = typeof raw === 'string' ? ISO_INSTANT.exec(raw) : null;
  const [y, mo, d, hh, mi, ss] = (m ?? []).slice(1).map(Number);
  const day = m ? new Date(Date.UTC(y, mo - 1, d)) : null;
  if (!m || !day || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || hh > 23 || mi > 59 || (ss ?? 0) > 59) {
    throw new BadRequest('invalid_occurred_at', 'occurred_at must be an ISO 8601 instant with a UTC offset');
  }
  return raw as string;
}

export function amountMinor(b: Body): number {
  const v = b.amount_minor;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
    throw new BadRequest('invalid_amount', 'amount_minor must be a positive integer number of cents');
  }
  return v;
}

export function cardNumber(b: Body): string {
  const v = b.card_number;
  if (typeof v !== 'string' || !/^[\d ]+$/.test(v) || !/^\d{12,19}$/.test(v.replace(/ /g, ''))) {
    throw new BadRequest('invalid_card_number', 'card_number must be 12-19 digits, optionally with spaces');
  }
  return v;
}

export function pin(b: Body): string {
  const v = b.pin;
  if (typeof v !== 'string' || !/^\d{4}$/.test(v)) throw new BadRequest('invalid_pin', 'pin must be four digits');
  return v;
}

export function storeId(b: Body): string {
  const v = b.store_id;
  if (typeof v !== 'string' || !v) throw new BadRequest('invalid_store_id', 'store_id is required');
  return v;
}

export function redemptionRef(b: Body): string {
  const v = b.redemption_ref;
  if (typeof v !== 'string' || !v.trim() || v.length > 128) {
    throw new BadRequest('invalid_redemption_ref', 'redemption_ref must be a non-empty string');
  }
  return v;
}

/** Free-text reason; optional, not stored. */
export function reason(b: Body): string | undefined {
  const v = b.reason;
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > 500) throw new BadRequest('invalid_reason', 'reason must be a string of at most 500 characters');
  return v;
}

export interface OfflineRedemptionInput {
  card_number: string;
  amount_minor: number;
  redemption_ref: string;
  occurred_at: string;
}

export interface OfflineBatchInput {
  terminal_id: string;
  store_id: string;
  redemptions: OfflineRedemptionInput[];
}

const MAX_BATCH = 1000;

export function offlineBatch(b: Body): OfflineBatchInput {
  const terminal = b.terminal_id;
  if (typeof terminal !== 'string' || !terminal.trim() || terminal.length > 128) {
    throw new BadRequest('invalid_terminal_id', 'terminal_id must be a non-empty string');
  }
  const store = storeId(b);
  const list = b.redemptions;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH) {
    throw new BadRequest('invalid_batch', `redemptions must be a list of 1 to ${MAX_BATCH} items`);
  }
  const redemptions = list.map((item): OfflineRedemptionInput => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new BadRequest('invalid_batch', 'each redemption must be an object');
    }
    const r = item as Body;
    if (typeof r.amount !== 'string') throw new BadRequest('invalid_amount', 'amount must be a decimal string such as "8.29"');
    const cents = parseAmountToCents(r.amount);
    if (cents <= 0) throw new BadRequest('invalid_amount', 'amount must be greater than zero');
    return { card_number: cardNumber(r), amount_minor: cents, redemption_ref: redemptionRef(r), occurred_at: occurredAt(r) };
  });
  return { terminal_id: terminal, store_id: store, redemptions };
}
