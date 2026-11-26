import { describe, expect, it } from 'vitest';
import { TOMBSTONE_TTL_MS, type SyncedState } from '../../../src/shared/state';
import { documentToRows, rowsToDocument, summariseDocument } from './mapping';
import { NOW, OWNER, document, documentWithCatalogue, ids, task } from './testing/document';

describe('documentToRows / rowsToDocument', () => {
  it('comes back exactly as it went in', () => {
    const doc = document();
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes).toEqual([]);
    expect(rowsToDocument(rows, 'default', NOW)).toEqual(doc);
  });

  it('comes back the same whatever order the database returns the rows in', () => {
    const { rows } = documentToRows(document(), OWNER, ids(), NOW);
    for (const list of [rows.workspaces, rows.projects, rows.items, rows.links] as unknown[][]) list.reverse();
    expect(rowsToDocument(rows, 'default', NOW)).toEqual(document());
  });

  it('puts tasks made later first, as the app does', () => {
    const { rows } = documentToRows(document(), OWNER, ids(), NOW);
    // 'z-new' sorts last by id, so only the creation order can put it first.
    rows.items.push({ ...rows.items[2], id: '00000000-0000-0000-0000-00000000ffff', client_id: 'z-new', created_ms: NOW + 60000 });
    expect(rowsToDocument(rows, 'default', NOW).tasks.map((t) => t.id)).toEqual(['z-new', 't1', 't2', 't3']);
  });

  it("keeps the device's choice of active workspace, or falls back to the first", () => {
    const { rows } = documentToRows(document(), OWNER, ids());
    const onWork = rowsToDocument(rows, 'work', NOW);
    expect(onWork.activeWorkspaceId).toBe('work');
    expect(onWork.tasks.map((t) => t.id)).toEqual(['w2', 'w1']);
    expect(summariseDocument(onWork)).toEqual(summariseDocument(document()));
    expect(rowsToDocument(rows, 'no-such', NOW).activeWorkspaceId).toBe('default');
  });

  it('makes the rows the database expects', () => {
    const { rows } = documentToRows(document(), OWNER, ids());
    expect(rows.workspaces.map((w) => [w.client_id, w.sort_order])).toEqual([['default', 0], ['work', 1], ['constructor', 2]]);
    expect(rows.projects.map((p) => p.client_id)).toEqual(['home', 'admin', 'client-x']);
    expect(rows.items).toHaveLength(5);
    const byClient = Object.fromEntries(rows.items.map((i) => [i.client_id, i]));
    expect([byClient.t1.remind_days_before, byClient.t1.remind_off]).toEqual([3, false]); // 3 days before
    expect([byClient.t2.remind_days_before, byClient.t2.remind_off]).toEqual([null, true]); // never
    expect([byClient.t3.remind_days_before, byClient.t3.remind_off]).toEqual([null, false]); // settings default
    expect(byClient.t1.project_id).toBe(rows.projects[0].id);
    expect(rows.links).toEqual([
      expect.objectContaining({ from_id: byClient.t1.id, to_id: byClient.t2.id, kind: 'depends_on' }),
      expect.objectContaining({ from_id: byClient.w1.id, to_id: byClient.w2.id, kind: 'depends_on' }),
    ]);
    expect(rows.legacyDeletions.map((d) => [d.kind, d.client_id])).toEqual([['task', 'gone'], ['project', 'old-project']]);
    expect(rows.settings).toMatchObject({ user_id: OWNER, edited_ms: 123, reminders: { digestTime: '07:30', email: 'me@example.org' } });
    expect(rows.settings!.reminders).not.toHaveProperty('updatedAt');
  });

  it('only makes rows the database would accept: unique ids, everything inside its own workspace', () => {
    const { rows } = documentToRows(document(), OWNER, ids());
    const all = [...rows.workspaces, ...rows.projects, ...rows.items].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    const workspaceOf = new Map([...rows.projects, ...rows.items].map((r) => [r.id, r.workspace_id]));
    const workspaceIds = new Set(rows.workspaces.map((w) => w.id));
    for (const r of [...rows.projects, ...rows.items, ...rows.links, ...rows.legacyDeletions]) expect(workspaceIds.has(r.workspace_id)).toBe(true);
    for (const i of rows.items) if (i.project_id) expect(workspaceOf.get(i.project_id)).toBe(i.workspace_id);
    for (const l of rows.links) expect([workspaceOf.get(l.from_id), workspaceOf.get(l.to_id)]).toEqual([l.workspace_id, l.workspace_id]);
    for (const r of [...rows.workspaces, ...rows.projects, ...rows.items]) expect(r.owner_id).toBe(OWNER);
  });

  it('applies a deletion newer than the task (as sync does), and ignores one an edit overrode', () => {
    const doc = document();
    doc.deleted['task:default:t3'] = NOW - 100; // newer than t3's edit: t3 is deleted
    doc.deleted['task:work:w2'] = NOW - 60000; // older than w2's edit: w2 stays
    const { rows } = documentToRows(doc, OWNER, ids());
    expect(rows.items.find((i) => i.client_id === 't3')!.deleted_ms).toBe(NOW - 100);
    expect(rows.items.find((i) => i.client_id === 'w2')!.deleted_ms).toBeNull();
    const back = rowsToDocument(rows, 'default', NOW);
    expect(back.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(back.deleted['task:default:t3']).toBe(NOW - 100);
    expect(summariseDocument(back)).toEqual(summariseDocument(doc));
  });

  it('sends devices only recent deletions, like the app keeps them', () => {
    const { rows } = documentToRows(document(), OWNER, ids());
    rows.legacyDeletions[0].deleted_ms = NOW - TOMBSTONE_TTL_MS - 1;
    expect(Object.keys(rowsToDocument(rows, 'default', NOW).deleted)).toEqual(['project:work:old-project']);
  });

  it('treats a dependency listed twice as one', () => {
    const doc = document();
    doc.tasks[0].deps = ['t2', 't2'];
    const { rows } = documentToRows(doc, OWNER, ids());
    expect(rows.links).toHaveLength(2);
    expect(summariseDocument(rowsToDocument(rows, 'default', NOW))).toEqual(summariseDocument(doc));
  });

  it("doesn't let a deletion in a workspace that no longer exists block the comparison", () => {
    const doc = document();
    doc.deleted['task:vanished-ws:x'] = NOW - 10;
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes).toEqual([{ where: 'task:vanished-ws:x', note: 'deletion in a workspace that no longer exists; not carried over' }]);
    expect(summariseDocument(rowsToDocument(rows, 'default', NOW))).toEqual(summariseDocument(doc));
  });

  it('keeps what it has to change, and says so', () => {
    const doc = document();
    doc.tasks[2] = { ...doc.tasks[2], project: 'vanished', dueDate: 'soon', chaseOn: 'Friday', snoozedUntil: 'later', completedOn: 'today', completions: ['2026-11-01', 'last week'] };
    doc.projects[1] = { ...doc.projects[1], color: 'teal' };
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes.map((n) => n.where)).toEqual(['default/admin', 'default/t3', 'default/t3']);
    const t3 = rows.items.find((i) => i.client_id === 't3')!;
    expect([t3.project_id, t3.due_date, t3.chase_on, t3.snoozed_until, t3.completed_on, t3.completions, t3.details]).toEqual([null, null, null, null, null, [],
      { legacy_project: 'vanished', legacy_due_date: 'soon', legacy_chase_on: 'Friday', legacy_snoozed_until: 'later', legacy_completed_on: 'today',
        legacy_completions: ['2026-11-01', 'last week'] }]);
    const back = rowsToDocument(rows, 'default', NOW).tasks.find((t) => t.id === 't3')!;
    expect([back.project, back.dueDate, back.chaseOn, back.snoozedUntil, back.completedOn, back.completions]).toEqual(['vanished', 'soon', 'Friday', 'later', 'today', ['2026-11-01', 'last week']]); // the task itself is unchanged
  });
});

