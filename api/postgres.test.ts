/**
 * The /api functions on Postgres (DATABASE_URL set), against a real database: sign-in by email
 * and code, the document, push subscriptions, the reminders timer and sign-out, each walled off
 * per user. Skipped unless TEST_DB_OWNER_URL and TEST_DB_APP_URL are set (see db/README.md).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain .mjs scripts without type declarations
import { hashPassword } from '../scripts/hash-password.mjs';
// @ts-expect-error — plain .mjs scripts without type declarations
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, totpAt } from '../scripts/setup-mfa.mjs';
import { nowInZone } from '../src/shared/reminders';
import { endAppPool } from './_lib/db/client';
import { importDocument } from './_lib/db/import';
import { NOW, document, task } from './_lib/db/testing/document';

const OWNER_URL = process.env.TEST_DB_OWNER_URL;
const APP_URL = process.env.TEST_DB_APP_URL;
const RUN = Date.now().toString(36);
const PASSWORD = 'correct horse battery';
/** A fresh address per call, so limits from earlier runs on this database don't carry over. */
const freshIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** Addresses whose next email fails once (the timer runs for every user on this database, so only A's is failed). */
const failNext = new Set<string>();
const sendEmail = vi.fn(async (email: { to: string; subject: string; text: string }) => {
  if (failNext.delete(email.to)) throw new Error('the email service refused it (403)');
});
const A_ADDRESS = `digest-a-${RUN}@example.org`;
vi.mock('./_lib/email.js', () => ({ emailConfigured: () => true, sendEmail }));
/** No push service here: a push counts as delivered to a device unless a test says otherwise. */
const pushResult = { accepted: 1, failed: 0 };
vi.mock('./_lib/webpush.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib/webpush.js')>()),
  sendPush: async () => ({ ...pushResult }),
}));

interface Reply {
  status: number;
  body: any;
}
async function call(handler: (req: any, res: any) => Promise<void>, method: string, opts: { body?: unknown; token?: string; url?: string; ip?: string } = {}): Promise<Reply> {
  const reply: Reply = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      reply.status = code;
      return res;
    },
    json(payload: unknown) {
      reply.body = payload;
    },
  };
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? freshIp() };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  await handler({ method, body: opts.body, headers, url: opts.url ?? '/' }, res);
  return reply;
}

