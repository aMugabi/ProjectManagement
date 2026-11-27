import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  pushSubscriptions: vi.fn(async (): Promise<unknown[]> => []),
  removePushSubscription: vi.fn(async (_user: string, _endpoint: string) => {}),
}));
vi.mock('./store.js', () => store);

const { sendPush, urlSafeKey, vapidPublicKey } = await import('./webpush');

/** The same bytes in the standard base64 alphabet, with padding: how some generators print a key. */
const padded = (key: string) => Buffer.from(key, 'base64url').toString('base64');

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe('VAPID keys', () => {
  it('turns standard or padded base64 into the URL-safe form, unchanged otherwise', () => {
    expect(urlSafeKey(' ab+/cd== \n')).toBe('ab-_cd');
    expect(urlSafeKey('ab-_cd')).toBe('ab-_cd');
  });

  it('pushes with a private key saved padded, which web-push itself refuses', async () => {
    const keys = webpush.generateVAPIDKeys();
    const privateKey = padded(keys.privateKey);
    expect(privateKey.endsWith('=')).toBe(true);
    expect(() => webpush.setVapidDetails('mailto:me@example.com', keys.publicKey, privateKey)).toThrow(/URL safe Base 64/);

    process.env.VAPID_PUBLIC_KEY = padded(keys.publicKey);
    process.env.VAPID_PRIVATE_KEY = privateKey;
    process.env.VAPID_SUBJECT = 'mailto:me@example.com';
    await expect(sendPush({ title: 't', body: 'b', tag: 'x', path: 'dashboard' }, 'owner')).resolves.toEqual({ accepted: 0, failed: 0 });
    expect(vapidPublicKey()).toBe(keys.publicKey); // what the browser subscribes with
  });
});

describe('sending', () => {
  const sub = (name: string) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'k', auth: 'a' } });

  it('counts accepted and failed deliveries; a device that is gone is removed and not a failure', async () => {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    store.pushSubscriptions.mockResolvedValueOnce([sub('ok'), sub('gone'), sub('broken')]);
    const send = vi.spyOn(webpush, 'sendNotification').mockImplementation(async (s) => {
      if (s.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (s.endpoint.endsWith('broken')) throw Object.assign(new Error('server error'), { statusCode: 500 });
      return { statusCode: 201, body: '', headers: {} };
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendPush({ title: 't', body: 'b', tag: 'x', path: 'dashboard' }, 'owner')).resolves.toEqual({ accepted: 1, failed: 1 });
    expect(store.removePushSubscription).toHaveBeenCalledWith('owner', 'https://push.example/gone');
    expect(store.removePushSubscription).toHaveBeenCalledTimes(1);
    send.mockRestore();
    errors.mockRestore();
  });

  it('sends nothing, and reports nothing failed, without push keys', async () => {
    store.pushSubscriptions.mockClear();
    await expect(sendPush({ title: 't', body: 'b', tag: 'x', path: 'dashboard' }, 'owner')).resolves.toEqual({ accepted: 0, failed: 0 });
    expect(store.pushSubscriptions).not.toHaveBeenCalled();
  });
});
