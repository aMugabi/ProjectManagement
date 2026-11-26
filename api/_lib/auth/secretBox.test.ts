import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptionKey, open, seal } from './secretBox';

const key = randomBytes(32);

describe('secretBox', () => {
  it('opens what it sealed, for the same user and key', () => {
    const sealed = seal('JBSWY3DPEHPK3PXP', key, 'user-1');
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain('JBSWY3DP');
    expect(open(sealed, key, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('seals the same secret differently each time', () => {
    expect(seal('same', key, 'u')).not.toBe(seal('same', key, 'u'));
  });

  it("won't open with another key, for another user, or after any change", () => {
    const sealed = seal('secret', key, 'user-1');
    expect(() => open(sealed, randomBytes(32), 'user-1')).toThrow();
    expect(() => open(sealed, key, 'user-2')).toThrow();
    const [v, iv, tag, body] = sealed.split('.');
    const flipped = body[0] === 'A' ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    expect(() => open([v, iv, tag, flipped].join('.'), key, 'user-1')).toThrow();
    expect(() => open('plain text', key, 'user-1')).toThrow('not a sealed secret');
  });

  it('needs a 32-byte key', () => {
    expect(encryptionKey(key.toString('base64'))).toEqual(key);
    expect(() => encryptionKey(undefined)).toThrow('MFA_ENCRYPTION_KEY');
    expect(() => encryptionKey(randomBytes(16).toString('base64'))).toThrow('32 random bytes');
  });
});
