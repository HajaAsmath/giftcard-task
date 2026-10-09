import { Request } from 'express';
import { BadRequest } from '../errors';

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
