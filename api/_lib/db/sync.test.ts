import { describe, expect, it } from 'vitest';
import { mergeStates } from '../../../src/shared/merge';
import { documentToRows, rowsToDocument, type Rows } from './mapping';
import { isEmptyPlan, planSync } from './sync';
import { NOW, OWNER, document, documentWithCatalogue, ids, task } from './testing/document';

/** Rows as stored, and what a sync of `upload` would merge to (as syncDocument does). */
function setup(change?: (rows: Rows) => void) {
  const { rows } = documentToRows(document(), OWNER, ids(), NOW - 60000);
  change?.(rows);
  const merge = (upload: unknown) => mergeStates(rowsToDocument(rows, 'default', NOW), upload, 'default');
  return { rows, merge };
}

describe('planSync', () => {
  it('writes nothing when the upload holds nothing new', () => {
    const { rows, merge } = setup();
    expect(isEmptyPlan(planSync(rows, merge(document()), NOW))).toBe(true);
  });

  it('writes an edited task, with its dependencies', () => {
    const { rows, merge } = setup();
    const upload = document();
    upload.tasks[1] = { ...upload.tasks[1], title: 'Renamed', deps: ['t3'], updatedAt: NOW };
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.itemUpdates.map((i) => [i.title, i.edited_ms])).toEqual([['Renamed', NOW]]);
    expect(plan.dependencies).toEqual([{ workspace: 'default', item: 't2', dependsOn: ['t3'] }]);
    expect(plan.newItems).toEqual([]);
  });

  it('ignores an older copy of a task (the stored one is newer)', () => {
    const { rows, merge } = setup();
    const upload = document();
    upload.tasks[0] = { ...upload.tasks[0], title: 'Old title', updatedAt: NOW - 999999 };
    expect(isEmptyPlan(planSync(rows, merge(upload), NOW))).toBe(true);
  });

  it('adds new tasks newest first, as the device lists them', () => {
    const { rows, merge } = setup();
    const upload = document();
    upload.tasks.unshift(task('n2', 'home', { updatedAt: NOW }), task('n1', 'home', { deps: ['t1'], updatedAt: NOW - 1 }));
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.newItems.map((i) => [i.client_id, i.created_ms])).toEqual([['n2', NOW], ['n1', NOW - 1]]);
    expect(plan.dependencies).toContainEqual({ workspace: 'default', item: 'n1', dependsOn: ['t1'] });
  });

  it('deletes a task at its deletion time', () => {
    const { rows, merge } = setup();
    const upload = document();
    upload.tasks = upload.tasks.filter((t) => t.id !== 't3');
    upload.deleted['task:default:t3'] = NOW - 10;
    const plan = planSync(rows, merge(upload), NOW);
    const t3 = rows.items.find((i) => i.client_id === 't3')!;
    expect(plan.deletions).toEqual([{ table: 'items', id: t3.id, deleted_ms: NOW - 10 }]);
  });

  it('refuses a stale copy of a deleted task, even after devices forgot the deletion', () => {
    const longAgo = NOW - 400 * 24 * 3600 * 1000; // far older than the 60 days a device remembers
    const { rows, merge } = setup((r) => (r.items.find((i) => i.client_id === 't3')!.deleted_ms = longAgo + 1));
    const upload = document();
    upload.tasks[2] = { ...upload.tasks[2], updatedAt: longAgo };
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.refused).toEqual(['task:default:t3']);
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('brings a deleted task back for an edit newer than its deletion', () => {
    const { rows, merge } = setup((r) => (r.items.find((i) => i.client_id === 't3')!.deleted_ms = NOW - 100));
    const upload = document();
    upload.tasks[2] = { ...upload.tasks[2], title: 'Back', updatedAt: NOW };
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.itemUpdates.map((i) => i.title)).toEqual(['Back']);
    expect(plan.refused).toEqual([]);
  });

  it('keeps a task the old store remembered as deleted out, unless it was edited since', () => {
    const { rows, merge } = setup();
    const stale = document();
    stale.tasks.push(task('gone', 'home', { updatedAt: NOW - 5000 })); // deleted at NOW - 1000
    expect(isEmptyPlan(planSync(rows, merge(stale), NOW))).toBe(true); // the merge drops it itself
    const edited = document();
    edited.tasks.push(task('gone', 'home', { updatedAt: NOW }));
    expect(planSync(rows, merge(edited), NOW).newItems.map((i) => i.client_id)).toEqual(['gone']);
  });

  it('refuses it here once devices no longer remember that deletion', () => {
    const longAgo = NOW - 400 * 24 * 3600 * 1000;
    const { rows, merge } = setup((r) => (r.legacyDeletions[0].deleted_ms = longAgo + 1));
    const stale = document();
    delete stale.deleted['task:default:gone']; // this device forgot the deletion too
    stale.tasks.push(task('gone', 'home', { updatedAt: longAgo }));
    const plan = planSync(rows, merge(stale), NOW);
    expect(plan.refused).toEqual(['task:default:gone']);
    expect(plan.newItems).toEqual([]);
  });

  it('refuses a stale copy of a project the old store remembered as deleted', () => {
    const longAgo = NOW - 400 * 24 * 3600 * 1000;
    const { rows, merge } = setup((r) => (r.legacyDeletions[1].deleted_ms = longAgo + 1)); // project:work:old-project
    const stale = document();
    delete stale.deleted['project:work:old-project'];
    stale.workspaceData.work.projects.push({ id: 'old-project', name: 'Old', color: '#000000', updatedAt: longAgo });
    const plan = planSync(rows, merge(stale), NOW);
    expect(plan.refused).toEqual(['project:work:old-project']);
    expect(plan.newGroups).toEqual([]);
  });

  it('stores the copy the merge chose when two devices edited in the same millisecond', () => {
    const { rows, merge } = setup();
    const upload = document();
    upload.tasks[0] = { ...upload.tasks[0], title: 'Same moment' }; // same updatedAt as stored
    expect(planSync(rows, merge(upload), NOW).itemUpdates.map((i) => i.title)).toEqual(['Same moment']);
  });

  it('adds new workspaces and projects, renames and settings', () => {
    const { rows, merge } = setup();
    const upload = document();
    upload.workspaces.push({ id: 'new-ws', name: 'New', updatedAt: NOW });
    upload.workspaceData['new-ws'] = { projects: [{ id: 'np', name: 'NP', color: '#123456', updatedAt: NOW }], tasks: [task('x1', 'np', { updatedAt: NOW })] };
    upload.workspaces[1] = { ...upload.workspaces[1], name: 'Work renamed', updatedAt: NOW };
    upload.reminders = { ...upload.reminders, digestTime: '06:00', updatedAt: NOW };
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.newWorkspaces.map((w) => w.client_id)).toEqual(['new-ws']);
    expect(plan.newGroups.map((p) => [p.table, p.workspace, p.client_id])).toEqual([['projects', 'new-ws', 'np']]);
    expect(plan.newItems.map((i) => [i.workspace, i.client_id, i.project])).toEqual([['new-ws', 'x1', 'np']]);
    expect(plan.workspaceUpdates.map((w) => w.name)).toEqual(['Work renamed']);
    expect(plan.settings).toMatchObject({ edited_ms: NOW, reminders: { digestTime: '06:00' } });
  });
});

