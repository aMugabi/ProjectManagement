import { describe, expect, it } from 'vitest';
import type { Project, Task } from '../types';
import { mergeStates } from './merge';
import { normalizeState, type SyncedState } from './state';

function task(id: string, updatedAt: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    project: 'p',
    title: id,
    status: 'todo',
    priority: 'med',
    dueDate: '2026-11-10',
    subs: [],
    recurring: null,
    deps: [],
    notes: '',
    order: 0,
    updatedAt,
    ...extra,
  };
}

const project: Project = { id: 'p', name: 'P', color: '#000', updatedAt: 1 };

function state(tasks: Task[], extra: Partial<SyncedState> = {}): SyncedState {
  return normalizeState({ tasks, projects: [project], ...extra });
}

/** Tombstones are pruned after 60 days, so they need realistic times. */
const T = Date.now();

const titles = (s: SyncedState) => s.tasks.map((t) => t.title).sort();

describe('mergeStates', () => {
  it('keeps an offline edit over a stale cloud copy', () => {
    const local = state([task('a', 200, { title: 'edited offline' })]);
    const remote = state([task('a', 100, { title: 'old' })]);
    expect(titles(mergeStates(local, remote))).toEqual(['edited offline']);
  });

  it('keeps edits to different tasks made on two devices', () => {
    const deviceA = state([task('a', 200, { title: 'a2' }), task('b', 100)]);
    const deviceB = state([task('a', 100), task('b', 300, { title: 'b2' })]);
    expect(titles(mergeStates(deviceA, deviceB))).toEqual(['a2', 'b2']);
  });

  it('includes tasks that only exist on one side', () => {
    expect(titles(mergeStates(state([task('a', 1)]), state([task('b', 1)])))).toEqual(['a', 'b']);
  });

  it('lets a delete beat an older edit, and a newer edit beat an older delete', () => {
    const deleter = state([], { deleted: { 'task:default:a': T + 500, 'task:default:b': T + 500 } });
    const editor = state([task('a', T + 400), task('b', T + 600, { title: 'b edited after delete' })]);
    expect(titles(mergeStates(deleter, editor))).toEqual(['b edited after delete']);
    expect(titles(mergeStates(editor, deleter))).toEqual(['b edited after delete']);
  });

  it('strips deps on tasks deleted elsewhere', () => {
    const local = state([task('a', 100, { deps: ['b'] }), task('b', 100)]);
    const remote = state([task('a', 100, { deps: ['b'] })], { deleted: { 'task:default:b': T } });
    expect(mergeStates(local, remote).tasks[0].deps).toEqual([]);
  });

  it('gives ties to the incoming copy (cloud on load), matching the pre-merge behaviour', () => {
    const local = state([task('a', 0, { title: 'local' })]);
    const remote = state([task('a', 0, { title: 'cloud' })]);
    expect(titles(mergeStates(local, remote))).toEqual(['cloud']);
  });

  it('merges every workspace and splits them back out around the chosen active one', () => {
    const workspaces = [
      { id: 'default', name: 'Home', updatedAt: 1 },
      { id: 'work', name: 'Work', updatedAt: 1 },
    ];
    const local = state([task('h1', 1)], {
      workspaces,
      activeWorkspaceId: 'default',
      workspaceData: { work: { projects: [], tasks: [task('w1', 1)] } },
    });
    const remote = normalizeState({
      workspaces,
      activeWorkspaceId: 'work',
      tasks: [task('w1', 1), task('w2', 2)],
      projects: [],
      workspaceData: { default: { projects: [project], tasks: [task('h1', 1), task('h2', 2)] } },
    });
    const merged = mergeStates(local, remote, 'default');
    expect(merged.activeWorkspaceId).toBe('default');
    expect(titles(merged)).toEqual(['h1', 'h2']);
    expect(merged.workspaceData.work.tasks.map((t) => t.id).sort()).toEqual(['w1', 'w2']);
    expect(merged.workspaceData.default).toBeUndefined();
  });

  it('scopes project tombstones to their workspace', () => {
    const workspaces = [
      { id: 'default', name: 'Home', updatedAt: 1 },
      { id: 'work', name: 'Work', updatedAt: 1 },
    ];
    const s = state([], {
      workspaces,
      workspaceData: { work: { projects: [project], tasks: [] } },
      deleted: { 'project:default:p': T },
    });
    const merged = mergeStates(s, s, 'default');
    expect(merged.projects).toEqual([]);
    expect(merged.workspaceData.work.projects.map((p) => p.id)).toEqual(['p']);
  });

  it('prunes tombstones older than 60 days', () => {
    const old = T - 61 * 24 * 60 * 60 * 1000;
    expect(normalizeState({ deleted: { 'task:default:x': old, 'task:default:y': T } }).deleted).toEqual({
      'task:default:y': T,
    });
  });

  it('upgrades pre-sync (v2) data: missing stamps become 0 and defaults are filled', () => {
    const legacy = { tasks: [{ ...task('a', 0), updatedAt: undefined }], projects: [{ id: 'p', name: 'P', color: '#000' }] };
    const merged = mergeStates(legacy, null);
    expect(merged.tasks[0].updatedAt).toBe(0);
    expect(merged.projects[0].updatedAt).toBe(0);
    expect(merged.reminders.digestTime).toBe('08:00');
    expect(merged.workspaces[0].id).toBe('default');
  });
});
