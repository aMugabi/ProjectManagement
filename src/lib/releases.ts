/**
 * Changes to stages, releases and sign-offs (build plan Step 3) as pure functions on a workspace
 * snapshot. Sign-offs are records: they are only ever added. A release or stage that a sign-off
 * names can't be deleted, and nor can a product or partner a release belongs to.
 */
import type { SignOff, Stage, WorkspaceSnapshot } from '../types';
import { byOrder, defaultStages, signOffProblem } from '../shared/delivery';
import { pairId } from '../shared/state';
import { uniqueId } from './items';

type Snap = WorkspaceSnapshot;

/** A fresh id that sorts by creation time ('so-…', 'rel-…'). */
export function freshId(prefix: string, now: number): string {
  return `${prefix}-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The snapshot with the default stage template, if it has no stages yet. */
export function withStages(snap: Snap, now: number): Snap {
  return snap.stages.length ? snap : { ...snap, stages: defaultStages(now) };
}

/** A new release for a product with a partner; their pair (and the stage template) made if needed. */
export function addRelease(snap: Snap, input: { product: string; partner: string; name: string; targetDate?: string }, now: number): { snap: Snap; id: string } {
  const id = freshId('rel', now);
  let next = withStages(snap, now);
  const pair = pairId(input.product, input.partner);
  if (!next.pairs.some((p) => p.id === pair)) next = { ...next, pairs: [...next.pairs, { id: pair, product: input.product, partner: input.partner, updatedAt: now }] };
  const release = { id, product: input.product, partner: input.partner, name: input.name.trim(), updatedAt: now, ...(input.targetDate ? { targetDate: input.targetDate } : {}) };
  return { snap: { ...next, releases: [...next.releases, release] }, id };
}

export function updateRelease(snap: Snap, id: string, patch: { name?: string; targetDate?: string }, now: number): Snap {
  return {
    ...snap,
    releases: snap.releases.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, updatedAt: now };
      if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
      if (patch.targetDate !== undefined) {
        if (patch.targetDate) next.targetDate = patch.targetDate;
        else delete next.targetDate;
      }
      return next;
    }),
  };
}

/** Deletes a release with no sign-offs; null if it has some (they keep it). */
export function deleteRelease(snap: Snap, id: string, workspace: string, now: number): { snap: Snap; deleted: Record<string, number> } | null {
  if (snap.signoffs.some((s) => s.release === id)) return null;
  return { snap: { ...snap, releases: snap.releases.filter((r) => r.id !== id) }, deleted: { [`release:${workspace}:${id}`]: now } };
}

export function addStage(snap: Snap, name: string, now: number): Snap {
  const trimmed = name.trim();
  if (!trimmed) return snap;
  const base = withStages(snap, now);
  const order = Math.max(0, ...base.stages.map((s) => s.order)) + 1;
  return { ...base, stages: [...base.stages, { id: uniqueId(trimmed, base.stages.map((s) => s.id)), name: trimmed, order, updatedAt: now }] };
}

export function renameStage(snap: Snap, id: string, name: string, now: number): Snap {
  if (!name.trim()) return snap;
  return { ...snap, stages: snap.stages.map((s) => (s.id === id ? { ...s, name: name.trim(), updatedAt: now } : s)) };
}

/** Swaps a stage with its neighbour (-1 = earlier, 1 = later). */
export function moveStage(snap: Snap, id: string, direction: -1 | 1, now: number): Snap {
  const sorted = [...snap.stages].sort(byOrder);
  const i = sorted.findIndex((s) => s.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return snap;
  const [a, b] = [sorted[i], sorted[j]];
  const swapped = new Map<string, Stage>([
    [a.id, { ...a, order: b.order, updatedAt: now }],
    [b.id, { ...b, order: a.order, updatedAt: now }],
  ]);
  // Equal orders (two devices added stages at once) are spread out first, so the swap moves them.
  if (a.order === b.order) {
    swapped.set(a.id, { ...a, order: j + 1, updatedAt: now });
    swapped.set(b.id, { ...b, order: i + 1, updatedAt: now });
  }
  return { ...snap, stages: snap.stages.map((s) => swapped.get(s.id) ?? s) };
}

/** Deletes a stage no sign-off names; null if one does. */
export function deleteStage(snap: Snap, id: string, workspace: string, now: number): { snap: Snap; deleted: Record<string, number> } | null {
  if (snap.signoffs.some((s) => s.stage === id)) return null;
  return { snap: { ...snap, stages: snap.stages.filter((s) => s.id !== id) }, deleted: { [`stage:${workspace}:${id}`]: now } };
}

export type SignOffInput = Pick<SignOff, 'release' | 'stage' | 'outcome' | 'approver' | 'role' | 'signedAt' | 'evidence' | 'note'> & { corrects?: string };

/** Records a sign-off (or a correction of one), or says why it can't be recorded. */
export function addSignOff(snap: Snap, input: SignOffInput, now: number, id = freshId('so', now)): { snap: Snap; id: string } | { problem: string } {
  const stage = snap.stages.find((s) => s.id === input.stage);
  if (!stage) return { problem: 'that stage is not in the template' };
  if (!snap.releases.some((r) => r.id === input.release)) return { problem: 'that release does not exist' };
  if (input.corrects && !snap.signoffs.some((s) => s.id === input.corrects && s.release === input.release)) return { problem: 'the sign-off to correct is not on this release' };
  const signoff: SignOff = {
    id,
    release: input.release,
    stage: stage.id,
    stageName: stage.name,
    outcome: input.outcome,
    approver: input.approver.trim(),
    role: input.role.trim(),
    signedAt: input.signedAt,
    evidence: input.evidence.trim(),
    note: input.note.trim(),
    updatedAt: now,
    ...(input.corrects ? { corrects: input.corrects } : {}),
  };
  const problem = signOffProblem(signoff);
  if (problem) return { problem };
  return { snap: { ...snap, signoffs: [...snap.signoffs, signoff] }, id };
}

/** Releases of a product or partner: while there are any, it can't be deleted. */
export function releasesOf(snap: Snap, kind: 'product' | 'partner', id: string): number {
  return snap.releases.filter((r) => r[kind] === id).length;
}