describe('planSync with products, partners, pairs and item types (Step 1b)', () => {
  function setup1b() {
    const { rows } = documentToRows(documentWithCatalogue(), OWNER, ids(), NOW - 60000);
    const merge = (upload: unknown) => mergeStates(rowsToDocument(rows, 'default', NOW), upload, 'default');
    return { rows, merge };
  }

  it('writes nothing when the upload holds nothing new', () => {
    const { rows, merge } = setup1b();
    expect(isEmptyPlan(planSync(rows, merge(documentWithCatalogue()), NOW))).toBe(true);
  });

  it('adds products, partners, pairs and typed items', () => {
    const { rows, merge } = setup1b();
    const upload = documentWithCatalogue();
    const bank = upload.workspaceData.bank;
    bank.products.push({ id: 'savings', name: 'Savings', color: '#123456', updatedAt: NOW });
    bank.partners.push({ id: 'bureau', name: 'Bureau', color: '#654321', updatedAt: NOW });
    bank.pairs.push({ id: 'savings+bureau', product: 'savings', partner: 'bureau', updatedAt: NOW });
    bank.tasks.unshift(task('r2', '', { type: 'risk', status: 'open', product: 'savings', partner: 'bureau', details: { impact: 'high' }, updatedAt: NOW }));
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.newGroups.map((g) => [g.table, g.client_id])).toEqual([['products', 'savings'], ['partners', 'bureau']]);
    expect(plan.newPairs).toEqual([{ workspace: 'bank', client_id: 'savings+bureau', product: 'savings', partner: 'bureau', edited_ms: NOW }]);
    expect(plan.newItems.map((i) => [i.client_id, i.type, i.product, i.partner, i.details])).toEqual([['r2', 'risk', 'savings', 'bureau', { impact: 'high' }]]);
  });

  it("doesn't store an item that fails its type's checks, and says why", () => {
    const { rows, merge } = setup1b();
    const upload = documentWithCatalogue();
    upload.workspaceData.bank.tasks.unshift(task('bad', '', { type: 'risk', status: 'todo', updatedAt: NOW }));
    upload.workspaceData.bank.tasks[1] = { ...upload.workspaceData.bank.tasks[1], title: 'Renamed risk', updatedAt: NOW }; // r1, valid
    const plan = planSync(rows, merge(upload), NOW);
    expect(plan.invalid).toEqual([{ key: 'task:bank:bad', problem: 'status "todo" isn\'t one a risk can have' }]);
    expect(plan.newItems).toEqual([]);
    expect(plan.itemUpdates.map((i) => i.title)).toEqual(['Renamed risk']); // the rest of the upload is stored
  });

  it('ends a pair at its deletion time, and refuses a stale copy of it later', () => {
    const { rows, merge } = setup1b();
    const upload = documentWithCatalogue();
    upload.workspaceData.bank.pairs = [];
    upload.deleted['pair:bank:loans+telco'] = NOW - 5;
    const plan = planSync(rows, merge(upload), NOW);
    const pair = rows.pairs.find((p) => p.client_id === 'loans+telco')!;
    expect(plan.deletions).toEqual([{ table: 'product_partners', id: pair.id, deleted_ms: NOW - 5 }]);

    const longAgo = NOW - 400 * 24 * 3600 * 1000;
    pair.deleted_ms = longAgo + 1;
    const stale = documentWithCatalogue();
    stale.workspaceData.bank.pairs[0].updatedAt = longAgo;
    expect(planSync(rows, merge(stale), NOW).refused).toEqual(['pair:bank:loans+telco']);
  });

  it('moves an item to another type, product and partner as one update', () => {
    const { rows, merge } = setup1b();
    const upload = documentWithCatalogue();
    // i1, an issue: as a risk its fields must be a risk's (impact is a level there, not text).
    upload.workspaceData.bank.tasks[1] = { ...upload.workspaceData.bank.tasks[1], type: 'risk', status: 'open', partner: 'telco', details: { impact: 'high' }, updatedAt: NOW };
    const [update] = planSync(rows, merge(upload), NOW).itemUpdates;
    expect([update.type, update.status, update.product, update.partner]).toEqual(['risk', 'open', '', 'telco']);
  });
});
