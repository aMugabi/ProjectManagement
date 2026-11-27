import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDir, saveValues } from './save-values.mjs';

const mode = (path) => statSync(path).mode & 0o777;
let base;
afterEach(() => base && rmSync(base, { recursive: true, force: true }));

describe('saving secret values to private files', () => {
  it('writes one file per value, readable only by you, in a private folder', () => {
    base = mkdtempSync(join(tmpdir(), 'ledger-save-'));
    const dir = join(base, 'cutover');
    const written = saveValues(dir, { AUTH_TOTP_SECRET: 'ABC', AUTH_RECOVERY_CODES: 'h1,h2' }, '/elsewhere/repo');
    expect(written).toEqual([join(dir, 'AUTH_TOTP_SECRET'), join(dir, 'AUTH_RECOVERY_CODES')]);
    expect(readFileSync(join(dir, 'AUTH_TOTP_SECRET'), 'utf8')).toBe('ABC'); // no newline: "$(cat …)" reads it as is
    expect(readFileSync(join(dir, 'AUTH_RECOVERY_CODES'), 'utf8')).toBe('h1,h2');
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, 'AUTH_TOTP_SECRET'))).toBe(0o600);
  });

  it('replaces an earlier value and tightens a file that was readable by others', () => {
    base = mkdtempSync(join(tmpdir(), 'ledger-save-'));
    writeFileSync(join(base, 'AUTH_PASSWORD_HASH'), 'old', { mode: 0o644 });
    saveValues(base, { AUTH_PASSWORD_HASH: 'scrypt$new' }, '/elsewhere/repo');
    expect(readFileSync(join(base, 'AUTH_PASSWORD_HASH'), 'utf8')).toBe('scrypt$new');
    expect(mode(join(base, 'AUTH_PASSWORD_HASH'))).toBe(0o600);
    expect(mode(base)).toBe(0o700);
  });

  it('refuses the public repository and any folder inside it', () => {
    expect(() => saveValues('/work/repo', { A: '1' }, '/work/repo')).toThrow('the repository is public');
    expect(() => saveValues('/work/repo/secrets', { A: '1' }, '/work/repo')).toThrow('the repository is public');
    // The real default: this repository's own folder.
    expect(() => saveValues(resolve('scripts', 'tmp-should-not-exist'), { A: '1' })).toThrow('the repository is public');
  });

  it('reads the folder after --save, and refuses --save without one', () => {
    expect(saveDir(['node', 'x.mjs'])).toBeNull();
    expect(saveDir(['node', 'x.mjs', '--save', '/home/me/.ledger-cutover'])).toBe('/home/me/.ledger-cutover');
    expect(() => saveDir(['node', 'x.mjs', '--save'])).toThrow('--save needs a folder');
    expect(() => saveDir(['node', 'x.mjs', '--save', '--other'])).toThrow('--save needs a folder');
  });
});
