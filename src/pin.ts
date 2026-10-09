import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Salted scrypt hash, stored as `scrypt$<salt hex>$<hash hex>`. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length), expected);
}
