/**
 * Erasing a person's name from one user's workspace (the retention decision): runs the owner-only
 * app.redact() (db/migrations/0005) in a transaction, or a dry run that counts and rolls back.
 * Owner role only. Returns counts, never the text.
 */
import type { Queryable } from './client.js';

export class RedactRefused extends Error {}

export async function redactWorkspace(
  owner: Queryable,
  input: { email: string; workspace: string; text: string; replacement?: string; reason?: string; dryRun: boolean },
): Promise<{ rows: number; logEntries: number; committed: boolean }> {
  const ws = await owner.query<{ id: string }>(
    `select w.id from workspaces w join users u on u.id = w.owner_id where u.email = $1 and w.client_id = $2 and w.deleted_at is null`,
    [input.email.trim().toLowerCase(), input.workspace],
  );
  if (!ws.rowCount) throw new RedactRefused(`${input.email} has no workspace "${input.workspace}"`);
  await owner.query('begin');
  try {
    const done = await owner.query<{ rows: number }>('select app.redact($1, $2, $3, $4) as rows', [
      ws.rows[0].id, input.text, input.replacement ?? '[removed]', input.reason ?? '',
    ]);
    const entry = await owner.query<{ log_entries: number }>(
      "select (after ->> 'log_entries')::int log_entries from change_log where workspace_id = $1 and action = 'redact' order by id desc limit 1",
      [ws.rows[0].id],
    );
    await owner.query(input.dryRun ? 'rollback' : 'commit');
    return { rows: done.rows[0].rows, logEntries: entry.rows[0].log_entries, committed: !input.dryRun };
  } catch (e) {
    await owner.query('rollback').catch(() => undefined);
    throw e;
  }
}
