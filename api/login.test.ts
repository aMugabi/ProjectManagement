import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain .mjs scripts without type declarations
import { hashPassword } from '../scripts/hash-password.mjs';
// @ts-expect-error — plain .mjs scripts without type declarations
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, totpAt } from '../scripts/setup-mfa.mjs';

const redis = new Map<string, unknown>();
const fakeKv = {
  set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
    if (opts?.nx && redis.has(key)) return null;
    redis.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => Number(redis.delete(key))),
};
let tokens = 0;

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true };
    }
  },
}));
vi.mock('./_lib/session.js', () => ({
  kv: fakeKv,
  createSession: async () => `token-${++tokens}`,
  bearerToken: () => '',
  requireSession: async () => true,
  revokeSession: async () => {},
  revokeAllSessions: async () => {},
}));

const { default: handler } = await import('./login');

interface Reply {
  status: number;
  body: { token?: string; error?: string; mfa?: boolean };
}

async function call(method: string, body?: unknown): Promise<Reply> {
  const reply: Reply = { status: 0, body: {} };
  const res = {
    status(code: number) {
      reply.status = code;
      return res;
    },
    json(payload: Reply['body']) {
      reply.body = payload;
    },
  };
  await handler({ method, body, headers: {} }, res);
  return reply;
}

const PASSWORD = 'correct horse';
const SECRET = generateSecret();
const RECOVERY: string[] = generateRecoveryCodes();

beforeEach(() => {
  redis.clear();
  process.env.AUTH_PASSWORD_HASH = hashPassword(PASSWORD);
  delete process.env.AUTH_TOTP_SECRET;
  delete process.env.AUTH_RECOVERY_CODES;
  delete process.env.AUTH_MFA;
});

function turnOnMfa() {
  process.env.AUTH_TOTP_SECRET = SECRET;
  process.env.AUTH_RECOVERY_CODES = RECOVERY.map(hashRecoveryCode).join(',');
}

describe('/api/login without MFA set up', () => {
  it('says no code is needed, and signs in with the password alone', async () => {
    expect(await call('GET')).toEqual({ status: 200, body: { mfa: false, email: false } });
    expect((await call('POST', { password: PASSWORD })).body.token).toMatch(/^token-/);
    expect(await call('POST', { password: 'wrong' })).toEqual({ status: 401, body: { error: 'incorrect password' } });
  });
});

describe('/api/login with MFA', () => {
  beforeEach(turnOnMfa);

  it('says a code is needed', async () => {
    expect((await call('GET')).body).toEqual({ mfa: true, email: false });
  });

  it('refuses the right password without a code, or with a wrong one, in the same words as a wrong password', async () => {
    const refused = { status: 401, body: { error: 'incorrect password or code' } };
    expect(await call('POST', { password: PASSWORD })).toEqual(refused);
    expect(await call('POST', { password: PASSWORD, code: '000000' === totpAt(SECRET, Date.now()) ? '111111' : '000000' })).toEqual(refused);
    expect(await call('POST', { password: 'wrong', code: totpAt(SECRET, Date.now()) })).toEqual(refused);
  });

  it("doesn't use up a code when the password is wrong", async () => {
    const code = totpAt(SECRET, Date.now());
    expect((await call('POST', { password: 'wrong', code })).status).toBe(401);
    expect((await call('POST', { password: PASSWORD, code })).status).toBe(200);
  });

  it('accepts a current authenticator code once only', async () => {
    const code = totpAt(SECRET, Date.now());
    expect((await call('POST', { password: PASSWORD, code: ` ${code.slice(0, 3)} ${code.slice(3)} ` })).status).toBe(200);
    expect((await call('POST', { password: PASSWORD, code })).status).toBe(401);
  });

  it('accepts each recovery code once, however it is typed', async () => {
    const [first, second] = RECOVERY;
    expect((await call('POST', { password: PASSWORD, code: first.toUpperCase() })).status).toBe(200);
    expect((await call('POST', { password: PASSWORD, code: first })).status).toBe(401);
    expect((await call('POST', { password: PASSWORD, code: second.replace(/-/g, ' ') })).status).toBe(200);
    expect((await call('POST', { password: PASSWORD, code: 'aaaa-bbbb-cc' })).status).toBe(401);
  });
});

describe('/api/login with MFA set up but switched off (AUTH_MFA=off)', () => {
  beforeEach(turnOnMfa);

  it('says no code is needed, and signs in with the password alone', async () => {
    process.env.AUTH_MFA = 'off';
    expect((await call('GET')).body).toEqual({ mfa: false, email: false });
    expect((await call('POST', { password: PASSWORD })).body.token).toMatch(/^token-/);
    expect(await call('POST', { password: 'wrong' })).toEqual({ status: 401, body: { error: 'incorrect password' } });
  });

  it('only the exact word "off" switches it off', async () => {
    for (const value of ['OFF', 'false', '0', 'no', '']) {
      process.env.AUTH_MFA = value;
      expect((await call('GET')).body).toEqual({ mfa: true, email: false });
      expect((await call('POST', { password: PASSWORD })).status).toBe(401);
    }
  });

  it('asks for the code again once the setting is removed, with the same key', async () => {
    process.env.AUTH_MFA = 'off';
    expect((await call('POST', { password: PASSWORD })).status).toBe(200);
    delete process.env.AUTH_MFA;
    expect((await call('POST', { password: PASSWORD })).status).toBe(401);
    expect((await call('POST', { password: PASSWORD, code: totpAt(SECRET, Date.now()) })).status).toBe(200);
  });
});