describe('summariseDocument', () => {
  it('counts each workspace', () => {
    expect(summariseDocument(document()).workspaces).toEqual([
      { workspace: 'default', projects: 2, products: 0, partners: 0, pairs: 0, tasks: 3, done: 1, dependencies: 1, stages: 0, releases: 0, signoffs: 0, deletions: 1 },
      { workspace: 'work', projects: 1, products: 0, partners: 0, pairs: 0, tasks: 2, done: 0, dependencies: 1, stages: 0, releases: 0, signoffs: 0, deletions: 1 },
      { workspace: 'constructor', projects: 0, products: 0, partners: 0, pairs: 0, tasks: 0, done: 0, dependencies: 0, stages: 0, releases: 0, signoffs: 0, deletions: 0 },
    ]);
  });

  it('notices any change to the data, but not task order', () => {
    const base = summariseDocument(document()).checksum;
    const changes: ((d: SyncedState) => void)[] = [
      (d) => (d.tasks[0].title += '!'),
      (d) => (d.tasks[0].updatedAt += 1),
      (d) => (d.tasks[0].deps = []),
      (d) => (d.tasks[0].subs[0].done = false),
      (d) => (d.tasks[1].remindDaysBefore = undefined),
      (d) => (d.tasks[1].waitingOn = 'Bank ops'),
      (d) => (d.tasks[1].chaseOn = '2026-12-03'),
      (d) => (d.tasks[1].snoozedUntil = undefined),
      (d) => (d.tasks[1].completedOn = '2026-11-26'),
      (d) => (d.tasks[0].completions = ['2026-11-06']),
      (d) => (d.projects[0].color = '#000000'),
      (d) => (d.workspaces[1].name = 'Works'),
      (d) => (d.deleted['task:default:gone'] += 1),
      (d) => (d.reminders.digestTime = '07:31'),
    ];
    for (const change of changes) {
      const d = document();
      change(d);
      expect(summariseDocument(d).checksum).not.toBe(base);
    }
    const reordered = document();
    reordered.tasks.reverse();
    expect(summariseDocument(reordered).checksum).toBe(base);
  });
});

