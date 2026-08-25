import type { Priority, Project, Task } from '../types';
import { offsetFromToday } from './date';

export interface FilterState {
  project: string | null;
  priority: Priority | null;
  search: string;
}

/** Project + priority + search filters, composed with AND. Used everywhere except hideDone. */
export function visibleTasks(tasks: Task[], projects: Project[], f: FilterState): Task[] {
  const q = f.search.trim().toLowerCase();
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return tasks.filter((t) => {
    if (f.project && t.project !== f.project) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (q) {
      const projectName = projectById.get(t.project)?.name.toLowerCase() ?? '';
      if (!t.title.toLowerCase().includes(q) && !projectName.includes(q)) return false;
    }
    return true;
  });
}

export function withoutDone(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status !== 'done');
}

export function sortByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function projectById(projects: Project[], id: string): Project {
  return projects.find((p) => p.id === id) ?? projects[0];
}

export function subtaskProgress(t: Task): { done: number; total: number } {
  return { done: t.subs.filter((s) => s.done).length, total: t.subs.length };
}

export interface ProjectStats {
  project: Project;
  total: number;
  done: number;
  percent: number;
  overdueCount: number;
  nextTask: Task | null;
}

export function projectStats(tasks: Task[], project: Project): ProjectStats {
  const forProject = tasks.filter((t) => t.project === project.id);
  const done = forProject.filter((t) => t.status === 'done').length;
  const open = sortByDue(forProject.filter((t) => t.status !== 'done'));
  const overdueCount = open.filter((t) => offsetFromToday(t.dueDate) < 0).length;
  return {
    project,
    total: forProject.length,
    done,
    percent: forProject.length ? Math.round((done / forProject.length) * 100) : 0,
    overdueCount,
    nextTask: open[0] ?? null,
  };
}

export function depTitles(tasks: Task[], deps: string[]): string {
  if (!deps.length) return '—';
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return deps.map((id) => byId.get(id)?.title ?? id).join(', ');
}
