/**
 * Delivery tracking (build plan Step 3): a workspace's stage template, releases of a product with
 * a partner, and the sign-offs that move a release through its stages. Pure, so the app, the
 * server and the reports apply the same rules.
 */
import type { Release, SignOff, SignOffOutcome, Stage } from '../types.js';

/** The template a workspace starts with; editable afterwards. */
export const DEFAULT_STAGES: readonly { id: string; name: string }[] = [
  { id: 'sit', name: 'SIT' },
  { id: 'uat', name: 'UAT' },
  { id: 'uvt', name: 'UVT' },
  { id: 'infosec', name: 'InfoSec' },
  { id: 'go-live', name: 'Go-live' },
];

export const OUTCOMES: readonly { id: SignOffOutcome; label: string }[] = [
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Failed' },
  { id: 'waived', label: 'Waived' },
];

export function defaultStages(now: number): Stage[] {
  return DEFAULT_STAGES.map((s, i) => ({ id: s.id, name: s.name, order: i + 1, updatedAt: now }));
}

export const byOrder = (a: Stage, b: Stage) => a.order - b.order || a.id.localeCompare(b.id);

/** Sign-offs still in force: every one that no other sign-off corrects. */
export function inForce(signoffs: SignOff[]): SignOff[] {
  const corrected = new Set(signoffs.map((s) => s.corrects).filter(Boolean));
  return signoffs.filter((s) => !corrected.has(s.id));
}

/** Newest first: by the approver's time, then by when it was recorded. */
export const newestFirst = (a: SignOff, b: SignOff) => b.signedAt.localeCompare(a.signedAt) || b.updatedAt - a.updatedAt;

export type ReleaseStatus = 'not-started' | 'in-progress' | 'failed' | 'live';

export interface ReleaseProgress {
  /** Each stage in order, with the sign-off in force for it (the newest, if several). */
  stages: { stage: Stage; signoff?: SignOff }[];
  status: ReleaseStatus;
  /** The first stage not yet passed or waived. */
  next?: Stage;
  /** The stage whose newest sign-off failed. */
  failedAt?: Stage;
}

export function releaseProgress(release: Pick<Release, 'id'>, stages: Stage[], signoffs: SignOff[]): ReleaseProgress {
  const mine = inForce(signoffs.filter((s) => s.release === release.id)).sort(newestFirst);
  const rows = [...stages].sort(byOrder).map((stage) => ({ stage, signoff: mine.find((s) => s.stage === stage.id) }));
  const cleared = (r: (typeof rows)[number]) => r.signoff?.outcome === 'passed' || r.signoff?.outcome === 'waived';
  const failed = rows.find((r) => r.signoff?.outcome === 'failed');
  const next = rows.find((r) => !cleared(r))?.stage;
  const status: ReleaseStatus = failed ? 'failed' : !next && rows.length ? 'live' : rows.some((r) => r.signoff) ? 'in-progress' : 'not-started';
  return { stages: rows, status, next, failedAt: failed?.stage };
}

const SIGNED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LINK = /^https?:\/\/\S+$/;

/** Why a sign-off can't be recorded as it is, or null. The database checks the same. */
export function signOffProblem(s: Pick<SignOff, 'outcome' | 'approver' | 'signedAt' | 'evidence' | 'stageName'>): string | null {
  if (!OUTCOMES.some((o) => o.id === s.outcome)) return `outcome "${s.outcome}" is not passed, failed or waived`;
  if (!s.approver?.trim()) return 'the approver is missing';
  if (!s.stageName?.trim()) return 'the stage name is missing';
  if (!SIGNED_AT.test(s.signedAt ?? '')) return `the time "${s.signedAt}" is not YYYY-MM-DDTHH:MM`;
  if (s.evidence && !LINK.test(s.evidence)) return 'the evidence is not a web link (http:// or https://)';
  return null;
}
