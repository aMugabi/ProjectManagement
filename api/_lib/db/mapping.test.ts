import { describe, expect, it } from 'vitest';
import type { Task } from '../../../src/types';
import { normalizeState, TOMBSTONE_TTL_MS, type SyncedState } from '../../../src/shared/state';
import { documentToRows, rowsToDocument, summariseDocument } from './mapping';

const NOW = Date.now();
const OWNER = '00000000-0000-0000-0000-0000000000aa';

/** Repeatable uuids, so failures are readable. */
function ids() {
  let n = 0;
  return () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
}

function task(id: string, project: string, extra: Partial<Task> = {}): Task {
  return {
    id, project, title: `Title ${id}`, status: 'todo', priority: 'med', dueDate: '2026-12-01', subs: [],
    recurring: null, deps: [], notes: '', order: 0, updatedAt: NOW - 5000, ...extra,
  };
}

/** Everything the app stores: three workspaces (one named like an Object built-in), every task field. */
function document(): SyncedState {
  return normalizeState(
    {
      workspaces: [
        { id: 'default', name: 'My Workspace', updatedAt: 1 },
        { id: 'work', name: 'Work', updatedAt: NOW - 9000 },
        { id: 'constructor', name: 'Odd', updatedAt: 2 },
      ],
      activeWorkspaceId: 'default',
      projects: [
        { id: 'home', name: 'Home', color: '#b4674a', updatedAt: NOW - 8000 },
        { id: 'admin', name: 'Admin', color: '#6d7f5b', updatedAt: 0 },
      ],
      tasks: [
        task('t1', 'home', {
          status: 'doing', priority: 'high', deps: ['t2'], subs: [{ text: 'Call', done: true }, { text: 'Write', done: false }],
          recurring: 'weekly', remindDaysBefore: 3, startDate: '2026-11-20', notes: 'Notes\nwith a line', order: 2,
        }),
        task('t2', 'home', { status: 'done', remindDaysBefore: null, order: -1 }),
        task('t3', 'admin', { title: 'Plain', updatedAt: 0 }),
      ],
      workspaceData: {
        work: {
          projects: [{ id: 'client-x', name: 'Client X', color: '#4f7a86', updatedAt: NOW - 7000 }],
          tasks: [task('w1', 'client-x', { deps: ['w2'], priority: 'low' }), task('w2', 'client-x', { recurring: 'monthly' })],
        },
        constructor: { projects: [], tasks: [] },
      },
      deleted: {
        'task:default:gone': NOW - 1000,
        'project:work:old-project': NOW - 2000,
      },
      reminders: {
        enabled: true, digestTime: '07:30', defaultLeadDays: 2, includeOverdue: false, timezone: 'Africa/Kampala',
        emailDigest: true, email: 'me@example.org', privateNotifications: false, updatedAt: 123,
      },
    },
    NOW,
  );
}

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
    expect(onWork.tasks.map((t) => t.id)).toEqual(['w1', 'w2']);
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

  it('keeps what it has to change, and says so', () => {
    const doc = document();
    doc.tasks[2] = { ...doc.tasks[2], project: 'vanished', dueDate: 'soon' };
    doc.projects[1] = { ...doc.projects[1], color: 'teal' };
    const { rows, notes } = documentToRows(doc, OWNER, ids());
    expect(notes.map((n) => n.where)).toEqual(['default/admin', 'default/t3', 'default/t3']);
    const t3 = rows.items.find((i) => i.client_id === 't3')!;
    expect([t3.project_id, t3.due_date, t3.details]).toEqual([null, null, { legacy_project: 'vanished', legacy_due_date: 'soon' }]);
    const back = rowsToDocument(rows, 'default', NOW).tasks.find((t) => t.id === 't3')!;
    expect([back.project, back.dueDate]).toEqual(['vanished', 'soon']); // the task itself is unchanged
  });
});

describe('summariseDocument', () => {
  it('counts each workspace', () => {
    expect(summariseDocument(document()).workspaces).toEqual([
      { workspace: 'default', projects: 2, tasks: 3, done: 1, dependencies: 1, deletions: 1 },
      { workspace: 'work', projects: 1, tasks: 2, done: 0, dependencies: 1, deletions: 1 },
      { workspace: 'constructor', projects: 0, tasks: 0, done: 0, dependencies: 0, deletions: 0 },
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
