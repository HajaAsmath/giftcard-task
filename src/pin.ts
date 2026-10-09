import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Async so hashing runs on the libuv threadpool instead of blocking the event loop.
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer | string, keylen: number) => Promise<Buffer>;

/** Salted scrypt hash, stored as `scrypt$<salt hex>$<hash hex>`. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scryptAsync(pin, salt, 32)).toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(await scryptAsync(pin, Buffer.from(saltHex, 'hex'), expected.length), expected);
}

/** A PIN hash salted by an arbitrary string, for fingerprints that must be stable across retries. */
export async function keyedPinHash(pin: string, salt: string): Promise<string> {
  return (await scryptAsync(pin, salt, 32)).toString('hex');
}
