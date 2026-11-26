import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script without type declarations
import { base32Encode, generateRecoveryCodes, generateSecret, hashRecoveryCode as scriptHash, totpAt } from '../../scripts/setup-mfa.mjs';
import { base32Decode, hashRecoveryCode, hotp, timeStep, verifyTotp } from './totp';

// RFC 6238 appendix B: SHA-1 key "12345678901234567890"; 8-digit codes at these times (seconds).
const RFC_KEY = Buffer.from('12345678901234567890');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, code] of RFC_VECTORS) {
      expect(hotp(RFC_KEY, timeStep(seconds * 1000), 8)).toBe(code);
      // 6-digit codes are the last six digits.
      expect(hotp(RFC_KEY, timeStep(seconds * 1000))).toBe(code.slice(2));
    }
  });

  it('decodes what the setup script encodes', () => {
    const rfcSecret = base32Encode(RFC_KEY);
    expect(rfcSecret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(rfcSecret)).toEqual(RFC_KEY);
    expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq')).toEqual(RFC_KEY);
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('accepts the code the setup script computes, one step either side, and nothing else', () => {
    const secret = generateSecret();
    const now = 1_800_000_000_000;
    for (const drift of [-30_000, 0, 30_000]) {
      expect(verifyTotp(secret, totpAt(secret, now + drift), now)).toBe(timeStep(now + drift));
    }
    expect(verifyTotp(secret, totpAt(secret, now + 90_000), now)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
    expect(verifyTotp('not base32!', '123456', now)).toBeNull();
    expect(verifyTotp('', '123456', now)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('are random, readable, and hashed the same way by the script and the server', () => {
    const codes: string[] = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
      expect(scriptHash(code)).toBe(hashRecoveryCode(code));
    }
    expect(hashRecoveryCode('ABCD-efgh 23')).toBe(hashRecoveryCode('abcdefgh23'));
  });
});
