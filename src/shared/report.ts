/**
 * The weekly report (build plan Step 4) for one product, partner or project, or the whole
 * workspace: what was finished, risks and issues that moved, decisions made, sign-offs, what is
 * waiting on someone, what is overdue, and what is due next week. Built from the synced document,
 * so it works on today's store and on Postgres alike. Pure: the screen, the copy-ready email text
 * and the CSV all come from one WeeklyReport.
 */
import type { ItemType, SignOff, Task, WorkspaceSnapshot } from '../types.js';
import { ITEM_TYPES, isDone, typeOf } from './itemTypes.js';
import { inForce } from './delivery.js';
import { addDaysIso, isWaiting } from './followUp.js';

export type ScopeKind = 'all' | 'product' | 'partner' | 'project';
export interface ReportScope {
  kind: ScopeKind;
  id?: string;
}

export interface ReportRow {
  title: string;
  /** Where it belongs: a project, or product · partner. */
  home: string;
  type: string;
  status: string;
  /** ISO date the row is about (finished, changed, signed, due). */
  date: string;
  detail: string;
}

export type SectionKey = 'done' | 'risks' | 'decisions' | 'signoffs' | 'waiting' | 'overdue' | 'next';
export interface ReportSection {
  key: SectionKey;
  title: string;
  rows: ReportRow[];
}

export interface WeeklyReport {
  scopeName: string;
  /** Monday and Sunday of the week (ISO dates). */
  from: string;
  to: string;
  sections: ReportSection[];
}

/** The Monday that starts the week holding `iso`. */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysIso(iso, -((weekday + 6) % 7));
}

const statusLabel = (t: Pick<Task, 'type' | 'status'>) => ITEM_TYPES[typeOf(t)].statuses.find((s) => s.id === t.status)?.label ?? t.status;

/** The type's own fields, as 'Likelihood: high · Mitigation: second line'. */
function fieldsText(t: Task): string {
  return ITEM_TYPES[typeOf(t)].fields
    .map((f) => [f.label, t.details?.[f.key]] as const)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([label, v]) => `${label}: ${String(v)}`)
    .join(' · ');
}

/**
 * @param dayOf the local calendar day of a time in ms (the report compares days in the user's zone)
 */
