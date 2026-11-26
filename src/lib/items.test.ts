import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../shared/state';
import type { Task } from '../types';
import { convertProject, homeValue, withCompletion, withDate, withOccurrenceDone, withWaiting, sortProjects, sortSummary, uniqueId, parseHome, withDetail, withHome, withoutGroup, withType } from './items';

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

describe('convertProject', () => {
  const snap = {
    ...emptySnapshot(),
    projects: [{ id: 'mobile-loans', name: 'Mobile loans', color: '#7b6a94', updatedAt: 1 }, { id: 'home', name: 'Home', color: '#111111', updatedAt: 1 }],
    partners: [{ id: 'telco', name: 'Telco', color: '#4f7a86', updatedAt: 1 }],
    tasks: [item({ id: 'a', project: 'mobile-loans' }), item({ id: 'b', project: 'mobile-loans', deps: ['a'] }), item({ id: 'c', project: 'home' })],
  };

  it('makes a new product from the project, moves its items and removes only the project', () => {
    const { snap: next, deleted } = convertProject(snap, 'mobile-loans', { kind: 'product', product: 'new:Mobile loans' }, 'bank', 50);
    expect(next.products).toEqual([{ id: 'mobile-loans', name: 'Mobile loans', color: '#7b6a94', updatedAt: 50 }]);
    expect(next.projects.map((p) => p.id)).toEqual(['home']);
    expect(next.tasks.map((t) => [t.id, t.project, t.product ?? '', t.updatedAt])).toEqual([['a', '', 'mobile-loans', 50], ['b', '', 'mobile-loans', 50], ['c', 'home', '', 1]]);
    expect(next.tasks[1].deps).toEqual(['a']); // nothing else about the items changes
    expect(deleted).toEqual({ 'project:bank:mobile-loans': 50 });
  });

  it('makes a product with an existing partner, and their pair', () => {
    const { snap: next } = convertProject(snap, 'mobile-loans', { kind: 'pair', product: 'new:Loans', partner: 'telco' }, 'bank', 50);
    expect(next.products.map((p) => p.id)).toEqual(['loans']);
    expect(next.pairs.map((p) => p.id)).toEqual(['loans+telco']);
    expect(next.tasks[0]).toMatchObject({ project: '', product: 'loans', partner: 'telco' });
  });

  it('makes a partner, and never clashes with an existing id', () => {
    const { snap: next } = convertProject(snap, 'home', { kind: 'partner', partner: 'new:Telco!' }, 'bank', 50);
    expect(next.partners.map((p) => [p.id, p.name])).toEqual([['telco', 'Telco'], ['telco-2', 'Telco!']]);
    expect(next.tasks[2]).toMatchObject({ project: '', partner: 'telco-2' });
  });

  it('uses an existing one named alike rather than making another', () => {
    const { snap: next } = convertProject(snap, 'home', { kind: 'partner', partner: 'new: telco ' }, 'bank', 50);
    expect(next.partners.map((p) => p.id)).toEqual(['telco']);
    expect(next.tasks[2]).toMatchObject({ partner: 'telco' });
  });

  it('does nothing for a project that is gone', () => {
    expect(convertProject(snap, 'nope', { kind: 'product', product: 'new:X' }, 'bank', 50)).toEqual({ snap, deleted: {} });
  });
});

