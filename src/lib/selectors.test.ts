import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { homeOf, isDepBlocked, phaseOf, projectStats, stripDeps, visibleTasks, wouldCreateCycle } from './selectors';

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
    expect(phaseOf(stripped[0], stripped)).toBe('todo');
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

describe('phaseOf', () => {
  it('derives blocked from unfinished deps but never overrides done', () => {
    const tasks = [task('a', ['b']), task('b'), task('c', ['b'], 'done')];
    expect(phaseOf(tasks[0], tasks)).toBe('blocked');
    expect(phaseOf(tasks[2], tasks)).toBe('done');
  });

  it("counts any type's finished statuses as finished, for blocking too", () => {
    const tasks = [task('a', ['r']), { ...task('r'), type: 'risk' as const, status: 'closed' as const }];
    expect(phaseOf(tasks[0], tasks)).toBe('todo'); // the risk it waited on is closed
    expect(phaseOf(tasks[1], tasks)).toBe('done');
  });
});

const catalogue = {
  projects: [{ id: 'p', name: 'Home', color: '#111111', updatedAt: 1 }],
  products: [{ id: 'loans', name: 'Loans', color: '#222222', updatedAt: 1 }],
  partners: [{ id: 'telco', name: 'Telco', color: '#333333', updatedAt: 1 }],
};

describe('homeOf', () => {
  it('names where an item belongs, with its colour', () => {
    expect(homeOf(task('a'), catalogue)).toEqual({ value: 'project:p', name: 'Home', color: '#111111' });
    expect(homeOf({ project: '', product: 'loans', partner: 'telco' }, catalogue)).toEqual({ value: 'pair:loans+telco', name: 'Loans · Telco', color: '#222222' });
    expect(homeOf({ project: '', partner: 'telco' }, catalogue)).toMatchObject({ name: 'Telco' });
    expect(homeOf({ project: 'gone' }, catalogue)).toMatchObject({ value: '', name: 'No project' });
  });
});

describe('visibleTasks', () => {
  const items = [
    task('a'),
    { ...task('r'), project: '', type: 'risk' as const, status: 'open' as const, product: 'loans', partner: 'telco' },
    { ...task('i'), project: '', type: 'issue' as const, status: 'open' as const, partner: 'telco' },
  ];
  const none = { project: null, priority: null, search: '' };
  it('filters by product, partner and type; search finds the product or partner name', () => {
    expect(visibleTasks(items, catalogue, { ...none, product: 'loans' }).map((t) => t.id)).toEqual(['r']);
    expect(visibleTasks(items, catalogue, { ...none, partner: 'telco' }).map((t) => t.id)).toEqual(['r', 'i']);
    expect(visibleTasks(items, catalogue, { ...none, type: 'task' }).map((t) => t.id)).toEqual(['a']);
    expect(visibleTasks(items, catalogue, { ...none, search: 'telco' }).map((t) => t.id)).toEqual(['r', 'i']);
  });

  it("gives a product's health from its items, pairs included, by their own finished statuses", () => {
    const stats = projectStats([...items, { ...items[1], id: 'r2', status: 'closed' as const }], catalogue.products[0], 'product');
    expect([stats.total, stats.done, stats.percent]).toEqual([2, 1, 50]);
  });
});
