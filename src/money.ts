import { BadRequest } from './errors';

/** Parses a decimal string such as "8.29" into integer cents. Never uses floating point. */
export function parseAmountToCents(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) throw new BadRequest('invalid_amount', `Not a valid amount: ${raw}`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new BadRequest('invalid_amount', `Amount is too large: ${raw}`);
  return cents;
}
