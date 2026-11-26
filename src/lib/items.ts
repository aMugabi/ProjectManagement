/**
 * Changes to one item or to the catalogue (projects, products, partners, pairs) as pure
 * functions, so the store stays a thin layer and the rules can be tested on their own. Build plan
 * Step 1b: an item belongs to a plain project, or to a product and/or a partner (both only as a
 * pair, which is made when needed), or to nothing.
 */
import type { FieldInfo } from '../shared/itemTypes';
import { ITEM_TYPES, statusAllowed, firstStatus, typeOf } from '../shared/itemTypes';
import { pairId } from '../shared/state';
import type { ItemType, ProductPartner, Task, WorkspaceSnapshot } from '../types';

/** Where an item belongs, as one select value: 'project:<id>', 'product:<id>', 'partner:<id>', 'pair:<product>+<partner>' or ''. */
export type HomeValue = string;

export interface Home {
  project: string;
  product: string;
  partner: string;
}

export function homeValue(t: Pick<Task, 'project' | 'product' | 'partner'>): HomeValue {
  if (t.project) return `project:${t.project}`;
  if (t.product && t.partner) return `pair:${pairId(t.product, t.partner)}`;
  if (t.product) return `product:${t.product}`;
  if (t.partner) return `partner:${t.partner}`;
  return '';
}

export function parseHome(value: HomeValue): Home {
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'project') return { project: id, product: '', partner: '' };
  if (kind === 'product') return { project: '', product: id, partner: '' };
  if (kind === 'partner') return { project: '', product: '', partner: id };
  if (kind === 'pair') {
    const plus = id.indexOf('+');
    return { project: '', product: id.slice(0, plus), partner: id.slice(plus + 1) };
  }
  return { project: '', product: '', partner: '' };
}

/**
 * The item moved to `home`. A plain project excludes a product and partner; a product with a
 * partner needs them to be a pair, so the pair to add (if it doesn't exist yet) comes back too.
 */
export function withHome(t: Task, home: Home, pairs: ProductPartner[], now: number): { task: Task; newPair: ProductPartner | null } {
  const task: Task = { ...t, project: home.project };
  delete task.product;
  delete task.partner;
  if (!home.project) {
    if (home.product) task.product = home.product;
    if (home.partner) task.partner = home.partner;
  }
  let newPair: ProductPartner | null = null;
  if (task.product && task.partner) {
    const id = pairId(task.product, task.partner);
    if (!pairs.some((p) => p.id === id)) newPair = { id, product: task.product, partner: task.partner, updatedAt: now };
  }
  return { task, newPair };
}

/** Kinds of field a value can move between when the type changes. */
const compatible = (a: FieldInfo['kind'], b: FieldInfo['kind']) => a === b || (a !== 'level' && a !== 'date' && b !== 'level' && b !== 'date');

/**
 * The item as another type: its status kept if the new type has it, otherwise the new type's
 * first; its own fields kept only where the new type has a field of that name and kind (a risk's
 * impact is a level, an issue's is text, so that one goes).
 */
export function withType(t: Task, type: ItemType): Task {
  const from = ITEM_TYPES[typeOf(t)].fields;
  const to = ITEM_TYPES[type].fields;
  const details: Record<string, unknown> = {};
  for (const field of to) {
    const old = from.find((f) => f.key === field.key);
    const value = t.details?.[field.key];
    if (old && value !== undefined && compatible(old.kind, field.kind)) details[field.key] = value;
  }
  const next: Task = { ...t, status: statusAllowed(type, t.status) ? t.status : firstStatus(type), details };
  if (type === 'task') delete next.type;
  else next.type = type;
  if (!Object.keys(details).length) delete next.details;
  return next;
}

/** The item with one of its own fields set, or cleared when `value` is empty. */
export function withDetail(t: Task, key: string, value: string): Task {
  const details = { ...(t.details ?? {}) };
  if (value.trim() === '') delete details[key];
  else details[key] = value;
  const next: Task = { ...t, details };
  if (!Object.keys(details).length) delete next.details;
  return next;
}

/** Who the item waits on; clearing it clears the chase date too (there is no one left to chase). */
export function withWaiting(t: Task, waitingOn: string): Task {
  const next: Task = { ...t };
  if (waitingOn.trim()) next.waitingOn = waitingOn;
  else {
    delete next.waitingOn;
    delete next.chaseOn;
  }
  return next;
}

/** The item with its chase date or snooze set to an ISO date, or cleared by ''. */
export function withDate(t: Task, key: 'chaseOn' | 'snoozedUntil', iso: string): Task {
  const next: Task = { ...t };
  if (iso) next[key] = iso;
  else delete next[key];
  return next;
}

/**
 * Removes a product or partner from a workspace: its pairs go with it, and its items stay,
 * no longer in it (unlike a project, whose tasks are deleted with it). Returns the new lists and
 * the deletion records to remember ('product:…' or 'partner:…', and 'pair:…').
 */
