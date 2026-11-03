import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * AUTH_PASSWORD_HASH format: `scrypt$<salt hex>$<key hex>` (N=16384, r=8, p=1, 64-byte key), as
 * produced by `npm run hash-password`. The older bare SHA-256 hex is still accepted so an
 * existing deploy keeps working until the setting is replaced.
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

function equalBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isLegacyHash(stored: string): boolean {
  return /^[0-9a-f]{64}$/i.test(stored);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (isLegacyHash(stored)) {
    const hash = createHash('sha256').update(password).digest();
    return equalBytes(hash, Buffer.from(stored, 'hex'));
  }
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH, SCRYPT_PARAMS);
  return equalBytes(key, Buffer.from(keyHex, 'hex'));
}
