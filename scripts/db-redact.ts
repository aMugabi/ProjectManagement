// Removes a person's name from one workspace on Postgres: items, sign-offs, names and the change
// log (the retention decision; db/migrations/0005). Asks for the name at a prompt, so it stays out
// of the shell history. Run with --dry-run first: it counts what would change and rolls back.
// Usage:
//   DATABASE_OWNER_URL=<owner role> npm run db:redact -- --email you@example.org --workspace <workspace id> \
//     [--replacement "[removed]"] [--reason "Request of 27 Nov"] [--dry-run]
// Devices pick the change up on their next sync. Backups taken before still hold the name: delete
// or re-take them. Prints counts only.
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { redactWorkspace } from '../api/_lib/db/redact.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--email');
  const workspace = arg('--workspace');
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!email || !workspace || !ownerUrl) {
    throw new Error('Usage: DATABASE_OWNER_URL=... npm run db:redact -- --email you@example.org --workspace ID [--replacement TEXT] [--reason TEXT] [--dry-run]');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const text = (await prompt.question('Name to remove (exactly as written): ')).trim();
  prompt.close();
  const dryRun = process.argv.includes('--dry-run');
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const result = await redactWorkspace(owner, { email, workspace, text, replacement: arg('--replacement'), reason: arg('--reason'), dryRun });
    console.log(
      `${dryRun ? 'Dry run (rolled back): would change' : 'Removed from'} ${result.rows} row${result.rows === 1 ? '' : 's'} and ${result.logEntries} change-log entr${result.logEntries === 1 ? 'y' : 'ies'}.`,
    );
    if (!dryRun) console.log('Recorded as one "redact" entry in the change log. Backups taken before still hold the name.');
  } finally {
    await owner.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