describe('products, partners, pairs and item types (Step 1b)', () => {
  it('come back exactly as they went in', () => {
    const doc = documentWithCatalogue();
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes).toEqual([]);
    expect(rowsToDocument(rows, 'default', NOW)).toEqual(doc);
    for (const list of [rows.products, rows.partners, rows.pairs, rows.items] as unknown[][]) list.reverse();
    expect(rowsToDocument(rows, 'default', NOW)).toEqual(doc);
  });

  it('make the rows the database expects', () => {
    const { rows } = documentToRows(documentWithCatalogue(), OWNER, ids());
    expect(rows.products.map((p) => p.client_id)).toEqual(['loans', 'cards']);
    expect(rows.partners.map((p) => p.client_id)).toEqual(['telco', 'fintech']);
    const id = (list: { id: string; client_id: string }[], c: string) => list.find((r) => r.client_id === c)!.id;
    expect(rows.pairs).toEqual([expect.objectContaining({ client_id: 'loans+telco', product_id: id(rows.products, 'loans'), partner_id: id(rows.partners, 'telco') })]);
    const r1 = rows.items.find((i) => i.client_id === 'r1')!;
    expect(r1).toMatchObject({ type: 'risk', status: 'mitigating', product_id: id(rows.products, 'loans'), partner_id: id(rows.partners, 'telco'), project_id: null });
    expect(r1.details).toEqual({ legacy_project: '', likelihood: 'med', impact: 'high', mitigation: 'Second line' });
    expect(rows.items.find((i) => i.client_id === 'i1')).toMatchObject({ type: 'issue', product_id: null, partner_id: id(rows.partners, 'fintech') });
    expect(rows.items.find((i) => i.client_id === 'tb')).toMatchObject({ type: 'task', product_id: id(rows.products, 'loans') });
    expect(rows.legacyDeletions.map((d) => [d.kind, d.client_id])).toEqual(
      expect.arrayContaining([['product', 'old-product'], ['pair', 'cards+fintech']]),
    );
  });

  it('keeps an item that names a product and partner that are not a pair: the partner as a note', () => {
    const doc = documentWithCatalogue();
    doc.workspaceData.bank.tasks.push(task('np', '', { product: 'cards', partner: 'telco' }));
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes).toEqual([{ where: 'bank/np', note: "cards and telco aren't a pair; the partner kept as a note" }]);
    expect(rows.items.find((i) => i.client_id === 'np')).toMatchObject({ partner_id: null, details: expect.objectContaining({ legacy_partner: 'telco' }) });
    expect(summariseDocument(rowsToDocument(rows, 'default', NOW))).toEqual(summariseDocument(doc));
  });

  it('keeps an item whose product or partner no longer exists, naming them in notes', () => {
    const doc = documentWithCatalogue();
    doc.workspaceData.bank.tasks.push(task('orphan', '', { product: 'gone-product', partner: 'gone-partner' }));
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes.map((n) => n.note)).toEqual(['product "gone-product" doesn\'t exist; kept as a note', 'partner "gone-partner" doesn\'t exist; kept as a note']);
    expect(rows.items.find((i) => i.client_id === 'orphan')).toMatchObject({ product_id: null, partner_id: null });
    const back = rowsToDocument(rows, 'default', NOW).workspaceData.bank.tasks.find((t) => t.id === 'orphan')!;
    expect([back.product, back.partner]).toEqual(['gone-product', 'gone-partner']);
  });

  it('keeps an item in a plain project and a product at once: the product as a note, and says so', () => {
    const doc = documentWithCatalogue();
    doc.workspaceData.bank.projects.push({ id: 'ops', name: 'Ops', color: '#6b7a4f', updatedAt: NOW - 100 });
    doc.workspaceData.bank.tasks.push(task('both', 'ops', { product: 'loans' }));
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes).toEqual([{ where: 'bank/both', note: 'belongs to a plain project and to a product or partner; kept as it is' },
      { where: 'bank/both', note: 'in a plain project and a product or partner at once; the product and partner kept as notes' }]);
    const row = rows.items.find((i) => i.client_id === 'both')!;
    expect([row.project_id !== null, row.product_id, row.details.legacy_product]).toEqual([true, null, 'loans']); // as the database requires
    expect(summariseDocument(rowsToDocument(rows, 'default', NOW))).toEqual(summariseDocument(doc));
  });

  it('deletes a product at its deletion time, and tells devices', () => {
    const doc = documentWithCatalogue();
    doc.deleted['product:bank:cards'] = NOW - 10; // newer than the product's edit
    const { rows } = documentToRows(doc, OWNER, ids());
    expect(rows.products.find((p) => p.client_id === 'cards')!.deleted_ms).toBe(NOW - 10);
    const back = rowsToDocument(rows, 'default', NOW);
    expect(back.workspaceData.bank.products.map((p) => p.id)).toEqual(['loans']);
    expect(back.deleted['product:bank:cards']).toBe(NOW - 10);
  });

  it('refuses a status the type doesn\'t have, setting its first one, and says so', () => {
    const doc = documentWithCatalogue();
    doc.workspaceData.bank.tasks[0].status = 'todo'; // a risk
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(rows.items.find((i) => i.client_id === 'r1')!.status).toBe('open');
    expect(notes.map((n) => n.note)).toEqual(expect.arrayContaining(['status "todo" isn\'t one a risk can have; set to open']));
  });

  it('counts them, with each type\'s own finished statuses', () => {
    const bank = summariseDocument(documentWithCatalogue()).workspaces.find((w) => w.workspace === 'bank')!;
    expect(bank).toEqual({ workspace: 'bank', projects: 0, products: 2, partners: 2, pairs: 1, tasks: 6, done: 1, dependencies: 1, stages: 2, releases: 1, signoffs: 2, deletions: 2 });
  });

  it('notices any change to them in the checksum', () => {
    const base = summariseDocument(documentWithCatalogue()).checksum;
    const changes: ((d: SyncedState) => void)[] = [
      (d) => (d.workspaceData.bank.tasks[0].type = 'issue'),
      (d) => (d.workspaceData.bank.tasks[0].product = 'cards'),
      (d) => (d.workspaceData.bank.tasks[0].partner = undefined),
      (d) => (d.workspaceData.bank.tasks[0].details = { likelihood: 'low', impact: 'high', mitigation: 'Second line' }),
      (d) => (d.workspaceData.bank.products[0].name = 'Loans'),
      (d) => (d.workspaceData.bank.partners[1].color = '#000000'),
      (d) => (d.workspaceData.bank.pairs[0].updatedAt += 1),
      (d) => (d.workspaceData.bank.stages[1].order = 3),
      (d) => (d.workspaceData.bank.releases[0].targetDate = undefined),
      (d) => (d.workspaceData.bank.signoffs[0].outcome = 'waived'),
      (d) => (d.workspaceData.bank.signoffs[1].corrects = undefined),
      (d) => (d.workspaceData.bank.signoffs[1].evidence = 'https://bank.example/other'),
    ];
    for (const change of changes) {
      const d = documentWithCatalogue();
      change(d);
      expect(summariseDocument(d).checksum).not.toBe(base);
    }
    const reordered = documentWithCatalogue();
    reordered.workspaceData.bank.tasks[0].details = { mitigation: 'Second line', impact: 'high', likelihood: 'med' };
    expect(summariseDocument(reordered).checksum).toBe(base); // key order doesn't matter
  });
});

