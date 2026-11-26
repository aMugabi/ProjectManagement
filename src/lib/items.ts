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
