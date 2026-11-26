/**
 * Encrypts secrets kept in the database (authenticator keys) with AES-256-GCM and a key held only
 * in the deployment's environment (MFA_ENCRYPTION_KEY), so a copy of the database alone can't
 * make sign-in codes. Each secret is bound to its user (as authenticated data): a sealed secret
 * moved to another user's row won't open.
 * Format: v1.<iv>.<tag>.<ciphertext>, each base64url.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptionKey(raw = process.env.MFA_ENCRYPTION_KEY): Buffer {
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes in base64 (e.g. openssl rand -base64 32)');
  return key;
}

export function seal(plain: string, key: Buffer, boundTo: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(boundTo, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** Throws if the key is wrong, the secret was changed, or it belongs to someone else. */
export function open(sealed: string, key: Buffer, boundTo: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('not a sealed secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(boundTo, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
