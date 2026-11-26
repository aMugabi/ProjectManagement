import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { itemProblem } from './itemSchemas';
import { firstStatus, isDone, ITEM_TYPES, statusAllowed, TYPE_IDS, typeOf } from './itemTypes';

const item = (extra: Partial<Task>): Task => ({
  id: 'i', project: '', title: 'T', status: 'todo', priority: 'med', dueDate: '2026-12-01', subs: [], recurring: null, deps: [],
  notes: '', order: 0, updatedAt: 1, ...extra,
});

describe('item types', () => {
  it('has the six types of the build plan', () => {
    expect(TYPE_IDS).toEqual(['task', 'risk', 'issue', 'decision', 'dependency', 'change_request']);
  });

  it('treats an item without a (known) type as a task', () => {
    expect(typeOf({})).toBe('task');
    expect(typeOf({ type: 'risk' })).toBe('risk');
    expect(typeOf({ type: 'constructor' as never })).toBe('task');
  });

  it('knows which statuses each type allows, and which are finished', () => {
    expect(statusAllowed('risk', 'open')).toBe(true);
    expect(statusAllowed('risk', 'todo')).toBe(false);
    expect(statusAllowed('task', 'open')).toBe(false);
    expect(isDone({ status: 'done' })).toBe(true);
    expect(isDone({ type: 'risk', status: 'closed' })).toBe(true);
    expect(isDone({ type: 'risk', status: 'open' })).toBe(false);
    expect(isDone({ type: 'change_request', status: 'approved' })).toBe(false); // still to implement
    expect(isDone({ type: 'decision', status: 'superseded' })).toBe(true);
    for (const type of TYPE_IDS) expect(ITEM_TYPES[type].statuses.some((s) => s.done)).toBe(true);
    expect(firstStatus('issue')).toBe('open');
  });
});

describe('itemProblem (the server checks before storing)', () => {
  it('accepts every type with its own statuses and fields', () => {
    expect(itemProblem(item({}))).toBeNull();
    expect(itemProblem(item({ type: 'risk', status: 'mitigating', details: { likelihood: 'high', impact: 'med', mitigation: 'Backup line' } }))).toBeNull();
    expect(itemProblem(item({ type: 'decision', status: 'decided', details: { decidedBy: 'Board', decidedOn: '2026-11-20' } }))).toBeNull();
    expect(itemProblem(item({ type: 'dependency', status: 'waiting', product: 'p', partner: 'q', details: { onWhom: 'Partner IT' } }))).toBeNull();
  });

  it('refuses unknown types, wrong statuses, unknown or badly formed fields', () => {
    expect(itemProblem(item({ type: 'idea' as never }))).toMatch(/unknown type/);
    expect(itemProblem(item({ type: 'risk', status: 'todo' }))).toMatch(/status "todo" isn't one a risk/);
    expect(itemProblem(item({ type: 'risk', status: 'open', details: { likelihood: 'certain' } }))).toMatch(/likelihood/);
    expect(itemProblem(item({ type: 'risk', status: 'open', details: { colour: 'red' } }))).toMatch(/risk fields/);
    expect(itemProblem(item({ details: { anything: 1 } }))).toMatch(/task fields/);
    expect(itemProblem(item({ type: 'decision', status: 'decided', details: { decidedOn: 'last week' } }))).toMatch(/decidedOn/);
  });

  it('refuses an item in a plain project and a product or partner at once', () => {
    expect(itemProblem(item({ project: 'home', product: 'p' }))).toMatch(/plain project/);
    expect(itemProblem(item({ project: 'home', partner: 'q' }))).toMatch(/plain project/);
    expect(itemProblem(item({ product: 'p', partner: 'q' }))).toBeNull();
  });
});
