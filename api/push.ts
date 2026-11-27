import { removePushSubscription, requireUser, savePushSubscription } from './_lib/store.js';
import { isSubscription, sendPush, vapidPublicKey } from './_lib/webpush.js';

function parseBody(req: any): Record<string, unknown> {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

/**
 * GET → { publicKey } (null if push isn't configured on the server)
 * POST { subscription } → saves this device's push subscription
 * POST ?test=1 { endpoint } → sends a test notification to that device
 * DELETE { endpoint } → removes this device's subscription
 */
export default async function handler(req: any, res: any) {
  const user = await requireUser(req, res);
  if (!user) return;
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET') {
    res.status(200).json({ publicKey: vapidPublicKey() });
    return;
  }

  if (req.method === 'POST' && url.searchParams.get('test') === '1') {
    const { endpoint } = parseBody(req);
    if (typeof endpoint !== 'string') {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }
    const { accepted: sent } = await sendPush(
      { title: 'Ledger test notification', body: 'Push notifications are working on this device.', tag: 'test', path: 'dashboard' },
      user,
      endpoint,
    );
    res.status(200).json({ sent });
    return;
  }

  if (req.method === 'POST') {
    const { subscription } = parseBody(req);
    if (!isSubscription(subscription)) {
      res.status(400).json({ error: 'invalid subscription' });
      return;
    }
    await savePushSubscription(user, subscription);
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    const { endpoint } = parseBody(req);
    if (typeof endpoint === 'string') await removePushSubscription(user, endpoint);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
