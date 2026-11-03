import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script without type declarations
import { hashPassword } from '../../scripts/hash-password.mjs';
import { isLegacyHash, verifyPassword } from './password';

describe('verifyPassword', () => {
  it('accepts the hash-password script output for the right password only', () => {
    const stored = hashPassword('correct horse');
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPassword('correct horse', stored)).toBe(true);
    expect(verifyPassword('wrong horse', stored)).toBe(false);
  });

  it('still accepts a legacy SHA-256 hash setting', () => {
    const legacy = createHash('sha256').update('pw').digest('hex');
    expect(isLegacyHash(legacy)).toBe(true);
    expect(verifyPassword('pw', legacy)).toBe(true);
    expect(verifyPassword('nope', legacy)).toBe(false);
  });

  it('rejects malformed settings', () => {
    expect(verifyPassword('pw', '')).toBe(false);
    expect(verifyPassword('pw', 'bcrypt$aa$bb')).toBe(false);
  });
});
