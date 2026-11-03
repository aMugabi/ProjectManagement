import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { effectiveStatus, isDepBlocked, stripDeps, wouldCreateCycle } from './selectors';

function task(id: string, deps: string[] = [], status: Task['status'] = 'todo'): Task {
  return {
    id,
    project: 'p',
    title: id,
    status,
    priority: 'med',
    dueDate: '2026-11-03',
    subs: [],
    recurring: null,
    deps,
    notes: '',
    order: 0,
    updatedAt: 0,
  };
}

describe('stripDeps', () => {
  it('unblocks tasks whose dependency was deleted', () => {
    const tasks = [task('a', ['b'])];
    expect(isDepBlocked(tasks[0], tasks)).toBe(true); // 'b' is missing: still blocks
    const stripped = stripDeps(tasks, new Set(['b']));
    expect(stripped[0].deps).toEqual([]);
    expect(effectiveStatus(stripped[0], stripped)).toBe('todo');
  });

  it('leaves unrelated tasks untouched (same object)', () => {
    const tasks = [task('a', ['c'])];
    expect(stripDeps(tasks, new Set(['b']))[0]).toBe(tasks[0]);
  });
});

describe('wouldCreateCycle', () => {
  const tasks = [task('a', ['b']), task('b', ['c']), task('c'), task('d')];

  it('refuses self-dependency and direct or indirect loops', () => {
    expect(wouldCreateCycle(tasks, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(tasks, 'b', 'a')).toBe(true); // a → b already
    expect(wouldCreateCycle(tasks, 'c', 'a')).toBe(true); // a → b → c
  });

  it('allows dependencies that do not close a loop', () => {
    expect(wouldCreateCycle(tasks, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(tasks, 'c', 'd')).toBe(false);
  });

  it('terminates on data that already contains a loop', () => {
    const looped = [task('x', ['y']), task('y', ['x']), task('z')];
    expect(wouldCreateCycle(looped, 'z', 'x')).toBe(false);
  });
});

describe('effectiveStatus', () => {
  it('derives blocked from unfinished deps but never overrides done', () => {
    const tasks = [task('a', ['b']), task('b'), task('c', ['b'], 'done')];
    expect(effectiveStatus(tasks[0], tasks)).toBe('blocked');
    expect(effectiveStatus(tasks[2], tasks)).toBe('done');
  });
});