describe.skipIf(!OWNER_URL || !APP_URL)('the API on Postgres (TEST_DB_OWNER_URL, TEST_DB_APP_URL)', () => {
  let owner: pg.Client;
  let login: typeof import('./login').default;
  let state: typeof import('./state').default;
  let push: typeof import('./push').default;
  let reminders: typeof import('./reminders').POST;
  type User = { email: string; secret: string; recovery: string[]; id: string };
  const users: Record<'a' | 'b', User> = {
    a: { email: `api-a-${RUN}@example.org`, secret: generateSecret(), recovery: generateRecoveryCodes(), id: '' },
    b: { email: `api-b-${RUN}@example.org`, secret: generateSecret(), recovery: generateRecoveryCodes(), id: '' },
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.REMINDERS_SECRET = 's3cret';
    owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY, 'base64');
    for (const u of Object.values(users)) {
      const r = await importDocument(owner, {
        email: u.email, passwordHash: hashPassword(PASSWORD), dryRun: false, now: NOW,
        document: u === users.a ? document() : { workspaces: [], tasks: [], projects: [], workspaceData: {}, deleted: {} },
        mfa: { totpSecret: u.secret, recoveryHashes: u.recovery.map(hashRecoveryCode), key },
      });
      u.id = r.userId;
    }
    await forgetOverallAttempts();
    ({ default: login } = await import('./login'));
    ({ default: state } = await import('./state'));
    ({ default: push } = await import('./push'));
    ({ POST: reminders } = await import('./reminders'));
  });
  afterAll(async () => {
    delete process.env.DATABASE_URL;
    await endAppPool();
    await owner?.end();
  });

  /** The overall cap (50 an hour) is shared by every test run on this database: start each test below it. */
  async function forgetOverallAttempts() {
    await owner.query("update login_attempts set at = now() - interval '2 hours' where limit_key = 'all'");
  }

  async function signInAs(u: User): Promise<string> {
    // Each code works once, and only three authenticator codes are valid at a time: the tests
    // sign in again and again with the recovery codes (ten each).
    const r = await call(login, 'POST', { body: { email: u.email, password: PASSWORD, code: u.recovery.shift() } });
    expect(r.status).toBe(200);
    return r.body.token;
  }

  it('asks for an email and a code', async () => {
    expect((await call(login, 'GET')).body).toEqual({ mfa: true, email: true });
  });

  it('signs in with email, password and code; refuses anything less in the same words', async () => {
    const ip = freshIp();
    const wrong = await call(login, 'POST', { ip, body: { email: users.a.email, password: 'nope', code: totpAt(users.a.secret, Date.now()) } });
    expect(wrong).toEqual({ status: 401, body: { error: 'incorrect email, password or code' } });
    const noCode = await call(login, 'POST', { ip, body: { email: users.a.email, password: PASSWORD } });
    expect(noCode).toEqual(wrong);
    const ok = await call(login, 'POST', { body: { email: users.a.email, password: PASSWORD, code: totpAt(users.a.secret, Date.now()) } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^[\w-]{43}$/);
    expect(await signInAs(users.a)).toMatch(/^[\w-]{43}$/); // and with a recovery code
  });

  it('stops after 5 attempts from one address', async () => {
    await forgetOverallAttempts();
    const ip = freshIp();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await call(login, 'POST', { ip, body: { email: users.a.email, password: 'nope' } })).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('serves each user only their own document, and nothing without a session', async () => {
    const token = await signInAs(users.a);
    const mine = await call(state, 'GET', { token });
    expect(mine.status).toBe(200);
    expect(mine.body.state.tasks.map((t: { id: string }) => t.id)).toEqual(['t1', 't2', 't3']);
    const theirs = (await call(state, 'GET', { token: await signInAs(users.b) })).body.state;
    expect([theirs.workspaces.map((w: { id: string }) => w.id), theirs.tasks, theirs.workspaceData]).toEqual([['default'], [], {}]);
    expect((await call(state, 'GET', {})).status).toBe(401);
    expect((await call(state, 'GET', { token: 'made-up' })).status).toBe(401);
  });

  it('syncs an upload and returns the merged document', async () => {
    const token = await signInAs(users.a);
    const today = nowInZone('Africa/Kampala').date;
    const upload = (await call(state, 'GET', { token })).body;
    upload.state.tasks.unshift(task('due-now', 'home', { title: 'Due today', dueDate: today, updatedAt: Date.now() }));
    // Digest at midnight, so the timer test below sends it at any time of day.
    upload.state.reminders = { ...upload.state.reminders, email: A_ADDRESS, digestTime: '00:00', updatedAt: Date.now() };
    const merged = await call(state, 'POST', { token, body: upload });
    expect(merged.status).toBe(200);
    expect(merged.body.state.tasks[0]).toMatchObject({ id: 'due-now', dueDate: today });
    const row = await owner.query("select due_date::text d from items where owner_id = $1 and client_id = 'due-now'", [users.a.id]);
    expect(row.rows).toEqual([{ d: today }]);
    expect((await call(state, 'POST', { token, body: { nope: 1 } })).status).toBe(400);
  });

  it('keeps push subscriptions per user', async () => {
    const token = await signInAs(users.a);
    const subscription = { endpoint: `https://push.example/${RUN}`, keys: { p256dh: 'k', auth: 'a' } };
    expect((await call(push, 'POST', { token, body: { subscription } })).status).toBe(200);
    const stored = await owner.query('select user_id from push_subscriptions where subscription->>\'endpoint\' = $1', [subscription.endpoint]);
    expect(stored.rows).toEqual([{ user_id: users.a.id }]);
    expect((await call(push, 'DELETE', { token, body: { endpoint: subscription.endpoint } })).status).toBe(200);
    expect((await owner.query('select 1 from push_subscriptions where user_id = $1', [users.a.id])).rowCount).toBe(0);
  });

  it("runs every user's reminders once, retries a failed email, and reports the failure", async () => {
    const run = () => reminders(new Request('https://ledger.test/api/reminders', { method: 'POST', headers: { authorization: 'Bearer s3cret' } }));
    // A record older than the 3 days claims are kept: cleared on the next claim.
    await owner.query("insert into reminders_sent (user_id, reminder_key, sent_at) values ($1, 'digest:2020-01-01', now() - interval '4 days')", [users.a.id]);
    const toA = () => sendEmail.mock.calls.filter(([e]) => e.to === A_ADDRESS).length;
    failNext.add(A_ADDRESS);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await run();
    expect(failed.status).toBe(502);
    expect(toA()).toBe(1);
    const first = await owner.query('select reminder_key from reminders_sent where user_id = $1 order by 1', [users.a.id]);
    // The old record is gone, today's push is claimed, and the failed email was given back.
    expect(first.rows.map((r) => r.reminder_key)).toEqual([`digest:${nowInZone('Africa/Kampala').date}`]);
    const retried = await run();
    expect(retried.status).toBe(200);
    expect(toA()).toBe(2); // the retry
    const claimed = await owner.query('select reminder_key from reminders_sent where user_id = $1 order by 1', [users.a.id]);
    expect(claimed.rows.map((r) => r.reminder_key)).toEqual([`digest:${nowInZone('Africa/Kampala').date}`, `email-digest:${nowInZone('Africa/Kampala').date}`]);
    await run();
    expect(toA()).toBe(2); // and never again that day
    errors.mockRestore();
  }, 60_000); // the timer runs for every user, and repeated runs leave many on this database

  it('gives a push back when no device took it, so a device turned on later still gets it', async () => {
    const run = () => reminders(new Request('https://ledger.test/api/reminders', { method: 'POST', headers: { authorization: 'Bearer s3cret' } }));
    const today = `digest:${nowInZone('Africa/Kampala').date}`;
    const claims = async () => (await owner.query('select reminder_key from reminders_sent where user_id = $1 and reminder_key = $2', [users.a.id, today])).rowCount;
    await owner.query('delete from reminders_sent where user_id = $1 and reminder_key = $2', [users.a.id, today]);
    Object.assign(pushResult, { accepted: 0, failed: 0 }); // no device registered yet
    try {
      expect((await run()).status).toBe(200); // nothing wrong: nobody to tell
      expect(await claims()).toBe(0);
      Object.assign(pushResult, { accepted: 1, failed: 0 }); // a device is turned on
      await run();
      expect(await claims()).toBe(1);
    } finally {
      Object.assign(pushResult, { accepted: 1, failed: 0 });
    }
  }, 60_000);

  it('signs out one device, or every device with its push subscriptions', async () => {
    const one = await signInAs(users.a);
    const two = await signInAs(users.a);
    await call(push, 'POST', { token: two, body: { subscription: { endpoint: `https://push.example/x-${RUN}`, keys: { p256dh: 'k', auth: 'a' } } } });
    expect((await call(login, 'DELETE', { token: one })).status).toBe(200);
    expect((await call(state, 'GET', { token: one })).status).toBe(401);
    expect((await call(state, 'GET', { token: two })).status).toBe(200);
    expect((await call(login, 'DELETE', { token: two, url: '/api/login?all=1' })).status).toBe(200);
    expect((await call(state, 'GET', { token: two })).status).toBe(401);
    expect((await owner.query('select 1 from push_subscriptions where user_id = $1', [users.a.id])).rowCount).toBe(0);
  });
});
