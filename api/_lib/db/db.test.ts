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
import { NOW, document } from './testing/document';

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