export function weeklyReport(snap: WorkspaceSnapshot, scope: ReportScope, monday: string, todayIso: string, dayOf: (ms: number) => string): WeeklyReport {
  const from = monday;
  const to = addDaysIso(monday, 6);
  const inWeek = (iso: string | undefined) => Boolean(iso) && iso! >= from && iso! <= to;
  const name = (list: { id: string; name: string }[], id: string | undefined) => (id ? (list.find((g) => g.id === id)?.name ?? id) : '');
  const home = (x: { project?: string; product?: string; partner?: string }) =>
    x.project ? name(snap.projects, x.project) : [name(snap.products, x.product), name(snap.partners, x.partner)].filter(Boolean).join(' · ');
  const inScope = (x: { project?: string; product?: string; partner?: string }) =>
    scope.kind === 'all' || (x as Record<string, string | undefined>)[scope.kind] === scope.id;

  const items = snap.tasks.filter(inScope);
  const open = items.filter((t) => !isDone(t));
  const row = (t: Task, date: string, detail = fieldsText(t)): ReportRow => ({
    title: t.title, home: home(t), type: ITEM_TYPES[typeOf(t)].label, status: statusLabel(t), date, detail,
  });
  const byDate = (a: ReportRow, b: ReportRow) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
  const ofTypes = (...types: ItemType[]) => (t: Task) => types.includes(typeOf(t));

  const done: ReportRow[] = [
    // Decisions have their own section.
    ...items.filter((t) => !t.recurring && isDone(t) && typeOf(t) !== 'decision' && inWeek(t.completedOn)).map((t) => row(t, t.completedOn!, '')),
    ...items.flatMap((t) => (t.completions ?? []).filter(inWeek).map((d) => row(t, d, 'recurring: one occurrence'))),
  ];
  const risks = items.filter(ofTypes('risk', 'issue')).filter((t) => inWeek(dayOf(t.updatedAt))).map((t) => row(t, dayOf(t.updatedAt)));
  const decisions = items.filter(ofTypes('decision')).filter((t) => isDone(t) && inWeek(t.completedOn)).map((t) => row(t, t.completedOn!));

  const releases = new Map(snap.releases.map((r) => [r.id, r]));
  const live = new Set(inForce(snap.signoffs).map((s) => s.id));
  const signoffs = snap.signoffs
    .filter((s) => inWeek(s.signedAt.slice(0, 10)))
    .filter((s) => {
      const r = releases.get(s.release);
      return r ? inScope(r) : scope.kind === 'all';
    })
    .map((s: SignOff): ReportRow => {
      const r = releases.get(s.release);
      const notes = [s.corrects ? 'a correction' : '', live.has(s.id) ? '' : 'since corrected'].filter(Boolean).join(', ');
      return {
        title: `${r?.name ?? 'Release'} · ${s.stageName}`,
        home: r ? home(r) : '',
        type: 'Sign-off',
        status: s.outcome[0].toUpperCase() + s.outcome.slice(1),
        date: s.signedAt.slice(0, 10),
        detail: [`${s.approver}${s.role ? `, ${s.role}` : ''}`, notes, s.evidence].filter(Boolean).join(' · '),
      };
    });

  const waiting = open.filter(isWaiting).map((t) => row(t, t.chaseOn ?? '', `waiting on ${t.waitingOn!.trim()}${t.chaseOn ? `, chase ${t.chaseOn}` : ''}`));
  const overdue = open.filter((t) => t.dueDate < todayIso).map((t) => row(t, t.dueDate, ''));
  const nextFrom = addDaysIso(to, 1);
  const nextTo = addDaysIso(to, 7);
  const next = open.filter((t) => t.dueDate >= nextFrom && t.dueDate <= nextTo).map((t) => row(t, t.dueDate, ''));

  const scopeName =
    scope.kind === 'all'
      ? 'All items'
      : `${scope.kind === 'project' ? name(snap.projects, scope.id) : scope.kind === 'product' ? name(snap.products, scope.id) : name(snap.partners, scope.id)} (${scope.kind})`;
  const sections: ReportSection[] = [
    { key: 'done', title: 'Done', rows: done.sort(byDate) },
    { key: 'risks', title: 'Risks and issues that changed', rows: risks.sort(byDate) },
    { key: 'decisions', title: 'Decisions made', rows: decisions.sort(byDate) },
    { key: 'signoffs', title: 'Sign-offs', rows: signoffs.sort(byDate) },
    { key: 'waiting', title: 'Waiting on others', rows: waiting.sort(byDate) },
    { key: 'overdue', title: 'Overdue', rows: overdue.sort(byDate) },
    { key: 'next', title: 'Due next week', rows: next.sort(byDate) },
  ];
  return { scopeName, from, to, sections };
}

/** The report as plain text, ready to paste into an email. */
export function reportText(r: WeeklyReport): string {
  const lines = [`Weekly report: ${r.scopeName}, ${r.from} to ${r.to}`];
  for (const s of r.sections) {
    lines.push('', `${s.title.toUpperCase()} (${s.rows.length})`);
    if (!s.rows.length) lines.push('- nothing');
    for (const x of s.rows) {
      const facts = [x.home, x.type !== 'Task' ? x.type : '', x.status, x.date].filter(Boolean).join(' · ');
      lines.push(`- ${x.title} (${facts})${x.detail ? `\n  ${x.detail}` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * One CSV cell: quoted when needed, and a leading =, +, - or @ neutralised so a spreadsheet never
 * runs it as a formula (CSV injection).
 */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The report as CSV: one row per line of every section. */
export function reportCsv(r: WeeklyReport): string {
  const head = ['section', 'title', 'belongs to', 'type', 'status', 'date', 'detail'];
  const rows = r.sections.flatMap((s) => s.rows.map((x) => [s.title, x.title, x.home, x.type, x.status, x.date, x.detail]));
  return [head, ...rows].map((cols) => cols.map(cell).join(',')).join('\r\n') + '\r\n';
}
