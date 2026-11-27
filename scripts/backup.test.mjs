import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEM_TYPES } from '../src/shared/itemTypes';
import { backupName, DONE_STATUSES, encryptArgs, signIn, summarise, summaryLine } from './backup.mjs';

const task = (id, status = 'todo') => ({ id, status });

describe('backup script', () => {
  it('summarises every workspace as counts, active or not', () => {
    const stored = {
      version: 3,
      state: {
        tasks: [task('a'), task('b', 'done')],
        projects: [{ id: 'p' }],
        workspaces: [
          { id: 'default', name: 'Work' },
          { id: 'constructor', name: 'Odd name' },
          { id: 'empty', name: 'Empty' },
        ],
        activeWorkspaceId: 'default',
        workspaceData: { constructor: { projects: [{ id: 'q' }, { id: 'r' }], tasks: [task('c', 'done')] } },
        deleted: { 'task:default:z': 1 },
      },
    };
    const none = { products: 0, partners: 0, releases: 0, signoffs: 0 };
    expect(summarise(stored)).toEqual({
      version: 3,
      workspaces: [
        { workspace: 'Work', projects: 1, tasks: 2, done: 1, ...none },
        { workspace: 'Odd name', projects: 2, tasks: 1, done: 1, ...none },
        { workspace: 'Empty', projects: 0, tasks: 0, done: 0, ...none },
      ],
      deletions: 1,
    });
  });

  it('counts products, partners, releases and sign-offs, and every finished status', () => {
    const stored = {
      version: 5,
      state: {
        tasks: [{ id: 'r', type: 'risk', status: 'closed' }, { id: 'd', type: 'decision', status: 'proposed' }],
        projects: [],
        products: [{ id: 'loans' }],
        partners: [{ id: 'a' }, { id: 'b' }],
        releases: [{ id: 'r1' }],
        signoffs: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
        workspaces: [{ id: 'work', name: 'Work' }, { id: 'home', name: 'Home' }],
        activeWorkspaceId: 'work',
        workspaceData: { home: { projects: [{ id: 'p' }], tasks: [{ id: 'x', type: 'milestone', status: 'met' }], products: [], partners: [{ id: 'c' }], releases: [], signoffs: [] } },
      },
    };
    const [work, home] = summarise(stored).workspaces;
    expect(work).toEqual({ workspace: 'Work', projects: 0, tasks: 2, done: 1, products: 1, partners: 2, releases: 1, signoffs: 3 });
    expect(home).toEqual({ workspace: 'Home', projects: 1, tasks: 1, done: 1, products: 0, partners: 1, releases: 0, signoffs: 0 });
    expect(summaryLine(work)).toBe('  Work: 0 projects, 2 items (1 done); 1 product, 2 partners, 1 release, 3 sign-offs');
    expect(summaryLine(home)).toBe('  Home: 1 projects, 1 items (1 done); 1 partner');
    expect(summaryLine({ ...home, partners: 0 })).toBe('  Home: 1 projects, 1 items (1 done)');
  });

  it("knows the same finished statuses as the app's item types", () => {
    for (const type of Object.values(ITEM_TYPES)) {
      for (const status of type.statuses) expect([type.label, status.id, DONE_STATUSES.has(status.id)]).toEqual([type.label, status.id, Boolean(status.done)]);
    }
    const all = new Set(Object.values(ITEM_TYPES).flatMap((t) => t.statuses.map((s) => s.id)));
    expect([...DONE_STATUSES].filter((id) => !all.has(id))).toEqual([]);
  });

  it("refuses anything that isn't a Ledger backup", () => {
    expect(() => summarise(null)).toThrow("isn't a Ledger backup");
    expect(() => summarise({ state: { tasks: 'x' } })).toThrow("isn't a Ledger backup");
  });

  it('encrypts to a key when one is set, otherwise with a passphrase', () => {
    expect(encryptArgs('/b/x.gpg', 'me@example.org')).toEqual(['--batch', '--yes', '--encrypt', '--recipient', 'me@example.org', '--output', '/b/x.gpg']);
    expect(encryptArgs('/b/x.gpg')).toEqual(['--yes', '--symmetric', '--cipher-algo', 'AES256', '--output', '/b/x.gpg']);
  });

  it('names files by local date and time', () => {
    expect(backupName(new Date(2026, 10, 26, 9, 5))).toBe('ledger-2026-11-26T0905.json.gpg');
  });
});