describe('sortProjects and sortSummary', () => {
  const snap = {
    ...emptySnapshot(),
    projects: [
      { id: 'cards', name: 'Cards', color: '#111111', updatedAt: 1 },
      { id: 'loans-mtn', name: 'Loans MTN', color: '#222222', updatedAt: 1 },
      { id: 'loans-airtel', name: 'Loans Airtel', color: '#333333', updatedAt: 1 },
      { id: 'home', name: 'Home', color: '#444444', updatedAt: 1 },
    ],
    tasks: [
      item({ id: 'a', project: 'loans-mtn' }),
      item({ id: 'b', project: 'loans-airtel' }),
      item({ id: 'c', project: 'home' }),
      item({ id: 'd', project: 'cards' }),
    ],
  };

  it('shares a product named alike across projects, and leaves the rest alone', () => {
    const { snap: next, deleted } = sortProjects(
      snap,
      {
        'loans-mtn': { kind: 'pair', product: 'new:Loans', partner: 'new:MTN' },
        'loans-airtel': { kind: 'pair', product: 'new:loans', partner: 'new:Airtel' },
        cards: { kind: 'product', product: 'new:Cards' },
      },
      'bank',
      50,
    );
    expect(next.products.map((p) => p.id)).toEqual(['cards', 'loans']);
    expect(next.partners.map((p) => p.id)).toEqual(['mtn', 'airtel']);
    expect(next.pairs.map((p) => p.id)).toEqual(['loans+mtn', 'loans+airtel']);
    expect(next.projects.map((p) => p.id)).toEqual(['home']);
    expect(Object.keys(deleted).sort()).toEqual(['project:bank:cards', 'project:bank:loans-airtel', 'project:bank:loans-mtn']);
    expect(sortSummary(snap, next)).toEqual({
      newProducts: ['Cards', 'Loans'],
      newPartners: ['MTN', 'Airtel'],
      newPairs: ['Loans · MTN', 'Loans · Airtel'],
      projectsSorted: 3,
      projectsLeft: 1,
      itemsMoved: 3,
      itemsBefore: 4,
      itemsAfter: 4,
    });
  });

  it('ignores choices for projects that do not exist, or inherited names', () => {
    const choices = Object.create({ cards: { kind: 'product', product: 'new:X' } }) as Record<string, never>;
    expect(sortProjects(snap, { ...choices, nope: { kind: 'product', product: 'new:Y' } }, 'bank', 50)).toEqual({ snap, deleted: {} });
  });

  it('uniqueId slugs a name and avoids the ids taken', () => {
    expect(uniqueId('Mobile Loans!', [])).toBe('mobile-loans');
    expect(uniqueId('Mobile Loans', ['mobile-loans', 'mobile-loans-2'])).toBe('mobile-loans-3');
    expect(uniqueId('!!!', [])).toBe('item');
  });
});

describe('withWaiting and withDate (Step 2)', () => {
  it('sets who an item waits on, and clearing it clears the chase date', () => {
    const waiting = withWaiting(item({ id: 'a' }), 'Telco IT');
    expect(waiting.waitingOn).toBe('Telco IT');
    const chased = withDate(waiting, 'chaseOn', '2026-12-01');
    expect(chased.chaseOn).toBe('2026-12-01');
    const cleared = withWaiting(chased, ' ');
    expect('waitingOn' in cleared || 'chaseOn' in cleared).toBe(false);
  });

  it('sets and clears a snooze without touching anything else', () => {
    const t = item({ id: 'a', waitingOn: 'X' });
    expect(withDate(t, 'snoozedUntil', '2026-11-30')).toEqual({ ...t, snoozedUntil: '2026-11-30' });
    expect(withDate({ ...t, snoozedUntil: '2026-11-30' }, 'snoozedUntil', '')).toEqual(t);
  });
});

describe('withCompletion and withOccurrenceDone (Step 4)', () => {
  it('stamps the day an item is finished, keeps it while done, and clears it when reopened', () => {
    const open = item({ id: 'a' });
    const done = withCompletion(open, { ...open, status: 'done' }, '2026-11-27');
    expect(done.completedOn).toBe('2026-11-27');
    expect(withCompletion(done, { ...done, title: 'Renamed' }, '2026-11-30').completedOn).toBe('2026-11-27'); // an edit isn't a new finish
    expect('completedOn' in withCompletion(done, { ...done, status: 'todo' }, '2026-11-30')).toBe(false);
    const risk = item({ id: 'r', type: 'risk', status: 'open' });
    expect(withCompletion(risk, { ...risk, status: 'closed' }, '2026-11-27').completedOn).toBe('2026-11-27'); // each type's own finish
    expect(withCompletion(open, { ...open, title: 'x' }, '2026-11-27')).toEqual({ ...open, title: 'x' });
  });

  it("remembers a recurring item's finished occurrences, the last 100", () => {
    let t = item({ id: 'a', recurring: 'weekly' });
    t = withOccurrenceDone(t, '2026-11-20');
    t = withOccurrenceDone(t, '2026-11-27');
    expect(t.completions).toEqual(['2026-11-20', '2026-11-27']);
    const many = withOccurrenceDone({ ...t, completions: Array.from({ length: 100 }, (_, i) => `2020-01-${String((i % 28) + 1).padStart(2, '0')}`) }, '2026-11-27');
    expect(many.completions).toHaveLength(100);
    expect(many.completions!.at(-1)).toBe('2026-11-27');
  });
});
