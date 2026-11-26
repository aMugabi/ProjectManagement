/** Shared test data for the database tests: one document holding everything the app stores. */
import type { Task } from '../../../../src/types.js';
import { normalizeState, type SyncedState } from '../../../../src/shared/state.js';

export const NOW = Date.now();
export const OWNER = '00000000-0000-0000-0000-0000000000aa';

/** Repeatable uuids, so failures are readable. */
export function ids() {
  let n = 0;
  return () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
}

export function task(id: string, project: string, extra: Partial<Task> = {}): Task {
  return {
    id, project, title: `Title ${id}`, status: 'todo', priority: 'med', dueDate: '2026-12-01', subs: [],
    recurring: null, deps: [], notes: '', order: 0, updatedAt: NOW - 5000, ...extra,
  };
}

/** Everything the app stores: three workspaces (one named like an Object built-in), every task field. */
export function document(): SyncedState {
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
          // Listed out of id order, so only the stored list order can bring them back like this.
          tasks: [task('w2', 'client-x', { recurring: 'monthly' }), task('w1', 'client-x', { deps: ['w2'], priority: 'low' })],
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
