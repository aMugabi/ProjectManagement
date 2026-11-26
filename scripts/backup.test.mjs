import { describe, expect, it } from 'vitest';
import { backupName, encryptArgs, summarise } from './backup.mjs';

const task = (id, status = 'todo') => ({ id, status });

describe('backup script', () => {
  it('summarises every workspace as counts, active or not', () => {
    const stored = {
      version: 3,
      state: {
        tasks: [task('a'), task('b', 'done')],
        projects: [{ id: 'p' }],
        workspaces: [
          { id: 'default', name: 'Work' },
          { id: 'constructor', name: 'Odd name' },
          { id: 'empty', name: 'Empty' },
        ],
        activeWorkspaceId: 'default',
        workspaceData: { constructor: { projects: [{ id: 'q' }, { id: 'r' }], tasks: [task('c', 'done')] } },
        deleted: { 'task:default:z': 1 },
      },
    };
    expect(summarise(stored)).toEqual({
      version: 3,
      workspaces: [
        { workspace: 'Work', projects: 1, tasks: 2, done: 1 },
        { workspace: 'Odd name', projects: 2, tasks: 1, done: 1 },
        { workspace: 'Empty', projects: 0, tasks: 0, done: 0 },
      ],
      deletions: 1,
    });
  });

  it("refuses anything that isn't a Ledger backup", () => {
    expect(() => summarise(null)).toThrow("isn't a Ledger backup");
    expect(() => summarise({ state: { tasks: 'x' } })).toThrow("isn't a Ledger backup");
  });

  it('encrypts to a key when one is set, otherwise with a passphrase', () => {
    expect(encryptArgs('/b/x.gpg', 'me@example.org')).toEqual(['--batch', '--yes', '--encrypt', '--recipient', 'me@example.org', '--output', '/b/x.gpg']);
    expect(encryptArgs('/b/x.gpg')).toEqual(['--yes', '--symmetric', '--cipher-algo', 'AES256', '--output', '/b/x.gpg']);
  });

  it('names files by local date and time', () => {
    expect(backupName(new Date(2026, 10, 26, 9, 5))).toBe('ledger-2026-11-26T0905.json.gpg');
  });
});
