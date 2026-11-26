import type { ItemType, Partner, Priority, Product, Project, Task } from '../types';
import { offsetFromToday } from '../shared/date';
import { isDone, phaseOfStatus, typeOf, type Phase } from '../shared/itemTypes';
import { homeValue } from './items';

export { stripDeps } from '../shared/state';

export interface FilterState {
  project: string | null;
  priority: Priority | null;
  search: string;
  /** Items in this product (alone or with a partner). */
  product?: string | null;
  /** Items with this partner (alone or with a product). */
  partner?: string | null;
  type?: ItemType | null;
}

/** The active workspace's projects, products and partners: what an item can belong to. */
export interface Catalogue {
  projects: Project[];
  products: Product[];
  partners: Partner[];
}

/** Where an item belongs, for showing: a name and a colour, and the select value it has. */
export interface Home {
  value: string;
  name: string;
  color: string;
}

export const NO_HOME: Home = { value: '', name: 'No project', color: 'var(--border-strong)' };

export function homeOf(t: Pick<Task, 'project' | 'product' | 'partner'>, c: Catalogue): Home {
  const project = t.project ? c.projects.find((p) => p.id === t.project) : undefined;
  if (project) return { value: homeValue(t), name: project.name, color: project.color };
  const product = t.product ? c.products.find((p) => p.id === t.product) : undefined;
  const partner = t.partner ? c.partners.find((p) => p.id === t.partner) : undefined;
  if (product && partner) return { value: homeValue(t), name: `${product.name} · ${partner.name}`, color: product.color };
  if (product) return { value: `product:${product.id}`, name: product.name, color: product.color };
  if (partner) return { value: `partner:${partner.id}`, name: partner.name, color: partner.color };
  return NO_HOME;
}

/** Project, product, partner, type, priority and search filters, composed with AND. Used everywhere except hideDone. */
export function visibleTasks(tasks: Task[], c: Catalogue, f: FilterState): Task[] {
  const q = f.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.project && t.project !== f.project) return false;
    if (f.product && t.product !== f.product) return false;
    if (f.partner && t.partner !== f.partner) return false;
    if (f.type && typeOf(t) !== f.type) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (q) {
      const home = homeOf(t, c).name.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !home.includes(q)) return false;
    }
    return true;
  });
}

export function withoutDone(tasks: Task[]): Task[] {
  return tasks.filter((t) => !isDone(t));
}

export function sortByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function sortByOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order);
}

/** An item is blocked whenever it has a dependency that isn't finished (or no longer exists) — derived, not chosen. */
export function isDepBlocked(task: Task, tasks: Task[]): boolean {
  if (!task.deps.length) return false;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return task.deps.some((id) => {
    const dep = byId.get(id);
    return !dep || !isDone(dep);
  });
}

/** Where an item stands, whatever its type (the board's columns): finished stays finished; unfinished dependencies block. */
export function phaseOf(task: Task, tasks: Task[]): Phase {
  if (isDone(task)) return 'done';
  return isDepBlocked(task, tasks) ? 'blocked' : phaseOfStatus(task);
}

export function subtaskProgress(t: Task): { done: number; total: number } {
  return { done: t.subs.filter((s) => s.done).length, total: t.subs.length };
}

/** A project, product or partner, for the dashboard's health lists. */
export type GroupKind = 'project' | 'product' | 'partner';

export interface ProjectStats {
  project: Project;
  kind: GroupKind;
  total: number;
  done: number;
  percent: number;
  overdueCount: number;
  nextTask: Task | null;
}

/** How a project, product or partner is doing: its items (a product's or partner's include their pairs'). */
export function projectStats(tasks: Task[], project: Project, kind: GroupKind = 'project'): ProjectStats {
  const forProject = tasks.filter((t) => t[kind] === project.id);
  const done = forProject.filter((t) => isDone(t)).length;
  const open = sortByDue(forProject.filter((t) => !isDone(t)));
  const overdueCount = open.filter((t) => offsetFromToday(t.dueDate) < 0).length;
  return {
    project,
    kind,
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
  return deps.map((id) => byId.get(id)?.title ?? 'a missing task').join(', ');
}

/** True if making `id` depend on `dependsOnId` would close a loop (A → B → … → A), which would block every task in it forever. */
export function wouldCreateCycle(tasks: Task[], id: string, dependsOnId: string): boolean {
  if (id === dependsOnId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === id) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(byId.get(current)?.deps ?? []));
  }
  return false;
}