describe('signing in, the way the deploy asks', () => {
  const servers = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((srv) => new Promise((resolve) => srv.close(resolve))));
  });

  /** A stand-in for /api/login: answers the options, accepts only `accept`, and records what was sent. */
  async function deploy(options, accept, optionsStatus = 200) {
    const posted = [];
    const server = createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(optionsStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(options));
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        posted.push(body);
        const ok = JSON.stringify(body) === JSON.stringify(accept);
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? { token: 'token-1' } : { error: 'incorrect' }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { base: `http://127.0.0.1:${server.address().port}`, posted };
  }

  /** Answers prompts from `answers` by their question, recording what was asked. */
  function asker(answers) {
    const asked = [];
    const ask = async (question) => {
      asked.push(question);
      return answers[question] ?? '';
    };
    return { ask, asked };
  }

  it('on Postgres asks for the email, password and code, and sends all three', async () => {
    const d = await deploy({ mfa: true, email: true }, { password: 'pw', email: 'me@example.org', code: '123456' });
    const { ask, asked } = asker({ 'Ledger email: ': 'me@example.org', 'Ledger password: ': 'pw', 'Authenticator code: ': '123456' });
    expect(await signIn(d.base, ask, {})).toBe('token-1');
    expect(asked).toEqual(['Ledger email: ', 'Ledger password: ', 'Authenticator code: ']);
  });

  it('takes the email from LEDGER_EMAIL, and sends no code while it is switched off', async () => {
    const d = await deploy({ mfa: false, email: true }, { password: 'pw', email: 'me@example.org' });
    const { ask, asked } = asker({ 'Ledger password: ': 'pw' });
    expect(await signIn(d.base, ask, { LEDGER_EMAIL: ' me@example.org ' })).toBe('token-1');
    expect(asked).toEqual(['Ledger password: ']);
    expect(d.posted).toEqual([{ password: 'pw', email: 'me@example.org' }]);
  });

  it('on the old store sends no email', async () => {
    const d = await deploy({ mfa: true, email: false }, { password: 'pw', code: '123456' });
    const { ask, asked } = asker({ 'Ledger password: ': 'pw', 'Authenticator code: ': '123456' });
    expect(await signIn(d.base, ask, { LEDGER_EMAIL: 'me@example.org' })).toBe('token-1');
    expect(asked).toEqual(['Ledger password: ', 'Authenticator code: ']);
    expect(d.posted).toEqual([{ password: 'pw', code: '123456' }]);
  });

  it('names exactly what was asked for when sign-in is refused', async () => {
    const wrong = { 'Ledger email: ': 'me@example.org', 'Ledger password: ': 'nope', 'Authenticator code: ': '000000' };
    const cases = [
      [{ mfa: true, email: true }, 'Incorrect email, password or code (a code already used to sign in works once: wait for the next).'],
      [{ mfa: false, email: true }, 'Incorrect email or password.'],
      [{ mfa: true, email: false }, 'Incorrect password or code (a code already used to sign in works once: wait for the next).'],
      [{ mfa: false, email: false }, 'Incorrect password.'],
    ];
    for (const [options, message] of cases) {
      const d = await deploy(options, { password: 'right' });
      await expect(signIn(d.base, asker(wrong).ask, {})).rejects.toThrow(message);
    }
  });

  it("stops when the deploy's sign-in options can't be read, instead of guessing", async () => {
    const d = await deploy({}, {}, 500);
    const { ask, asked } = asker({});
    await expect(signIn(d.base, ask, {})).rejects.toThrow(/Couldn't reach .* to sign in \(HTTP 500\)/);
    expect(asked).toEqual([]);
    expect(d.posted).toEqual([]);
  });
});
