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
const sendPush = vi.fn(async () => 1);
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
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ledger · 1 due today', tag: `digest:${now.date}`, path: 'dashboard' }),
    );

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
      reminders: { enabled: true, digestTime: '00:00', defaultLeadDays: 1, includeOverdue: true, timezone: 'Africa/Kampala', emailDigest: true, email: 'me@example.com', updatedAt: 1 },
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

  it('retries on the next run if sending the email fails', async () => {
    seedWithEmail();
    sendEmail.mockRejectedValueOnce(new Error('the email service refused it (403)'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await (await call()).json()).toMatchObject({ emailed: 0 });
    expect(await (await call()).json()).toMatchObject({ emailed: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});
