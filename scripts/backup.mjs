#!/usr/bin/env node
// Encrypted backups of the cloud copy (cloud deploys only).
//   npm run backup                     sign in, download everything, save it encrypted with gpg
//   npm run backup -- --verify FILE    decrypt a backup and show what it holds (counts only)
//   npm run backup -- --restore FILE   upload a backup, merged with the cloud copy (newest edit
//                                      wins; deletions stay deleted), e.g. after losing the data
// Settings (environment variables):
//   LEDGER_URL               the deploy (default https://mugabi-ledger.vercel.app)
//   LEDGER_BACKUP_DIR        where backups go (default ~/ledger-backups). Never inside this
//                            repository: it is public.
//   LEDGER_BACKUP_RECIPIENT  a gpg key (email or id) to encrypt to; then only that key's private
//                            half can read backups. Without it, gpg asks for a passphrase.
// The unencrypted data only ever passes through memory and gpg's input, never a file. Each run
// signs in (one login attempt against the rate limit) and signs that session out at the end.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

/** What a backup holds, as counts per workspace: enough to check it without showing any content. */
export function summarise(stored) {
  const s = stored?.state;
  if (!s || !Array.isArray(s.tasks) || !Array.isArray(s.projects)) throw new Error("That isn't a Ledger backup.");
  const data = { ...(s.workspaceData ?? {}), [s.activeWorkspaceId]: { projects: s.projects, tasks: s.tasks } };
  const workspaces = (s.workspaces ?? []).map((w) => {
    // Own-property lookup: workspace ids come from names, and could be 'constructor'.
    const d = Object.hasOwn(data, w.id) ? data[w.id] : {};
    const tasks = Array.isArray(d.tasks) ? d.tasks : [];
    return {
      workspace: w.name,
      projects: Array.isArray(d.projects) ? d.projects.length : 0,
      tasks: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
    };
  });
  return { version: stored.version, workspaces, deletions: Object.keys(s.deleted ?? {}).length };
}

/** gpg arguments for writing `file`: to a key when one is given, else with a passphrase (AES-256). */
export function encryptArgs(file, recipient) {
  return recipient
    ? ['--batch', '--yes', '--encrypt', '--recipient', recipient, '--output', file]
    : ['--yes', '--symmetric', '--cipher-algo', 'AES256', '--output', file];
}

/** e.g. 'ledger-2026-11-26T1342.json.gpg' (local time). */
export function backupName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `ledger-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}.json.gpg`;
}

function gpg(args, input) {
  return new Promise((done, fail) => {
    const child = spawn('gpg', args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', (e) => fail(e.code === 'ENOENT' ? new Error('gpg is not installed.') : e));
    child.on('close', (code) => (code === 0 ? done(Buffer.concat(chunks)) : fail(new Error(`gpg stopped (exit ${code}).`))));
    child.stdin.end(input);
  });
}

function prompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  let hidden = '';
  // Echo a hidden prompt itself, never what is typed after it.
  rl._writeToOutput = (s) => {
    if (!hidden) process.stdout.write(s);
    else if (s.includes(hidden)) process.stdout.write(hidden);
  };
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question, secret = false) => {
    hidden = secret ? question : '';
    process.stdout.write(question);
    const { value } = await lines.next();
    if (secret) process.stdout.write('\n');
    hidden = '';
    return (value ?? '').trim();
  };
  return { ask, close: () => rl.close() };
}

async function signIn(base, ask) {
  const mfa = await fetch(`${base}/api/login`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((b) => b.mfa === true)
    .catch(() => false);
  const password = await ask('Ledger password: ', true);
  const code = mfa ? await ask('Authenticator code: ') : '';
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(code ? { password, code } : { password }),
  });
  if (res.status === 401) {
    throw new Error(mfa ? 'Incorrect password or code (a code already used to sign in works once: wait for the next).' : 'Incorrect password.');
  }
  if (res.status === 429) throw new Error('Too many sign-in attempts; try again in 15 minutes.');
  if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status}).`);
  return (await res.json()).token;
}

async function signOut(base, token) {
  await fetch(`${base}/api/login`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

function printSummary(summary) {
  for (const w of summary.workspaces) console.log(`  ${w.workspace}: ${w.projects} projects, ${w.tasks} tasks (${w.done} done)`);
  console.log(`  ${summary.deletions} remembered deletions; data version ${summary.version}`);
}

async function readBackup(file) {
  const plain = await gpg(['--quiet', '--decrypt', resolve(file)]);
  return JSON.parse(plain.toString('utf8'));
}

async function main() {
  const base = (process.env.LEDGER_URL || 'https://mugabi-ledger.vercel.app').replace(/\/$/, '');
  const dir = process.env.LEDGER_BACKUP_DIR || join(homedir(), 'ledger-backups');
  const recipient = process.env.LEDGER_BACKUP_RECIPIENT;
  const [mode, file] = process.argv.slice(2);
  // pinentry (gpg's passphrase prompt) needs to know the terminal when it runs in one.
  if (!process.env.GPG_TTY && process.stdin.isTTY) {
    try {
      process.env.GPG_TTY = execFileSync('tty', { stdio: ['inherit', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      // a graphical pinentry still works
    }
  }

  if (mode === '--verify') {
    if (!file) throw new Error('Usage: npm run backup -- --verify FILE');
    console.log(`${file} decrypts and holds:`);
    printSummary(summarise(await readBackup(file)));
    return;
  }

  if (mode && mode !== '--restore') throw new Error(`Unknown option ${mode}. Use no option, --verify FILE or --restore FILE.`);
  let restoring = null;
  if (mode === '--restore') {
    if (!file) throw new Error('Usage: npm run backup -- --restore FILE');
    restoring = await readBackup(file);
    console.log(`${file} holds:`);
    printSummary(summarise(restoring));
    console.log(`\nThis uploads it to ${base}, merged with the cloud copy: newer edits there are kept,`);
    console.log('and anything deleted since the backup stays deleted.');
  }

  // All questions first, then close the prompt: gpg's own passphrase prompt needs the terminal.
  const { ask, close } = prompter();
  let token;
  try {
    if (restoring && (await ask('Type "restore" to go ahead: ')) !== 'restore') throw new Error('Not restored.');
    token = await signIn(base, ask);
  } finally {
    close();
  }

  try {
    if (restoring) {
      const res = await fetch(`${base}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(restoring),
      });
      if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status}).`);
      console.log('Restored. The cloud copy now holds:');
      printSummary(summarise(await res.json()));
      return;
    }
    const res = await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
    const text = await res.text();
    const stored = JSON.parse(text);
    if (stored === null) throw new Error('The cloud has no data yet; nothing to back up.');
    const summary = summarise(stored);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const out = join(dir, backupName());
    await gpg(encryptArgs(out, recipient), text);
    console.log(`Saved ${out}${recipient ? ` (encrypted to ${recipient})` : ' (passphrase-encrypted)'}, holding:`);
    printSummary(summary);
    console.log(`\nCheck it reads back with: npm run backup -- --verify "${out}"`);
  } finally {
    await signOut(base, token);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
