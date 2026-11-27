// Saves secret values (sign-in settings for Vercel and the import) as private files, one per
// value, instead of printing them: nothing to select and copy out of a terminal, so nothing is
// mistyped or left in its scrollback. Used by `npm run setup-mfa -- --save DIR` and
// `npm run hash-password -- --save DIR`. Read a value back with "$(cat DIR/NAME)".
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This repository's folder: it is public, so values are never saved inside it. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The folder after `--save`, or null when the values are to be printed. */
export function saveDir(argv = process.argv) {
  const i = argv.indexOf('--save');
  if (i < 0) return null;
  const dir = argv[i + 1];
  if (!dir || dir.startsWith('--')) throw new Error('--save needs a folder, e.g. --save ~/.ledger-cutover');
  return resolve(dir);
}

/** Writes each value to DIR/NAME, readable only by you (folder 0700, files 0600). */
export function saveValues(dir, values, repo = REPO) {
  const target = resolve(dir);
  if (target === repo || target.startsWith(repo + sep)) {
    throw new Error(`Not saving secrets inside ${repo}: the repository is public. Choose a folder such as ~/.ledger-cutover.`);
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700);
  const written = [];
  for (const [name, value] of Object.entries(values)) {
    const file = resolve(target, name);
    writeFileSync(file, value, { mode: 0o600 });
    chmodSync(file, 0o600); // an existing file keeps its old mode otherwise
    written.push(file);
  }
  return written;
}
