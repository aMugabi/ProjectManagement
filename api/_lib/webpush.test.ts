import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store.js', () => ({ pushSubscriptions: async () => [], removePushSubscription: async () => {} }));

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
    await expect(sendPush({ title: 't', body: 'b', tag: 'x', path: 'dashboard' }, 'owner')).resolves.toBe(0);
    expect(vapidPublicKey()).toBe(keys.publicKey); // what the browser subscribes with
  });
});
