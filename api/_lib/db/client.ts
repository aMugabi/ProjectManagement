/**
 * Connections to Ledger's Postgres database (db/migrations). DATABASE_URL is the app's own login
 * role (a member of ledger_app, which owns nothing and can't bypass row-level security), never
 * the owner's; the owner's connection is used only by the migration and import scripts.
 */
import pg from 'pg';

/** Anything that can run a query: a pool, a pooled client or a plain client. */
export type Queryable = Pick<pg.ClientBase, 'query'>;

let pool: pg.Pool | null = null;

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** One small pool per function instance. */
export function appPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool ??= new pg.Pool({ connectionString, max: 3 });
  return pool;
}

/**
 * Runs `work` in one transaction as `userId`, so row-level security shows only that user's
 * workspaces. Every read and write of workspace data by the app goes through here.
 */
export async function withUser<T>(db: pg.Pool, userId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Closes the app's pool (for tests and scripts that end). */
export async function endAppPool(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end();
}
