/**
 * The checks on each item type's own fields (build plan Step 1b), with Zod. Loaded by the server
 * (sync refuses an item that fails them); the app uses src/shared/itemTypes.ts, without Zod.
 * Every field is optional, and only the listed ones are allowed.
 */
import { z } from 'zod';
import type { ItemType, Task } from '../types.js';
import { isItemType, statusAllowed, typeOf } from './itemTypes.js';

const level = z.enum(['low', 'med', 'high']);
const text = z.string().max(10_000);
const name = z.string().max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DETAILS: Record<ItemType, z.ZodType> = {
  task: z.object({}).strict(),
  risk: z.object({ likelihood: level, impact: level, mitigation: text }).partial().strict(),
  issue: z.object({ impact: text, resolution: text }).partial().strict(),
  decision: z.object({ decidedBy: name, decidedOn: isoDate, rationale: text }).partial().strict(),
  dependency: z.object({ onWhom: name }).partial().strict(),
  change_request: z.object({ requestedBy: name, approver: name, impact: text }).partial().strict(),
};

/** Why an item can't be stored, or null when it can. */
export function itemProblem(item: Task): string | null {
  if (item.type !== undefined && !isItemType(item.type)) return `unknown type ${JSON.stringify(item.type)}`;
  const type = typeOf(item);
  if (!statusAllowed(type, item.status)) return `status ${JSON.stringify(item.status)} isn't one a ${type} can have`;
  if (item.project && (item.product || item.partner)) return 'belongs to a plain project and to a product or partner';
  const details = DETAILS[type].safeParse(item.details ?? {});
  if (!details.success) return `${type} fields: ${details.error.issues.map((i) => `${i.path.join('.') || 'details'} ${i.message}`).join('; ')}`;
  return null;
}
