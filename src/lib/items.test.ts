import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../shared/state';
import type { Task } from '../types';
import { homeValue, parseHome, withDetail, withHome, withoutGroup, withType } from './items';

const item = (extra: Partial<Task> = {}): Task => ({
  id: 'i', project: '', title: 'T', status: 'todo', priority: 'med', dueDate: '2026-12-01', subs: [], recurring: null, deps: [],
  notes: '', order: 0, updatedAt: 1, ...extra,
});

describe('homes', () => {
  it('turn into one select value and back', () => {
    for (const t of [item({ project: 'home' }), item({ product: 'loans' }), item({ partner: 'telco' }), item({ product: 'loans', partner: 'telco' }), item()]) {
      const value = homeValue(t);
      expect(parseHome(value)).toEqual({ project: t.project, product: t.product ?? '', partner: t.partner ?? '' });
    }
    expect(homeValue(item({ product: 'loans', partner: 'telco' }))).toBe('pair:loans+telco');
  });

  it('a plain project excludes a product and partner', () => {
    const { task, newPair } = withHome(item({ product: 'loans', partner: 'telco' }), { project: 'home', product: 'x', partner: 'y' }, [], 9);
    expect([task.project, task.product, task.partner, newPair]).toEqual(['home', undefined, undefined, null]);
  });

  it('a product with a partner makes their pair when it is new, and only then', () => {
    const made = withHome(item({ project: 'home' }), { project: '', product: 'loans', partner: 'telco' }, [], 9);
    expect([made.task.project, made.task.product, made.task.partner]).toEqual(['', 'loans', 'telco']);
    expect(made.newPair).toEqual({ id: 'loans+telco', product: 'loans', partner: 'telco', updatedAt: 9 });
    const existing = withHome(item(), { project: '', product: 'loans', partner: 'telco' }, [made.newPair!], 10);
    expect(existing.newPair).toBeNull();
  });

  it('nothing at all is allowed', () => {
    const { task } = withHome(item({ project: 'home' }), { project: '', product: '', partner: '' }, [], 9);
    expect([task.project, 'product' in task, 'partner' in task]).toEqual(['', false, false]);
  });
});

describe('withType', () => {
  it('keeps the status when the new type has it, otherwise starts at its first', () => {
    expect(withType(item({ type: 'risk', status: 'open' }), 'issue').status).toBe('open');
    expect(withType(item({ status: 'doing' }), 'risk').status).toBe('open');
  });

  it("keeps only the fields the new type has, of a fitting kind", () => {
    // A risk's impact is a level; an issue's is text: it doesn't carry over, but text to text does.
    const risk = item({ type: 'risk', status: 'open', details: { likelihood: 'high', impact: 'med', mitigation: 'Plan B' } });
    expect(withType(risk, 'issue').details).toBeUndefined();
    const issue = item({ type: 'issue', status: 'open', details: { impact: 'Late settlement', resolution: 'Fixed' } });
    expect(withType(issue, 'change_request').details).toEqual({ impact: 'Late settlement' });
  });

  it('a task has no type key, so it looks exactly as before', () => {
    const back = withType(item({ type: 'risk', status: 'open' }), 'task');
    expect('type' in back).toBe(false);
    expect(back.status).toBe('todo');
  });
});

describe('withDetail', () => {
  it('sets a field, and clears it (and the details) when emptied', () => {
    const set = withDetail(item({ type: 'risk', status: 'open' }), 'mitigation', 'Second line');
    expect(set.details).toEqual({ mitigation: 'Second line' });
    expect('details' in withDetail(set, 'mitigation', '  ')).toBe(false);
  });
});

describe('withoutGroup', () => {
  const snap = {
    ...emptySnapshot(),
    products: [{ id: 'loans', name: 'Loans', color: '#000000', updatedAt: 1 }],
    partners: [{ id: 'telco', name: 'Telco', color: '#000000', updatedAt: 1 }, { id: 'bureau', name: 'Bureau', color: '#000000', updatedAt: 1 }],
    pairs: [
      { id: 'loans+telco', product: 'loans', partner: 'telco', updatedAt: 1 },
      { id: 'loans+bureau', product: 'loans', partner: 'bureau', updatedAt: 1 },
    ],
    tasks: [item({ id: 'a', product: 'loans', partner: 'telco' }), item({ id: 'b', partner: 'telco' }), item({ id: 'c', project: 'home' })],
  };

  it("removes a product and its pairs; its items stay, no longer in it, and are re-stamped", () => {
    const { snap: next, deleted } = withoutGroup(snap, 'product', 'loans', 'bank', 50);
    expect(next.products).toEqual([]);
    expect(next.pairs).toEqual([]);
    expect(next.tasks.map((t) => [t.id, t.product ?? '', t.partner ?? '', t.updatedAt])).toEqual([['a', '', 'telco', 50], ['b', '', 'telco', 1], ['c', '', '', 1]]);
    expect(deleted).toEqual({ 'product:bank:loans': 50, 'pair:bank:loans+telco': 50, 'pair:bank:loans+bureau': 50 });
  });

  it('removes a partner and only its pairs', () => {
    const { snap: next, deleted } = withoutGroup(snap, 'partner', 'telco', 'bank', 50);
    expect(next.partners.map((p) => p.id)).toEqual(['bureau']);
    expect(next.pairs.map((p) => p.id)).toEqual(['loans+bureau']);
    expect(next.tasks.find((t) => t.id === 'a')).toMatchObject({ product: 'loans', updatedAt: 50 });
    expect(Object.keys(deleted)).toEqual(['partner:bank:telco', 'pair:bank:loans+telco']);
  });
});
