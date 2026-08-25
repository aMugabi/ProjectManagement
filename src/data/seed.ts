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
// Intentionally empty — this was demo/test data, cleared for real use.
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
][] = [];

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
