import type { Project, Task } from '../types';
import { addDays, dateToIso, today } from '../lib/date';

// Intentionally empty — projects are added and renamed from the sidebar now (see taskStore.ts).
export const PROJECTS: Project[] = [];

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
