/**
 * Sign-in on Postgres, against a real database through the app role. Skipped unless
 * TEST_DB_OWNER_URL and TEST_DB_APP_URL are set (see db/README.md).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs scripts without type declarations
import { hashPassword } from '../../../scripts/hash-password.mjs';
// @ts-expect-error — plain .mjs scripts without type declarations
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, totpAt } from '../../../scripts/setup-mfa.mjs';
import { importDocument } from '../db/import';
import { NOW, document } from '../db/testing/document';
import { createSession, endAllSessions, endSession, LIMITS, loginAllowed, secondFactorOk, sessionUser, signIn } from './pgAuth';

const OWNER_URL = process.env.TEST_DB_OWNER_URL;
const APP_URL = process.env.TEST_DB_APP_URL;
const RUN = Date.now().toString(36);
const EMAIL = `auth-${RUN}@example.org`;
const PASSWORD = 'correct horse battery';
const SECRET = generateSecret();
const RECOVERY: string[] = generateRecoveryCodes();

describe.skipIf(!OWNER_URL || !APP_URL)('sign-in on Postgres (TEST_DB_OWNER_URL, TEST_DB_APP_URL)', () => {
  let owner: pg.Client;
  let app: pg.Pool;
  let userId: string;

  beforeAll(async () => {
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new pg.Pool({ connectionString: APP_URL, max: 2 });
    const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY, 'base64');
    const result = await importDocument(owner, {
      email: EMAIL, passwordHash: hashPassword(PASSWORD), document: document(), dryRun: false, now: NOW,
      mfa: { totpSecret: SECRET, recoveryHashes: RECOVERY.map(hashRecoveryCode), key },
    });
    userId = result.userId;
  });
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  const now = () => totpAt(SECRET, Date.now());

  it('signs in with email, password and a current code; the code works once', async () => {
    const code = now();
    expect(await signIn(app, { email: ` ${EMAIL.toUpperCase()} `, password: PASSWORD, code })).toBe(userId);
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code })).toBeNull();
  });

  it('refuses a wrong password, an unknown email, a missing or wrong code, in the same way', async () => {
    expect(await signIn(app, { email: EMAIL, password: 'wrong', code: now() })).toBeNull();
    expect(await signIn(app, { email: `nobody-${RUN}@example.org`, password: PASSWORD, code: now() })).toBeNull();
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code: undefined })).toBeNull();
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code: '000000' === now() ? '111111' : '000000' })).toBeNull();
    expect(await signIn(app, { email: EMAIL, password: '', code: now() })).toBeNull();
  });

  it("doesn't use up a code when the password is wrong", async () => {
    // A fresh time step, so the earlier test's use of this step can't interfere.
    const later = Date.now() + 60_000;
    const code = totpAt(SECRET, later);
    expect(await secondFactorOk(app, userId, code, later)).toBe(true);
    const step2 = Date.now() + 120_000;
    const code2 = totpAt(SECRET, step2);
    await signIn(app, { email: EMAIL, password: 'wrong', code: code2 });
    expect(await secondFactorOk(app, userId, code2, step2)).toBe(true);
  });

  it('accepts each recovery code once, however it is typed', async () => {
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code: RECOVERY[0].toUpperCase() })).toBe(userId);
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code: RECOVERY[0] })).toBeNull();
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code: RECOVERY[1].replace(/-/g, ' ') })).toBe(userId);
    expect(await signIn(app, { email: EMAIL, password: PASSWORD, code: 'aaaa-bbbb-cc' })).toBeNull(); // not one of theirs
  });

  it('refuses a user with no authenticator: MFA is required here', async () => {
    const r = await importDocument(owner, {
      email: `nomfa-${RUN}@example.org`, passwordHash: hashPassword(PASSWORD), document: document(), dryRun: false, now: NOW,
    });
    expect(r.committed).toBe(true);
    expect(await signIn(app, { email: `nomfa-${RUN}@example.org`, password: PASSWORD, code: now() })).toBeNull();
  });

  it('keeps the authenticator key encrypted, bound to its user', async () => {
    const stored = await owner.query('select totp_secret_encrypted s from mfa_factors where user_id = $1', [userId]);
    expect(stored.rows[0].s).toMatch(/^v1\./);
    expect(stored.rows[0].s).not.toContain(SECRET);
    const other = (await owner.query("select id from users where email = $1", [`nomfa-${RUN}@example.org`])).rows[0].id;
    await owner.query('insert into mfa_factors (user_id, totp_secret_encrypted) values ($1, $2)', [other, stored.rows[0].s]);
    await expect(signIn(app, { email: `nomfa-${RUN}@example.org`, password: PASSWORD, code: now() })).rejects.toThrow();
  });

  it('sessions: stored as a hash, renewed on use, ended one at a time or all together', async () => {
    const token = await createSession(app, userId);
    const row = await owner.query('select token_hash, expires_at > now() + interval \'29 days\' fresh from sessions where user_id = $1', [userId]);
    expect(row.rows.map((r) => r.token_hash)).not.toContain(token);
    expect(await sessionUser(app, token)).toBe(userId);
    await owner.query("update sessions set expires_at = now() + interval '1 day' where user_id = $1", [userId]);
    expect(await sessionUser(app, token)).toBe(userId);
    const renewed = await owner.query("select bool_and(expires_at > now() + interval '29 days') r from sessions where user_id = $1", [userId]);
    expect(renewed.rows[0].r).toBe(true);
    await owner.query("update sessions set expires_at = now() - interval '1 second' where user_id = $1", [userId]);
    expect(await sessionUser(app, token)).toBeNull(); // expired
    const a = await createSession(app, userId);
    const b = await createSession(app, userId);
    await endSession(app, a);
    expect([await sessionUser(app, a), await sessionUser(app, b)]).toEqual([null, userId]);
    await endAllSessions(app, userId);
    expect(await sessionUser(app, b)).toBeNull();
    expect(await sessionUser(app, '')).toBeNull();
  });

  it('limits attempts: 5 per 15 minutes from one address, others unaffected', async () => {
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const results = [];
    for (let i = 0; i < LIMITS.perIp + 1; i++) results.push(await loginAllowed(app, ip));
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(await loginAllowed(app, `${ip}-other`)).toBe(true);
    await owner.query("update login_attempts set at = now() - interval '16 minutes' where limit_key = $1", [`ip:${ip}`]);
    expect(await loginAllowed(app, ip)).toBe(true);
  });

  it('limits everyone together to 50 an hour', async () => {
    // Inside a transaction that is rolled back, so other tests on this database never see these
    // attempts; repeatable read, so attempts other tests commit meanwhile don't count here either.
    await owner.query('begin isolation level repeatable read');
    try {
      await owner.query("update login_attempts set at = now() - interval '2 hours' where limit_key = 'all'");
      await owner.query("insert into login_attempts (limit_key) select 'all' from generate_series(1, $1)", [LIMITS.overall - 1]);
      expect(await loginAllowed(owner, `ip-${RUN}-1`)).toBe(true); // the 50th
      expect(await loginAllowed(owner, `ip-${RUN}-2`)).toBe(false); // the 51st, from a new address
    } finally {
      await owner.query('rollback');
    }
  });
});
