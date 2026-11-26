/**
 * Against a real Postgres with db/migrations applied: the import, reading back through the app
 * role, and the migration runner. Skipped unless TEST_DB_OWNER_URL and TEST_DB_APP_URL are set;
 * runs locally against the offline-database-tests skill's served database (see db/README.md).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../../scripts/db-migrate';
import { withUser } from './client';
import { ImportRefused, importDocument, verifyAsApp } from './import';
import { rowsToDocument, summariseDocument } from './mapping';
import { readRows } from './rows';
import { syncDocument } from './sync';
import { NOW, document, task } from './testing/document';

const OWNER_URL = process.env.TEST_DB_OWNER_URL;
/** Each run uses its own users, so runs can share one database. */
const RUN = Date.now().toString(36);
const ME = `me-${RUN}@example.org`;
const APP_URL = process.env.TEST_DB_APP_URL;

describe.skipIf(!OWNER_URL || !APP_URL)('the database (TEST_DB_OWNER_URL, TEST_DB_APP_URL)', () => {
  let owner: pg.Client;
  let app: pg.Pool;
  let userId: string;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new pg.Pool({ connectionString: APP_URL, max: 2 });
  });
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  it('a dry run does everything, compares, and leaves nothing behind', async () => {
    const result = await importDocument(owner, { email: `dry-${RUN}@example.org`, document: document(), dryRun: true, now: NOW });
    expect(result.committed).toBe(false);
    expect(result.after).toEqual(result.before);
    expect(result.rowCounts.items).toBe(5);
    expect((await owner.query('select count(*)::int n from users where email = $1', [`dry-${RUN}@example.org`])).rows[0].n).toBe(0);
    expect((await owner.query('select count(*)::int n from items where owner_id = $1', [result.userId])).rows[0].n).toBe(0);
  });

  it('imports everything, with the same counts and checksum', async () => {
    const result = await importDocument(owner, {
      email: ` ${ME.toUpperCase()} `, passwordHash: 'scrypt$00$11', document: document(), dryRun: false, now: NOW,
    });
    userId = result.userId;
    expect(result.committed).toBe(true);
    expect(result.after).toEqual(result.before);
    expect(result.before).toEqual(summariseDocument(document(), NOW));
    expect(result.rowCounts).toEqual({ workspaces: 3, projects: 3, items: 5, item_links: 2, legacy_deletions: 2 });
    const who = await owner.query("select email, (select provider || ' ' || secret_hash from identities where user_id = users.id) identity from users where id = $1", [userId]);
    expect(who.rows[0]).toEqual({ email: ME, identity: 'password scrypt$00$11' });
  });

  it('starts history with one baseline entry per imported row, and no inserts', async () => {
    const log = await owner.query(
      `select action, count(*)::int n from change_log where workspace_id in (select workspace_id from workspace_members where user_id = $1) group by action`,
      [userId],
    );
    // 3 workspaces + 3 memberships + 3 projects + 5 items + 2 links
    expect(log.rows).toEqual([{ action: 'baseline', n: 16 }]);
  });

  it('gives the app exactly the document back, to the millisecond, in any time zone', async () => {
    const rows = await withUser(app, userId, async (c) => {
      await c.query("set local timezone = 'Pacific/Kiritimati'");
      return readRows(c, userId);
    });
    expect(rowsToDocument(rows, 'default', NOW)).toEqual(document());
    const client = await app.connect(); // one connection: begin, set the user, read
    try {
      const check = await verifyAsApp(client, userId, summariseDocument(document(), NOW), 'default', NOW);
      expect(check.same).toBe(true);
    } finally {
      client.release();
    }
  });

  it("shows another user none of it", async () => {
    const other = (await owner.query('insert into users (email) values ($1) returning id', [`other-${RUN}@example.org`])).rows[0].id as string;
    const none = { workspaces: [], projects: [], items: [], links: [], legacyDeletions: [], settings: null };
    expect(await withUser(app, other, (c) => readRows(c, userId))).toEqual(none); // even asking for the first user's
    expect(await readRows(owner, other)).toEqual(none); // the owner bypasses the policies: the query filters by itself
  });

  it('refuses to import the same user twice', async () => {
    await expect(importDocument(owner, { email: ME, document: document(), dryRun: false, now: NOW })).rejects.toBeInstanceOf(ImportRefused);
  });

  it('logs later edits normally (the import turned the triggers back on)', async () => {
    await withUser(app, userId, (c) => c.query("update items set title = 'Edited' where client_id = 't1'"));
    const last = await owner.query(
      `select action, actor_id, after->>'title' title from change_log
        where table_name = 'items' and workspace_id in (select workspace_id from workspace_members where user_id = $1) order by id desc limit 1`,
      [userId],
    );
    expect(last.rows[0]).toEqual({ action: 'update', actor_id: userId, title: 'Edited' });
  });

  it('refuses, and saves nothing, when something would not come back exactly', async () => {
    const doc = document();
    doc.tasks[0].remindDaysBefore = 2.6; // stored as whole days
    const email = `odd-${RUN}@example.org`;
    await expect(importDocument(owner, { email, document: doc, dryRun: false, now: NOW })).rejects.toThrow(/differs from the document; nothing was saved|differs/);
    expect((await owner.query('select count(*)::int n from users where email = $1', [email])).rows[0].n).toBe(0);
  });

  /** This user's change-log entries by the user themself, as 'table action' → count. */
  async function logCounts(): Promise<Record<string, number>> {
    const r = await owner.query<{ k: string; n: number }>(
      `select table_name || ' ' || action k, count(*)::int n from change_log where actor_id = $1 group by 1 order by 1`,
      [userId],
    );
    return Object.fromEntries(r.rows.map((x) => [x.k, x.n]));
  }
  const sync = (upload: unknown, now: number) => withUser(app, userId, (c) => syncDocument(c, userId, upload, now));

  it('syncs edits, new tasks, deletions and a new workspace through the app role, logging each as the user', async () => {
    const before = await logCounts();
    const upload = document();
    upload.tasks[0] = { ...upload.tasks[0], title: 'From a device', updatedAt: NOW + 1000 };
    upload.tasks = [task('n1', 'home', { deps: ['t2'], updatedAt: NOW + 1000 }), ...upload.tasks.filter((t) => t.id !== 't3')];
    upload.deleted['task:default:t3'] = NOW + 2000;
    upload.workspaces.push({ id: 'ws-new', name: 'New', updatedAt: NOW + 1000 });
    upload.workspaceData['ws-new'] = { projects: [{ id: 'np', name: 'NP', color: '#123456', updatedAt: NOW + 1000 }], tasks: [task('x1', 'np', { updatedAt: NOW + 1000 })] };
    upload.reminders = { ...upload.reminders, digestTime: '06:15', updatedAt: NOW + 1000 };

    const reply = await sync(upload, NOW + 5000);
    expect(reply.tasks.map((t) => t.id).sort()).toEqual(['n1', 't1', 't2']);
    expect(reply.tasks.find((t) => t.id === 't1')!.title).toBe('From a device');
    expect(reply.tasks.find((t) => t.id === 'n1')!.deps).toEqual(['t2']);
    expect(reply.deleted['task:default:t3']).toBe(NOW + 2000);
    expect(reply.workspaceData['ws-new'].tasks.map((t) => [t.id, t.project])).toEqual([['x1', 'np']]);
    const filed = await owner.query(
      `select p.client_id from items i join projects p on p.id = i.project_id where i.owner_id = $1 and i.client_id = 'x1'`,
      [userId],
    );
    expect(filed.rows).toEqual([{ client_id: 'np' }]); // linked to the project row, not just named
    expect(reply.reminders.digestTime).toBe('06:15');

    const after = await logCounts();
    const added = Object.fromEntries(Object.entries(after).map(([k, n]) => [k, n - (before[k] ?? 0)]).filter(([, n]) => n));
    expect(added).toEqual({
      'items insert': 2, // n1, x1
      'items update': 2, // t1 edited, t3 deleted
      'item_links insert': 1, // n1 waits for t2
      'workspaces insert': 1,
      'workspaces update': 1, // its place in the list
      'workspace_members insert': 1,
      'projects insert': 1,
    });
  });

  it('writes nothing when the same upload comes again', async () => {
    const before = await logCounts();
    const upload = rowsToDocument(await readRows(owner, userId), 'default', NOW + 6000);
    await sync(upload, NOW + 6000);
    expect(await logCounts()).toEqual(before);
  });

  it("a stale device can't bring a deleted task back, and is told to drop it", async () => {
    const reply = await sync(document(), NOW + 7000); // the original copy: old t1, and t3 still there
    expect(reply.tasks.map((t) => t.id).sort()).toEqual(['n1', 't1', 't2']);
    expect(reply.tasks.find((t) => t.id === 't1')!.title).toBe('From a device');
    expect(reply.deleted['task:default:t3']).toBe(NOW + 2000);
    const t3 = await owner.query("select deleted_at is not null deleted from items where owner_id = $1 and client_id = 't3'", [userId]);
    expect(t3.rows).toEqual([{ deleted: true }]);
  });

  it('two devices syncing at once: the second waits for the first, and both are kept', async () => {
    const base = rowsToDocument(await readRows(owner, userId), 'default', NOW + 8000);
    const withRace = (extra: (d: typeof base) => void) => {
      const d = structuredClone(base);
      d.workspaces.push({ id: 'race', name: 'Race', updatedAt: NOW + 8000 });
      d.workspaceData.race = { projects: [], tasks: [] };
      extra(d);
      return d;
    };
    const first = withRace((d) => (d.tasks.find((t) => t.id === 't1')!.notes = 'first device', d.tasks.find((t) => t.id === 't1')!.updatedAt = NOW + 8001));
    const second = withRace((d) => (d.tasks.find((t) => t.id === 't2')!.notes = 'second device', d.tasks.find((t) => t.id === 't2')!.updatedAt = NOW + 8002));

    const a = await app.connect();
    try {
      await a.query('begin');
      await a.query("select set_config('app.user_id', $1, true)", [userId]);
      await syncDocument(a, userId, first, NOW + 9000); // holds the lock until it commits
      let settled = false;
      const b = sync(second, NOW + 9000).finally(() => (settled = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // waiting for the first device
      await a.query('commit');
      const reply = await b;
      expect(reply.workspaces.filter((w) => w.id === 'race')).toHaveLength(1);
      expect(reply.tasks.find((t) => t.id === 't1')!.notes).toBe('first device');
      expect(reply.tasks.find((t) => t.id === 't2')!.notes).toBe('second device');
    } finally {
      await a.query('rollback').catch(() => undefined);
      a.release();
    }
  });

  it('a newer edit brings a deleted task back, and an emptied dependency list removes the link', async () => {
    const upload = rowsToDocument(await readRows(owner, userId), 'default', NOW + 10000);
    upload.tasks.push(task('t3', 'admin', { title: 'Back', updatedAt: NOW + 10000 }));
    upload.tasks = upload.tasks.map((t) => (t.id === 'n1' ? { ...t, deps: [], updatedAt: NOW + 10000 } : t));
    const before = await logCounts();
    const reply = await sync(upload, NOW + 10000);
    expect(reply.tasks.find((t) => t.id === 't3')!.title).toBe('Back');
    expect(reply.tasks.find((t) => t.id === 'n1')!.deps).toEqual([]);
    const t3 = await owner.query("select deleted_at is null live from items where owner_id = $1 and client_id = 't3'", [userId]);
    expect(t3.rows).toEqual([{ live: true }]);
    expect((await logCounts())['item_links delete'] ?? 0).toBe((before['item_links delete'] ?? 0) + 1);
  });

  it('once devices have forgotten a deletion, a stale copy is refused and the reply marks it deleted now', async () => {
    await owner.query(
      "update items set edited_at = '2019-01-01', deleted_at = '2020-01-01' where owner_id = $1 and client_id = 't3'",
      [userId],
    );
    const upload = rowsToDocument(await readRows(owner, userId), 'default', NOW + 11000);
    upload.tasks.push(task('t3', 'admin', { title: 'Stale', updatedAt: Date.parse('2019-06-01') }));
    const reply = await sync(upload, NOW + 11000);
    expect(reply.tasks.map((t) => t.id)).not.toContain('t3');
    expect(reply.deleted['task:default:t3']).toBe(NOW + 11000);
    const t3 = await owner.query("select title, deleted_at is not null deleted from items where owner_id = $1 and client_id = 't3'", [userId]);
    expect(t3.rows).toEqual([{ title: 'Back', deleted: true }]);
  });

  it('migrates a new database once, and then does nothing', async () => {
    const name = `ledger_migrate_${RUN}`;
    await owner.query(`create database ${name}`);
    const url = new URL(OWNER_URL!);
    url.pathname = `/${name}`;
    const fresh = new pg.Client({ connectionString: url.toString() });
    await fresh.connect();
    try {
      expect(await migrate(fresh)).toEqual(['0001_foundation.sql']);
      expect(await migrate(fresh)).toEqual([]);
      expect((await fresh.query("select count(*)::int n from pg_tables where schemaname = 'public'")).rows[0].n).toBe(17);
    } finally {
      await fresh.end();
      await owner.query(`drop database ${name}`);
    }
  });
});