describe('stages, releases and sign-offs (Step 3)', () => {
  it('come back exactly, a correction pointing at the sign-off it replaces', () => {
    const { rows, notes } = documentToRows(documentWithCatalogue(), OWNER, ids());
    expect(notes).toEqual([]);
    expect(rows.stages.map((r) => [r.client_id, r.name, r.sort_order])).toEqual([['sit', 'SIT', 1], ['uat', 'User testing', 2]]);
    const [first, fix] = rows.signoffs;
    expect([fix.client_id, fix.corrects_id]).toEqual(['so-2', first.id]);
    expect(rows.releases[0]).toMatchObject({ client_id: 'rel-1', name: 'Loans v2', target_date: '2026-12-15' });
    expect(rows.releases[0].product_id).toBe(rows.products.find((p) => p.client_id === 'loans')!.id);
    expect(rowsToDocument(rows, 'default', NOW)).toEqual(documentWithCatalogue());
  });

  it("leaves out, with a note, what the database can't hold: so the import stops", () => {
    const doc = documentWithCatalogue();
    const bank = doc.workspaceData.bank;
    bank.releases.push({ id: 'rel-x', product: 'cards', partner: 'telco', name: 'Not a pair', updatedAt: NOW });
    bank.signoffs.push(
      { ...bank.signoffs[0], id: 'so-x', release: 'rel-gone', updatedAt: NOW },
      { ...bank.signoffs[0], id: 'so-y', stage: 'gone', updatedAt: NOW + 1 },
      { ...bank.signoffs[0], id: 'so-z', corrects: 'so-gone', updatedAt: NOW + 2 },
      { ...bank.signoffs[0], id: 'so-w', evidence: 'file:///c:/x.pdf', updatedAt: NOW + 3 },
    );
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes.map((n) => `${n.where}: ${n.note}`)).toEqual([
      "bank/release rel-x: cards and telco aren't a pair here; the release can't be stored",
      "bank/sign-off so-x: its release is missing; it can't be stored",
      "bank/sign-off so-y: its stage is missing; it can't be stored",
      "bank/sign-off so-z: the sign-off it corrects is missing; it can't be stored",
      "bank/sign-off so-w: the evidence is not a web link (http:// or https://); it can't be stored",
    ]);
    expect(summariseDocument(rowsToDocument(rows, 'default', NOW)).checksum).not.toBe(summariseDocument(doc).checksum);
  });

  it('remembers deleted stages and releases like other deletions', () => {
    const doc = documentWithCatalogue();
    doc.deleted['stage:bank:old-stage'] = NOW - 500;
    doc.deleted['release:bank:old-release'] = NOW - 400;
    // A release deleted after its last edit: stored as a deleted row, and given back as a deletion.
    doc.workspaceData.bank.releases.push({ id: 'rel-gone', product: 'loans', partner: 'telco', name: 'Dropped', updatedAt: NOW - 300 });
    doc.deleted['release:bank:rel-gone'] = NOW - 200;
    const { rows } = documentToRows(doc, OWNER, ids());
    expect(rows.releases.find((r) => r.client_id === 'rel-gone')?.deleted_ms).toBe(NOW - 200);
    expect(rowsToDocument(rows, 'default', NOW).deleted['release:bank:rel-gone']).toBe(NOW - 200);
    expect(rows.legacyDeletions.filter((d) => d.kind === 'stage' || d.kind === 'release').map((d) => [d.kind, d.client_id])).toEqual([
      ['stage', 'old-stage'],
      ['release', 'old-release'],
    ]);
    expect(summariseDocument(rowsToDocument(rows, 'default', NOW))).toEqual(summariseDocument(doc));
  });
});

