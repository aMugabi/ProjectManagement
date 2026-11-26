/**
 * Step 1b on a real Postgres: products, partners, pairs and item types through the import and
 * sync, as the app role. Skipped unless TEST_DB_OWNER_URL and TEST_DB_APP_URL are set (see
 * db/README.md).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { withUser } from './client';
import { importDocument } from './import';
import { rowsToDocument, summariseDocument } from './mapping';
import { readRows } from './rows';
import { syncDocument } from './sync';
import { NOW, documentWithCatalogue, task } from './testing/document';
import { sortProjects } from '../../../src/lib/items';

const OWNER_URL = process.env.TEST_DB_OWNER_URL;
const APP_URL = process.env.TEST_DB_APP_URL;
const RUN = Date.now().toString(36);

describe.skipIf(!OWNER_URL || !APP_URL)('products, partners and item types on Postgres', () => {
  let owner: pg.Client;
  let app: pg.Pool;
  let userId: string;

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new pg.Pool({ connectionString: APP_URL, max: 2 });
  });
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  const sync = (upload: unknown, now: number) => withUser(app, userId, (c) => syncDocument(c, userId, upload, now));
  const read = () => withUser(app, userId, (c) => readRows(c, userId));

  it('imports them exactly, with one baseline entry per row', async () => {
    const result = await importDocument(owner, { email: `cat-${RUN}@example.org`, document: documentWithCatalogue(), dryRun: false, now: NOW });
    userId = result.userId;
    expect(result.after).toEqual(result.before);
    expect(result.rowCounts).toMatchObject({ workspaces: 4, products: 2, partners: 2, product_partners: 1, items: 11, item_links: 3, legacy_deletions: 4 });
    // 4 workspaces + 4 memberships + 3 projects + 2 products + 2 partners + 1 pair + 11 items + 3 links
    // + 2 stages + 1 release + 2 sign-offs
    expect(result.baselineEntries).toBe(35);
    expect(result.rowCounts).toMatchObject({ stages: 2, releases: 1, signoffs: 2 });
    const log = await owner.query(
      `select distinct action from change_log where workspace_id in (select workspace_id from workspace_members where user_id = $1)`,
      [userId],
    );
    expect(log.rows).toEqual([{ action: 'baseline' }]); // no 'insert' entries for imported rows, of any table
    expect(rowsToDocument(await read(), 'default', NOW)).toEqual(documentWithCatalogue());
  });

  it('stores items in the right product, partner and pair rows, with their types', async () => {
    const r = await owner.query(
      `select i.client_id, i.type, i.status, p.client_id product, q.client_id partner, i.details->>'likelihood' likelihood
         from items i left join products p on p.id = i.product_id left join partners q on q.id = i.partner_id
        where i.owner_id = $1 and i.client_id in ('r1', 'i1', 'd1', 'cr1') order by i.client_id`,
      [userId],
    );
    expect(r.rows).toEqual([
      { client_id: 'cr1', type: 'change_request', status: 'approved', product: null, partner: null, likelihood: null },
      { client_id: 'd1', type: 'decision', status: 'decided', product: 'cards', partner: null, likelihood: null },
      { client_id: 'i1', type: 'issue', status: 'open', product: null, partner: 'fintech', likelihood: null },
      { client_id: 'r1', type: 'risk', status: 'mitigating', product: 'loans', partner: 'telco', likelihood: 'med' },
    ]);
  });

  it('syncs new products, partners, pairs and typed items, logged as the user', async () => {
    const upload = rowsToDocument(await read(), 'default', NOW + 1000);
    const bank = upload.workspaceData.bank;
    bank.products.push({ id: 'savings', name: 'Savings', color: '#123456', updatedAt: NOW + 1000 });
    bank.partners.push({ id: 'bureau', name: 'Bureau', color: '#654321', updatedAt: NOW + 1000 });
    bank.pairs.push({ id: 'savings+bureau', product: 'savings', partner: 'bureau', updatedAt: NOW + 1000 });
    bank.tasks.unshift(task('r2', '', { type: 'risk', status: 'open', product: 'savings', partner: 'bureau', details: { impact: 'high' }, updatedAt: NOW + 1000 }));
    const reply = await sync(upload, NOW + 1000);
    expect(reply.workspaceData.bank.tasks[0]).toMatchObject({ id: 'r2', type: 'risk', product: 'savings', partner: 'bureau', details: { impact: 'high' } });
    expect(reply.workspaceData.bank.pairs.map((p) => p.id)).toEqual(['loans+telco', 'savings+bureau']);
    const log = await owner.query(
      `select table_name, count(*)::int n from change_log where actor_id = $1 and action = 'insert' group by 1 order by 1`,
      [userId],
    );
    expect(log.rows).toEqual([
      { table_name: 'items', n: 1 },
      { table_name: 'partners', n: 1 },
      { table_name: 'product_partners', n: 1 },
      { table_name: 'products', n: 1 },
    ]);
  });

  it("doesn't store an item that fails its type's checks, and stores the rest of the upload", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const upload = rowsToDocument(await read(), 'default', NOW + 2000);
    upload.workspaceData.bank.tasks.unshift(task('bad', '', { type: 'decision', status: 'decided', details: { decidedOn: 'last week' }, updatedAt: NOW + 2000 }));
    upload.workspaceData.bank.products[0] = { ...upload.workspaceData.bank.products[0], name: 'Mobile loans 2', updatedAt: NOW + 2000 };
    const reply = await sync(upload, NOW + 2000);
    expect(reply.workspaceData.bank.tasks.map((t) => t.id)).not.toContain('bad');
    expect(reply.workspaceData.bank.products[0].name).toBe('Mobile loans 2');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('task:bank:bad: decision fields: decidedOn'));
    warn.mockRestore();
  });

  it('keeps an item whose product and partner are not a pair: the partner as a note, and gives it back', async () => {
    const upload = rowsToDocument(await read(), 'default', NOW + 3000);
    upload.workspaceData.bank.tasks.unshift(task('np', '', { product: 'cards', partner: 'telco', updatedAt: NOW + 3000 }));
    const reply = await sync(upload, NOW + 3000);
    expect(reply.workspaceData.bank.tasks.find((t) => t.id === 'np')).toMatchObject({ product: 'cards', partner: 'telco' });
    const row = await owner.query("select partner_id, details->>'legacy_partner' kept from items where owner_id = $1 and client_id = 'np'", [userId]);
    expect(row.rows).toEqual([{ partner_id: null, kept: 'telco' }]);
  });

  it('ends a pair: the row is kept, marked deleted, and devices are told', async () => {
    const upload = rowsToDocument(await read(), 'default', NOW + 4000);
    upload.workspaceData.bank.pairs = upload.workspaceData.bank.pairs.filter((p) => p.id !== 'savings+bureau');
    upload.deleted['pair:bank:savings+bureau'] = NOW + 4000;
    const reply = await sync(upload, NOW + 4000);
    expect(reply.workspaceData.bank.pairs.map((p) => p.id)).toEqual(['loans+telco']);
    expect(reply.deleted['pair:bank:savings+bureau']).toBe(NOW + 4000);
    const pair = await owner.query("select deleted_at is not null deleted from product_partners where owner_id = $1 and client_id = 'savings+bureau'", [userId]);
    expect(pair.rows).toEqual([{ deleted: true }]);
    expect(summariseDocument(reply, NOW + 4000)).toEqual(summariseDocument(rowsToDocument(await read(), 'default', NOW + 4000), NOW + 4000));
  });

  it('applies the sorting tool through sync: the project goes, its items move with their links', async () => {
    const now = NOW + 5000;
    const upload = rowsToDocument(await read(), 'default', now);
    const work = upload.workspaceData.work;
    const sorted = sortProjects(work, { 'client-x': { kind: 'pair', product: 'new:Client X', partner: 'new:Acme' } }, 'work', now);
    upload.workspaceData.work = { ...work, ...sorted.snap };
    Object.assign(upload.deleted, sorted.deleted);
    const reply = await sync(upload, now);
    const back = reply.workspaceData.work;
    expect(back.projects).toEqual([]);
    expect(back.pairs.map((p) => p.id)).toEqual(['client-x+acme']);
    expect(back.tasks.map((t) => [t.id, t.project, t.product, t.partner, t.deps])).toEqual([
      ['w2', '', 'client-x', 'acme', []],
      ['w1', '', 'client-x', 'acme', ['w2']],
    ]);
    const rows = await owner.query(
      `select i.client_id, i.project_id is null no_project, p.client_id product, q.client_id partner
         from items i left join products p on p.id = i.product_id left join partners q on q.id = i.partner_id
        where i.owner_id = $1 and i.client_id in ('w1', 'w2') order by i.client_id`,
      [userId],
    );
    expect(rows.rows).toEqual([
      { client_id: 'w1', no_project: true, product: 'client-x', partner: 'acme' },
      { client_id: 'w2', no_project: true, product: 'client-x', partner: 'acme' },
    ]);
    const project = await owner.query("select deleted_at is not null deleted from projects where owner_id = $1 and client_id = 'client-x'", [userId]);
    expect(project.rows).toEqual([{ deleted: true }]); // kept, marked deleted
    expect(summariseDocument(reply, now)).toEqual(summariseDocument(rowsToDocument(await read(), 'default', now), now));
  });

  it('syncs who an item waits on, its chase date and its snooze, and clears them (Step 2)', async () => {
    const now = NOW + 6000;
    const upload = rowsToDocument(await read(), 'default', now);
    const i1 = upload.workspaceData.bank.tasks.find((t) => t.id === 'i1')!;
    Object.assign(i1, { waitingOn: 'Fintech ops', chaseOn: '2026-12-03', snoozedUntil: '2026-12-01', updatedAt: now });
    // A new item, with dates the columns can't hold: kept as notes and given back as they were.
    upload.workspaceData.bank.tasks.unshift(task('w-new', '', { waitingOn: 'Telco IT', chaseOn: 'Friday', snoozedUntil: 'later', updatedAt: now }));
    const reply = await sync(upload, now);
    expect(reply.workspaceData.bank.tasks.find((t) => t.id === 'i1')).toMatchObject({ waitingOn: 'Fintech ops', chaseOn: '2026-12-03', snoozedUntil: '2026-12-01' });
    expect(reply.workspaceData.bank.tasks.find((t) => t.id === 'w-new')).toMatchObject({ waitingOn: 'Telco IT', chaseOn: 'Friday', snoozedUntil: 'later' });
    const made = await owner.query("select waiting_on, chase_on, details from items where owner_id = $1 and client_id = 'w-new'", [userId]);
    expect(made.rows).toEqual([{ waiting_on: 'Telco IT', chase_on: null, details: { legacy_chase_on: 'Friday', legacy_snoozed_until: 'later' } }]);
    const stored = () => owner.query("select waiting_on, chase_on::text, snoozed_until::text from items where owner_id = $1 and client_id = 'i1'", [userId]);
    expect((await stored()).rows).toEqual([{ waiting_on: 'Fintech ops', chase_on: '2026-12-03', snoozed_until: '2026-12-01' }]);

    const later = rowsToDocument(await read(), 'default', now + 1);
    const again = later.workspaceData.bank.tasks.find((t) => t.id === 'i1')!;
    delete again.waitingOn;
    delete again.chaseOn;
    delete again.snoozedUntil;
    again.updatedAt = now + 1;
    const cleared = await sync(later, now + 1);
    const back = cleared.workspaceData.bank.tasks.find((t) => t.id === 'i1')!;
    expect([back.waitingOn, back.chaseOn, back.snoozedUntil]).toEqual([undefined, undefined, undefined]);
    expect((await stored()).rows).toEqual([{ waiting_on: '', chase_on: null, snoozed_until: null }]);
  });

  it('syncs a new release and its sign-offs, append-only, and refuses what the database would (Step 3)', async () => {
    const now = NOW + 7000;
    const upload = rowsToDocument(await read(), 'default', now);
    const bank = upload.workspaceData.bank;
    bank.stages.push({ id: 'pen', name: 'Pen test', order: 3, updatedAt: now });
    bank.releases.push({ id: 'rel-2', product: 'loans', partner: 'telco', name: 'Loans v3', updatedAt: now });
    const signoff = { release: 'rel-2', stage: 'pen', stageName: 'Pen test', approver: 'Sam Kato', role: 'CISO', signedAt: '2026-11-26T11:00', evidence: 'https://bank.example/pen', note: '' };
    bank.signoffs.push(
      { ...signoff, id: 'so-3', outcome: 'failed', updatedAt: now },
      { ...signoff, id: 'so-4', outcome: 'passed', corrects: 'so-3', note: 'Retest misfiled', updatedAt: now + 1 },
      { ...signoff, id: 'so-bad', outcome: 'passed', evidence: 'javascript:alert(1)', updatedAt: now + 2 },
    );
    bank.releases.push({ id: 'rel-bad', product: 'cards', partner: 'telco', name: 'Not a pair', updatedAt: now });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reply = await sync(upload, now + 10);
    warn.mockRestore();
    const back = reply.workspaceData.bank;
    expect(back.releases.map((r) => r.id)).toEqual(['rel-1', 'rel-2']);
    expect(back.signoffs.map((s) => [s.id, s.corrects ?? ''])).toEqual([['so-1', ''], ['so-2', 'so-1'], ['so-3', ''], ['so-4', 'so-3']]);
    const stored = await owner.query(
      `select s.client_id, s.outcome, r.client_id release, st.client_id stage, c.client_id corrects, to_char(s.signed_at, 'YYYY-MM-DD HH24:MI') at
         from signoffs s join releases r on r.id = s.release_id join stages st on st.id = s.stage_id left join signoffs c on c.id = s.corrects_id
        where s.owner_id = $1 and s.client_id in ('so-3', 'so-4') order by 1`,
      [userId],
    );
    expect(stored.rows).toEqual([
      { client_id: 'so-3', outcome: 'failed', release: 'rel-2', stage: 'pen', corrects: null, at: '2026-11-26 11:00' },
      { client_id: 'so-4', outcome: 'passed', release: 'rel-2', stage: 'pen', corrects: 'so-3', at: '2026-11-26 11:00' },
    ]);

    // A device's copy of a stored sign-off never changes it.
    const again = rowsToDocument(await read(), 'default', now + 20);
    again.workspaceData.bank.signoffs.find((s) => s.id === 'so-3')!.outcome = 'passed';
    const second = await sync(again, now + 20);
    expect(second.workspaceData.bank.signoffs.find((s) => s.id === 'so-3')!.outcome).toBe('failed');
    const log = await owner.query("select count(*)::int n from change_log where actor_id = $1 and table_name = 'signoffs' and action = 'insert'", [userId]);
    expect(log.rows[0].n).toBe(2);
  });

  it('renames and reorders stages, dates a release, and deletes an unused one (Step 3)', async () => {
    const now = NOW + 8000;
    const upload = rowsToDocument(await read(), 'default', now);
    const bank = upload.workspaceData.bank;
    Object.assign(bank.stages.find((s) => s.id === 'pen')!, { name: 'Penetration test', order: 0.5, updatedAt: now });
    Object.assign(bank.releases.find((r) => r.id === 'rel-1')!, { targetDate: '2027-01-10', updatedAt: now });
    bank.stages = bank.stages.filter((s) => s.id !== 'uat');
    upload.deleted['stage:bank:uat'] = now;
    const reply = await sync(upload, now);
    expect(reply.workspaceData.bank.stages.map((s) => [s.id, s.name])).toEqual([['pen', 'Penetration test'], ['sit', 'SIT']]);
    expect(reply.workspaceData.bank.releases[0].targetDate).toBe('2027-01-10');
    const uat = await owner.query("select deleted_at is not null deleted from stages where owner_id = $1 and client_id = 'uat'", [userId]);
    expect(uat.rows).toEqual([{ deleted: true }]);
    expect(summariseDocument(reply, now)).toEqual(summariseDocument(rowsToDocument(await read(), 'default', now), now));
  });
});

