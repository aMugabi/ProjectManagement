import type { Project, Task } from '../types';
import { addDays, dateToIso, today } from '../lib/date';

export const PROJECTS: Project[] = [
  { id: 'aur', name: 'Aurora Site Redesign', color: '#b4674a' },
  { id: 'pod', name: 'Podcast Season 3', color: '#6d7f5b' },
  { id: 'fin', name: 'Finance Cleanup', color: '#7b6a94' },
  { id: 'apt', name: 'Apartment Move', color: '#4f7a86' },
  { id: 'wrt', name: 'Writing: Field Notes', color: '#a08a4b' },
];

// [id, project, title, status, priority, dueOffset(days from today), subtask texts,
//  number of those subtasks already done, recurring, deps, notes]
const SEED: [
  string,
  string,
  string,
  Task['status'],
  Task['priority'],
  number,
  string[],
  number,
  Task['recurring'],
  string[],
  string,
][] = [
  ['t1', 'aur', 'Rework homepage hero copy', 'doing', 'high', 0, ['Pull old analytics', 'Draft three angles', 'Pick one', 'Write final', 'Hand to design'], 3, null, [], 'Third pass. Keep it under 12 words.'],
  ['t2', 'aur', 'Export icon set to SVG', 'todo', 'med', 2, [], 0, null, [], ''],
  ['t3', 'aur', 'Fix mobile nav overlap', 'todo', 'high', -1, [], 0, null, ['t1'], 'Only shows under 380px.'],
  ['t4', 'aur', 'Pick photography for case studies', 'todo', 'low', 6, ['Shortlist 10', 'Licence check'], 1, null, [], ''],
  ['t5', 'aur', 'Ship staging build', 'todo', 'high', 9, [], 0, null, ['t1', 't3'], ''],
  ['t6', 'aur', 'Audit old blog URLs', 'done', 'low', -4, [], 0, null, [], ''],
  ['t7', 'pod', 'Book guest for episode 4', 'doing', 'high', 1, ['Send invite', 'Confirm date'], 1, null, [], ''],
  ['t8', 'pod', 'Edit episode 2 rough cut', 'todo', 'med', 3, [], 0, null, [], ''],
  ['t9', 'pod', 'Write show notes, episode 1', 'done', 'med', -2, [], 0, null, [], ''],
  ['t10', 'pod', 'Renew hosting plan', 'todo', 'low', 12, [], 0, 'yearly', [], ''],
  ['t11', 'pod', 'Draft sponsor one-pager', 'todo', 'med', 4, [], 0, null, ['t7'], ''],
  ['t12', 'fin', 'Reconcile July receipts', 'todo', 'high', 0, ['Download statements', 'Match to invoices', 'Flag oddities'], 1, 'monthly', [], ''],
  ['t13', 'fin', 'Move savings to new account', 'todo', 'med', 5, [], 0, null, [], ''],
  ['t14', 'fin', 'Cancel unused subscriptions', 'doing', 'low', 7, ['List them', 'Cancel four'], 1, null, [], ''],
  ['t15', 'fin', 'File Q2 estimate', 'done', 'high', -6, [], 0, null, [], ''],
  ['t16', 'apt', 'Get quotes from three movers', 'doing', 'high', 2, ['Northline', 'Bell & Co', 'Harbour'], 1, null, [], ''],
  ['t17', 'apt', 'Measure living room', 'todo', 'low', 4, [], 0, null, [], ''],
  ['t18', 'apt', 'Transfer internet service', 'todo', 'med', 8, [], 0, null, ['t16'], ''],
  ['t19', 'wrt', 'Outline essay 04', 'todo', 'med', 1, [], 0, null, [], ''],
  ['t20', 'wrt', 'Weekly review and publish', 'todo', 'low', 3, [], 0, 'weekly', [], ''],
  ['t21', 'wrt', 'Revise essay 03', 'doing', 'med', -1, ['Cut the middle', 'Rewrite ending'], 0, null, [], ''],
];

export function buildSeedTasks(): Task[] {
  const base = today();
  return SEED.map(
    ([id, project, title, status, priority, dueOffset, subTexts, doneCount, recurring, deps, notes], i) => ({
      id,
      project,
      title,
      status,
      priority,
      dueDate: dateToIso(addDays(base, dueOffset)),
      subs: subTexts.map((text, j) => ({ text, done: j < doneCount })),
      recurring,
      deps,
      notes,
      order: i,
    }),
  );
}
