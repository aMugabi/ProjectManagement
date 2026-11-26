// Applies db/migrations/*.sql in name order, each once and each in its own transaction, as the
// owner role. Records what it applied in migrations.applied (a schema the app role can't see).
// Usage: DATABASE_OWNER_URL=postgres://<owner>@<host>/<db> npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));

/** Applies every migration not yet applied; returns their names. */
export async function migrate(client: pg.ClientBase, dir = DIR): Promise<string[]> {
  await client.query('create schema if not exists migrations');
  await client.query('create table if not exists migrations.applied (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await client.query<{ name: string }>('select name from migrations.applied')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await client.query('begin');
    try {
      await client.query(readFileSync(join(dir, name), 'utf8'));
      await client.query('insert into migrations.applied (name) values ($1)', [name]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw new Error(`${name}: ${(e as Error).message}`);
    }
    applied.push(name);
  }
  return applied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) {
    console.error('Set DATABASE_OWNER_URL to the owner role\'s connection string (not the app\'s).');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date: nothing to apply.');
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
