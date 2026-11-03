import type { BrowserContext, Route } from '@playwright/test';
import webpush from 'web-push';
import { mergeStates } from '../src/shared/merge';
import { STATE_VERSION, type StoredState } from '../src/shared/state';

export const PASSWORD = 'correct horse';
export const SESSION = 'session-token-1';

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * In-memory stand-in for the Vercel functions, mirroring their contracts: login (with a 5-attempt
 * limit), session-gated state that merges uploads with the real shared merge, and push
 * subscription endpoints. Lets the cloud build's UI be tested without Redis or Vercel.
 */
export class FakeCloud {
  state: StoredState | null = null;
  sessions = new Set<string>([SESSION]);
  loginAttempts = 0;
  uploads: StoredState[] = [];
  signOuts: string[] = [];
  subs = new Map<string, PushSub>();
  testPushes: string[] = [];
  publicKey: string | null = webpush.generateVAPIDKeys().publicKey;
  /** Simulates the network being down: every /api request fails. */
  down = false;
  /** Simulates a server error on every request. */
  broken = false;
  /** Simulates the server failing to save a push subscription. */
  failPushSave = false;
  testEmails: string[] = [];
  /** When set, /api/email answers 502 with this reason. */
  emailError: string | null = null;

  async install(context: BrowserContext) {
    await context.route('**/api/**', (route) => this.handle(route));
  }

  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }

  private async handle(route: Route) {
    if (this.down) return route.abort('internetdisconnected');
    if (this.broken) return this.json(route, 500, { error: 'boom' });

    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
    const token = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');
    const authed = this.sessions.has(token);

    if (url.pathname === '/api/login' && method === 'POST') {
      if (++this.loginAttempts > 5) return this.json(route, 429, { error: 'too many attempts' });
      if (body?.password !== PASSWORD) return this.json(route, 401, { error: 'incorrect password' });
      const fresh = `session-${this.sessions.size + 1}`;
      this.sessions.add(fresh);
      return this.json(route, 200, { token: fresh });
    }
    if (!authed) return this.json(route, 401, { error: 'unauthorized' });

    if (url.pathname === '/api/login' && method === 'DELETE') {
      this.signOuts.push(url.searchParams.get('all') === '1' ? 'all' : 'this');
      if (url.searchParams.get('all') === '1') this.sessions.clear();
      else this.sessions.delete(token);
      return this.json(route, 200, { ok: true });
    }

    if (url.pathname === '/api/state') {
      if (method === 'GET') return this.json(route, 200, this.state);
      const incoming = body as StoredState;
      this.uploads.push(incoming);
      this.state = {
        state: this.state
          ? mergeStates(this.state.state, incoming.state, incoming.state.activeWorkspaceId)
          : mergeStates(null, incoming.state),
        version: STATE_VERSION,
      };
      return this.json(route, 200, this.state);
    }

    if (url.pathname === '/api/email' && method === 'POST') {
      if (this.emailError) return this.json(route, 502, { error: this.emailError });
      this.testEmails.push(body.to);
      return this.json(route, 200, { ok: true });
    }

    if (url.pathname === '/api/push') {
      if (method === 'GET') return this.json(route, 200, { publicKey: this.publicKey });
      if (method === 'POST' && url.searchParams.get('test') === '1') {
        this.testPushes.push(body.endpoint);
        return this.json(route, 200, { sent: this.subs.has(body.endpoint) ? 1 : 0 });
      }
      if (method === 'POST') {
        if (this.failPushSave) return this.json(route, 500, { error: 'boom' });
        this.subs.set(body.subscription.endpoint, body.subscription);
        return this.json(route, 200, { ok: true });
      }
      if (method === 'DELETE') {
        this.subs.delete(body.endpoint);
        return this.json(route, 200, { ok: true });
      }
    }
    return this.json(route, 404, { error: 'not found' });
  }
}
