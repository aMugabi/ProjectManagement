// Moves one user's Ledger data from a backup (npm run backup) into Postgres, checking that what
// it reads back matches the backup exactly (counts per workspace and a checksum over every field);
// any difference rolls everything back. Run it with --dry-run first: that does all of it, prints
// the comparison, and always rolls back.
// Usage:
//   DATABASE_OWNER_URL=<owner role> [DATABASE_URL=<app role>] \
//   AUTH_PASSWORD_HASH=<scrypt$...> AUTH_TOTP_SECRET=<...> AUTH_RECOVERY_CODES=<...> MFA_ENCRYPTION_KEY=<...> \
//     npm run db:import -- --email you@example.org --from ~/ledger-backups/ledger-....json.gpg [--dry-run]
// With DATABASE_URL set, a real import is then checked again through the app's own role and
// policies. AUTH_PASSWORD_HASH carries the current password over, and AUTH_TOTP_SECRET with
// AUTH_RECOVERY_CODES the authenticator and recovery codes (encrypted with MFA_ENCRYPTION_KEY,
// 32 random bytes in base64, which the deploy then needs too). Sign-in on Postgres requires MFA,
// so these are required; --without-mfa skips them (for test databases only).
// Prints counts and checksums only, never task names.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { encryptionKey } from '../api/_lib/auth/secretBox.js';
import { importDocument, verifyAsApp, type MfaToCarry } from '../api/_lib/db/import.js';

function readDocument(file: string): unknown {
  let text: string;
  if (file.endsWith('.gpg')) {
    const out = spawnSync('gpg', ['--quiet', '--decrypt', file], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
    if (out.status !== 0) throw new Error(`gpg couldn't decrypt ${file}`);
    text = out.stdout;
  } else {
    text = readFileSync(file, 'utf8');
  }
  const stored = JSON.parse(text) as { state?: unknown } | null;
  if (!stored?.state) throw new Error(`${file} isn't a Ledger backup`);
  return stored.state;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('--email');
  const from = arg('--from');
  const dryRun = process.argv.includes('--dry-run');
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!email || !from || !ownerUrl) {
    throw new Error('Usage: DATABASE_OWNER_URL=... npm run db:import -- --email you@example.org --from FILE [--dry-run]');
  }
  let mfa: MfaToCarry | undefined;
  if (!process.argv.includes('--without-mfa')) {
    const { AUTH_PASSWORD_HASH, AUTH_TOTP_SECRET, AUTH_RECOVERY_CODES } = process.env;
    if (!AUTH_PASSWORD_HASH || !AUTH_TOTP_SECRET || !AUTH_RECOVERY_CODES) {
      throw new Error('Set AUTH_PASSWORD_HASH, AUTH_TOTP_SECRET and AUTH_RECOVERY_CODES (as in Vercel) and MFA_ENCRYPTION_KEY: sign-in on Postgres requires them.');
    }
    mfa = {
      totpSecret: AUTH_TOTP_SECRET,
      recoveryHashes: AUTH_RECOVERY_CODES.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
      key: encryptionKey(),
    };
  }
  const document = readDocument(from);
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const result = await importDocument(owner, { email, passwordHash: process.env.AUTH_PASSWORD_HASH, mfa, document, dryRun });
    console.log(dryRun ? 'Dry run: everything below was done, then rolled back.\n' : 'Imported and committed.\n');
    console.log('workspace        projects  tasks  done  dependencies  deletions');
    for (const w of result.before.workspaces) {
      console.log(`${w.workspace.padEnd(16).slice(0, 16)} ${String(w.projects).padStart(8)} ${String(w.tasks).padStart(6)} ${String(w.done).padStart(5)} ${String(w.dependencies).padStart(13)} ${String(w.deletions).padStart(10)}`);
    }
    console.log(`\nRows: ${Object.entries(result.rowCounts).map(([t, n]) => `${t} ${n}`).join(', ')}; baseline log entries ${result.baselineEntries}`);
    console.log(`Checksum before ${result.before.checksum}\n         after  ${result.after.checksum}  (same)`);
    for (const n of result.notes) console.log(`Note: ${n.where}: ${n.note}`);
    console.log(mfa ? `Sign-in: password and authenticator carried over (${mfa.recoveryHashes.length} recovery codes).` : 'Sign-in: no MFA carried over (--without-mfa): this user cannot sign in on Postgres.');

    if (!dryRun && process.env.DATABASE_URL) {
      const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await app.connect();
      try {
        const check = await verifyAsApp(app, result.userId, result.before);
        console.log(check.same ? 'Checked through the app role: the same.' : `MISMATCH through the app role: ${check.after.checksum}`);
        if (!check.same) process.exitCode = 1;
      } finally {
        await app.end();
      }
    }
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
