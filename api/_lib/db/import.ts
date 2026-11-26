/**
 * The move from the old store: one user's synced document into Postgres, in one transaction, as
 * the owner role. It then reads everything back and compares the before and after summaries
 * (counts per workspace and a checksum over every field); any difference rolls it all back.
 * A dry run does the same and always rolls back.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './client.js';
import { documentToRows, rowsToDocument, summariseDocument, type ImportNote } from './mapping.js';
import { insertRows, LOGGED_TABLES, readRows, writeBaseline } from './rows.js';
import { normalizeState } from '../../../src/shared/state.js';

export type Summary = ReturnType<typeof summariseDocument>;

export interface ImportResult {
  userId: string;
  committed: boolean;
  notes: ImportNote[];
  before: Summary;
  after: Summary;
  rowCounts: Record<string, number>;
  baselineEntries: number;
}

export class ImportRefused extends Error {}

const sameSummary = (a: Summary, b: Summary) => JSON.stringify(a) === JSON.stringify(b);

export async function importDocument(
  owner: Queryable,
  input: { email: string; passwordHash?: string; document: unknown; dryRun: boolean; now?: number },
): Promise<ImportResult> {
  const now = input.now ?? Date.now();
  const email = input.email.trim().toLowerCase();
  const document = normalizeState(input.document, now);
  const before = summariseDocument(document, now);

  await owner.query('begin');
  try {
    const user = await owner.query<{ id: string }>(
      `insert into users (email) values ($1) on conflict (email) do update set email = excluded.email returning id`,
      [email],
    );
    const userId = user.rows[0].id;
    const existing = await owner.query('select 1 from workspace_members where user_id = $1 limit 1', [userId]);
    if (existing.rowCount) throw new ImportRefused(`${email} already has workspaces here; import into an empty database (or a fresh branch of one)`);
    if (input.passwordHash) {
      await owner.query(
        `insert into identities (user_id, provider, subject, secret_hash) values ($1, 'password', $2, $3)`,
        [userId, email, input.passwordHash],
      );
    }

    const { rows, notes } = documentToRows(document, userId, randomUUID, now);
    // The import writes one 'baseline' entry per row instead of an 'insert' each: history starts here.
    for (const table of LOGGED_TABLES) await owner.query(`alter table ${table} disable trigger log_${table}`);
    await insertRows(owner, rows);
    const baselineEntries = await writeBaseline(owner, rows.workspaces.map((w) => w.id));
    for (const table of LOGGED_TABLES) await owner.query(`alter table ${table} enable trigger log_${table}`);

    const after = summariseDocument(rowsToDocument(await readRows(owner, userId), document.activeWorkspaceId, now), now);
    if (!sameSummary(before, after)) {
      throw new ImportRefused(`the data read back differs from the document (before ${before.checksum}, after ${after.checksum}); nothing was saved`);
    }
    const counts = await owner.query<{ table_name: string; n: number }>(
      `select 'workspaces' table_name, count(*)::int n from workspaces where owner_id = $1
       union all select 'projects', count(*)::int from projects where owner_id = $1
       union all select 'items', count(*)::int from items where owner_id = $1
       union all select 'item_links', count(*)::int from item_links where owner_id = $1
       union all select 'legacy_deletions', count(*)::int from legacy_deletions where workspace_id in (select id from workspaces where owner_id = $1)`,
      [userId],
    );
    const rowCounts = Object.fromEntries(counts.rows.map((r) => [r.table_name, r.n]));

    await owner.query(input.dryRun ? 'rollback' : 'commit');
    return { userId, committed: !input.dryRun, notes, before, after, rowCounts, baselineEntries };
  } catch (e) {
    await owner.query('rollback').catch(() => undefined);
    throw e;
  }
}

/**
 * After a real import, the same comparison through the app's own role and policies: proves the
 * app will see exactly what was imported (no more, no less).
 */
export async function verifyAsApp(app: Queryable, userId: string, before: Summary, activeWorkspaceId?: string, now = Date.now()) {
  await app.query('begin');
  try {
    await app.query("select set_config('app.user_id', $1, true)", [userId]);
    const after = summariseDocument(rowsToDocument(await readRows(app, userId), activeWorkspaceId, now), now);
    return { same: sameSummary(before, after), after };
  } finally {
    await app.query('rollback').catch(() => undefined);
  }
}
