import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/types';
import { nowInZone } from '../src/shared/reminders';
import { normalizeState, STATE_VERSION } from '../src/shared/state';

const redis = new Map<string, unknown>();
const fakeKv = {
  get: vi.fn(async (key: string) => redis.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
    if (opts?.nx && redis.has(key)) return null;
    redis.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => Number(redis.delete(key))),
};
const sendPush = vi.fn(async (): Promise<{ accepted: number; failed: number }> => ({ accepted: 1, failed: 0 }));
const sendEmail = vi.fn(async (_email: { to: string; subject: string }) => {});

vi.mock('./_lib/session.js', () => ({ kv: fakeKv }));
vi.mock('./_lib/webpush.js', () => ({ sendPush }));
vi.mock('./_lib/email.js', () => ({ emailConfigured: () => true, sendEmail }));

const { POST } = await import('./reminders');

function task(id: string, dueDate: string): Task {
  return { id, project: 'p', title: id, status: 'todo', priority: 'med', dueDate, subs: [], recurring: null, deps: [], notes: '', order: 0, updatedAt: 1 };
}

const call = (auth = 'Bearer s3cret') =>
  POST(new Request('https://ledger.test/api/reminders', { method: 'POST', headers: { authorization: auth } }));

beforeEach(() => {
  redis.clear();
  sendPush.mockClear();
  sendEmail.mockReset();
  process.env.REMINDERS_SECRET = 's3cret';
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
});

describe('POST /api/reminders', () => {
  it('rejects calls without a valid QStash signature or secret', async () => {
    expect((await call('Bearer wrong')).status).toBe(401);
    expect((await call('')).status).toBe(401);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("pushes due reminders once, in the user's time zone, and never repeats them", async () => {
    const now = nowInZone('Africa/Kampala');
    const state = normalizeState({
      tasks: [task('due-today', now.date)],
      projects: [{ id: 'p', name: 'Home', color: '#000', updatedAt: 1 }],
      // Digest at midnight, so it's always due by the time the test runs.
      reminders: { enabled: true, digestTime: '00:00', defaultLeadDays: 1, includeOverdue: true, timezone: 'Africa/Kampala', updatedAt: 1 },
    });
    redis.set('ledger:state', { state, version: STATE_VERSION });

    const first = await (await call()).json();
    expect(first).toEqual({ due: 1, sent: 1, emailed: 0 }); // email digest is off by default
    // Private notifications are on by default: counts only, no task names on the lock screen.
    expect(sendPush).toHaveBeenCalledWith({ title: 'Ledger · 1 due today', body: 'Open Ledger to see them.', tag: `digest:${now.date}`, path: 'dashboard' }, 'owner');

    const second = await (await call()).json();
    expect(second).toEqual({ due: 1, sent: 0, emailed: 0 });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no stored state yet', async () => {
    expect(await (await call()).json()).toEqual({ due: 0, sent: 0, emailed: 0 });
  });

  function seedWithEmail() {
    const now = nowInZone('Africa/Kampala');
    const state = normalizeState({
      tasks: [task('due-today', now.date)],
      projects: [{ id: 'p', name: 'Home', color: '#000', updatedAt: 1 }],
      reminders: { enabled: true, digestTime: '00:00', defaultLeadDays: 1, includeOverdue: true, timezone: 'Africa/Kampala', emailDigest: true, email: 'me@example.com', privateNotifications: false, updatedAt: 1 },
    });
    redis.set('ledger:state', { state, version: STATE_VERSION });
    return now;
  }

  it('emails the digest once a day, linking back to the deployed site', async () => {
    const now = seedWithEmail();
    expect(await (await call()).json()).toMatchObject({ emailed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(sent).toMatchObject({ to: 'me@example.com', subject: 'Ledger · 1 due today' });
    expect(sent.text).toContain('https://ledger.test/dashboard?task=due-today&ws=default');
    expect(redis.has(`ledger:sent:email-digest:${now.date}`)).toBe(true);

    expect(await (await call()).json()).toMatchObject({ emailed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('fails the run (so the timer job alerts) and retries on the next run if sending the email fails', async () => {
    seedWithEmail();
    sendEmail.mockRejectedValueOnce(new Error('the email service refused it (403)'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await call();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ emailed: 0, error: 'digest email failed' });
    const retried = await call();
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ emailed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it('gives a reminder back when its push fails, still emails the digest, and fails the run', async () => {
    const now = seedWithEmail();
    sendPush.mockRejectedValueOnce(new Error('Vapid private key must be a URL safe Base 64 (without "=")'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await call();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ due: 1, sent: 0, emailed: 1, error: 'push failed' });
    expect(redis.has(`ledger:sent:digest:${now.date}`)).toBe(false);

    const retried = await call();
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ due: 1, sent: 1, emailed: 0 });
    expect(sendPush).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it('gives a reminder back when no device took it, without failing the run', async () => {
    const now = seedWithEmail();
    sendPush.mockResolvedValueOnce({ accepted: 0, failed: 0 }); // no device registered yet
    const quiet = await call();
    expect(quiet.status).toBe(200);
    expect(await quiet.json()).toEqual({ due: 1, sent: 0, emailed: 1 });
    expect(redis.has(`ledger:sent:digest:${now.date}`)).toBe(false);
    // A device is turned on: the next run delivers the day's digest, once.
    expect(await (await call()).json()).toEqual({ due: 1, sent: 1, emailed: 0 });
    expect(await (await call()).json()).toEqual({ due: 1, sent: 0, emailed: 0 });
    expect(sendPush).toHaveBeenCalledTimes(2);
  });

  it('fails the run when every delivery to registered devices failed, and retries', async () => {
    const now = seedWithEmail();
    sendPush.mockResolvedValueOnce({ accepted: 0, failed: 2 });
    const failed = await call();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ due: 1, sent: 0, emailed: 1, error: 'push failed' });
    expect(redis.has(`ledger:sent:digest:${now.date}`)).toBe(false);
    const retried = await call();
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ due: 1, sent: 1, emailed: 0 });
  });
});
