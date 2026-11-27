import webpush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kv = vi.hoisted(() => ({ ping: vi.fn(async () => 'PONG') }));
vi.mock('./_lib/session.js', () => ({ kv }));
/** A stand-in for the app's database pool: on when `db.on`, answering `db.query`. */
const db = vi.hoisted(() => ({ on: false, query: vi.fn(async (): Promise<{ rows: { n: number }[] }> => ({ rows: [{ n: 0 }] })) }));
vi.mock('./_lib/db/client.js', () => ({ databaseConfigured: () => db.on, appPool: () => ({ query: db.query }) }));
vi.mock('./_lib/email.js', () => ({ emailConfigured: () => false }));

const { GET } = await import('./health');

const keys = webpush.generateVAPIDKeys();
const check = async () => {
  const res = await GET();
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
};

beforeEach(() => {
  db.on = false; // Redis mode
  db.query.mockReset().mockResolvedValue({ rows: [{ n: 0 }] });
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:me@example.org';
  kv.ping.mockReset().mockResolvedValue('PONG');
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe('GET /api/health', () => {
  it('answers 200 when the store answers and the push keys work, and is never cached', async () => {
    expect(await check()).toEqual({
      status: 200,
      cache: 'no-store',
      body: { ok: true, store: 'redis', database: 'ok', push: 'ok', email: 'off', mfa: 'on' },
    });
  });

  it('answers 503 when the store fails, without passing on the error', async () => {
    kv.ping.mockRejectedValue(new Error('connect ECONNREFUSED db-host.internal:6379 as admin'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await check();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, store: 'redis', database: 'failing' });
    expect(JSON.stringify(body)).not.toMatch(/db-host|admin|ECONNREFUSED/);
    expect(errors).toHaveBeenCalled(); // the details go to the log
    errors.mockRestore();
  });

  it('answers 503 when the push keys are unusable (a private key that is not 32 bytes)', async () => {
    process.env.VAPID_PRIVATE_KEY = Buffer.alloc(16, 7).toString('base64url');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await check();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, database: 'ok', push: 'invalid' });
    errors.mockRestore();
  });

  it('answers 503 when Redis answers something other than PONG', async () => {
    kv.ping.mockResolvedValue('LOADING');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await check()).toMatchObject({ status: 503, body: { ok: false, database: 'failing' } });
    errors.mockRestore();
  });

  it('reports push keys that are not set up, without failing', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect((await check()).body).toMatchObject({ ok: true, push: 'missing' });
  });

  it('reports a sign-in code that is switched off, without failing', async () => {
    process.env.AUTH_MFA = 'off';
    try {
      expect((await check()).body).toMatchObject({ ok: true, mfa: 'off' });
    } finally {
      delete process.env.AUTH_MFA;
    }
  });

  it('accepts push keys saved in the padded base64 form', async () => {
    process.env.VAPID_PRIVATE_KEY = Buffer.from(keys.privateKey, 'base64url').toString('base64');
    expect((await check()).body).toMatchObject({ ok: true, push: 'ok' });
  });
});

describe('GET /api/health on Postgres', () => {
  beforeEach(() => {
    db.on = true;
  });

  it('answers 200 when the app role answers and sees no workspace with no user signed in', async () => {
    expect(await check()).toMatchObject({ status: 200, body: { ok: true, store: 'postgres', database: 'ok' } });
    expect(db.query).toHaveBeenCalledWith('select cardinality(app.workspace_ids()) as n');
    expect(kv.ping).not.toHaveBeenCalled();
  });

  it('answers 503 when the app role sees workspaces with no user (the walls are down)', async () => {
    db.query.mockResolvedValue({ rows: [{ n: 2 }] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await check()).toMatchObject({ status: 503, body: { ok: false, store: 'postgres', database: 'failing' } });
    errors.mockRestore();
  });

  it('answers 503 when the database fails, without passing on the error', async () => {
    db.query.mockRejectedValue(new Error('password authentication failed for user "ledger_app_login" at ep-host.neon.tech'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await check();
    expect(status).toBe(503);
    expect(JSON.stringify(body)).not.toMatch(/ledger_app_login|neon|password/);
    errors.mockRestore();
  });
});