export function withoutGroup(
  snap: WorkspaceSnapshot,
  kind: 'product' | 'partner',
  id: string,
  workspace: string,
  now: number,
): { snap: WorkspaceSnapshot; deleted: Record<string, number> } {
  const deleted: Record<string, number> = { [`${kind}:${workspace}:${id}`]: now };
  const gone = snap.pairs.filter((p) => p[kind] === id);
  for (const p of gone) deleted[`pair:${workspace}:${p.id}`] = now;
  const tasks = snap.tasks.map((t) => {
    if (t[kind] !== id) return t;
    const next = { ...t, updatedAt: now };
    delete next[kind];
    return next;
  });
  const list = kind === 'product' ? 'products' : 'partners';
  return {
    snap: { ...snap, [list]: snap[list].filter((g) => g.id !== id), pairs: snap.pairs.filter((p) => p[kind] !== id), tasks },
    deleted,
  };
}

/** What a project becomes when sorted (Step 1b): a product, a partner, or a product with a partner. */
export type ProjectTarget =
  | { kind: 'product'; product: string }
  | { kind: 'partner'; partner: string }
  | { kind: 'pair'; product: string; partner: string };

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'item';
}

/** A slug id unique in `taken`, from a name ('Mobile loans' → 'mobile-loans', then 'mobile-loans-2'). */
export function uniqueId(name: string, taken: Iterable<string>): string {
  const ids = new Set(taken);
  const base = slugify(name);
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * A plain project turned into a product, a partner, or a product with a partner. `product` and
 * `partner` name an existing one by id, or one by `new:<name>`: the existing one of that name
 * (any case), else a new one with the project's colour. Its items move there (re-stamped), the
 * pair is made if needed, and the project goes: nothing is deleted but the project itself.
 */
export function convertProject(
  snap: WorkspaceSnapshot,
  projectId: string,
  target: ProjectTarget,
  workspace: string,
  now: number,
): { snap: WorkspaceSnapshot; deleted: Record<string, number> } {
  const project = snap.projects.find((p) => p.id === projectId);
  if (!project) return { snap, deleted: {} };
  let { products, partners, pairs } = snap;
  const resolve = (ref: string, list: WorkspaceSnapshot['products']): { id: string; list: WorkspaceSnapshot['products'] } => {
    if (!ref.startsWith('new:')) return { id: ref, list };
    const name = ref.slice(4).trim() || project.name;
    const same = list.find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
    if (same) return { id: same.id, list };
    const id = uniqueId(name, list.map((g) => g.id));
    return { id, list: [...list, { id, name, color: project.color, updatedAt: now }] };
  };
  let product = '';
  let partner = '';
  if (target.kind !== 'partner') ({ id: product, list: products } = resolve(target.product, products));
  if (target.kind !== 'product') ({ id: partner, list: partners } = resolve(target.partner, partners));
  if (product && partner && !pairs.some((p) => p.id === pairId(product, partner))) {
    pairs = [...pairs, { id: pairId(product, partner), product, partner, updatedAt: now }];
  }
  const tasks = snap.tasks.map((t) => {
    if (t.project !== projectId) return t;
    const next: Task = { ...t, project: '', updatedAt: now };
    delete next.product;
    delete next.partner;
    if (product) next.product = product;
    if (partner) next.partner = partner;
    return next;
  });
  return {
    snap: { ...snap, projects: snap.projects.filter((p) => p.id !== projectId), products, partners, pairs, tasks },
    deleted: { [`project:${workspace}:${projectId}`]: now },
  };
}

/**
 * Several projects sorted at once (the Step 1b sorting tool): each one in `choices` is converted;
 * projects left out stay plain projects. Products or partners named alike are made once and shared.
 */
export function sortProjects(
  snap: WorkspaceSnapshot,
  choices: Record<string, ProjectTarget>,
  workspace: string,
  now: number,
): { snap: WorkspaceSnapshot; deleted: Record<string, number> } {
  let next = snap;
  let deleted: Record<string, number> = {};
  for (const project of snap.projects) {
    const target = Object.hasOwn(choices, project.id) ? choices[project.id] : undefined;
    if (!target) continue;
    const step = convertProject(next, project.id, target, workspace, now);
    next = step.snap;
    deleted = { ...deleted, ...step.deleted };
  }
  return { snap: next, deleted };
}

export interface SortSummary {
  /** Names of the products, partners and pairs ('Loans · Telco') the sort makes. */
  newProducts: string[];
  newPartners: string[];
  newPairs: string[];
  projectsSorted: number;
  projectsLeft: number;
  itemsMoved: number;
  /** Items before and after: must be equal, or nothing is applied. */
  itemsBefore: number;
  itemsAfter: number;
}

/** What a sort does, from the snapshots before and after (the dry run, and the check after). */
export function sortSummary(before: WorkspaceSnapshot, after: WorkspaceSnapshot): SortSummary {
  const added = <T extends { id: string }>(a: T[], b: T[]) => b.filter((x) => !a.some((y) => y.id === x.id));
  const name = (list: { id: string; name: string }[], id: string) => list.find((g) => g.id === id)?.name ?? id;
  const homes = new Map(before.tasks.map((t) => [t.id, homeValue(t)]));
  return {
    newProducts: added(before.products, after.products).map((p) => p.name),
    newPartners: added(before.partners, after.partners).map((p) => p.name),
    newPairs: added(before.pairs, after.pairs).map((p) => `${name(after.products, p.product)} · ${name(after.partners, p.partner)}`),
    projectsSorted: before.projects.length - after.projects.length,
    projectsLeft: after.projects.length,
    itemsMoved: after.tasks.filter((t) => homes.has(t.id) && homes.get(t.id) !== homeValue(t)).length,
    itemsBefore: before.tasks.length,
    itemsAfter: after.tasks.length,
  };
}
