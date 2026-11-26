/**
 * The morning digest as an email: due today, overdue (if enabled), coming up and to chase, each
 * linking to the item. Pure, so api/reminders.ts and the tests share it. Email is digest-only by
 * design: one message a day, never one per item.
 */
import { attentionTasks, digestCounts, dueLabel, parseTime, taskUrl, type LocalNow, type TaskRef } from './reminders.js';
import type { SyncedState } from './state.js';

export interface DigestEmail {
  /** Once-per-day key, e.g. 'email-digest:2026-11-03'. */
  key: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * The email due at `now`, or null: emails must be on, the address valid, the digest time reached,
 * and there must be something to report. `appUrl` is the site origin used for task links.
 */
export function digestEmail(state: SyncedState, now: LocalNow, appUrl: string): DigestEmail | null {
  const settings = state.reminders;
  if (!settings.enabled || !settings.emailDigest || !isEmail(settings.email)) return null;
  if (now.minutes < parseTime(settings.digestTime)) return null;

  const { overdue, today, upcoming, chase } = attentionTasks(state, now.date);
  const late = settings.includeOverdue ? overdue : [];
  const counts = digestCounts({ today, overdue: late, upcoming, chase });
  if (!counts.length) return null;

  const multiWorkspace = state.workspaces.length > 1;
  const link = (r: TaskRef) => `${appUrl.replace(/\/$/, '')}/${taskUrl(r)}`;
  const sections: [string, TaskRef[]][] = [
    ['Due today', today],
    ['Overdue', late],
    ['Coming up', upcoming],
    ['To chase', chase],
  ];
  // In "To chase" the timing is the chase date's, and who it waits on comes first.
  const chasing = (r: TaskRef) => chase.includes(r);
  const where = (r: TaskRef) =>
    [chasing(r) ? r.task.waitingOn?.trim() : '', r.projectName, multiWorkspace ? r.workspace.name : ''].filter(Boolean).join(' · ');
  const timing = (r: TaskRef) => (chasing(r) ? `chase ${dueLabel(r.daysLeft)}` : dueLabel(r.daysLeft));

  const subject = `Ledger · ${counts.join(', ')}`;
  const key = `email-digest:${now.date}`;
  const to = settings.email.trim();

  if (settings.privateNotifications !== false) return privateDigest({ key, to, subject }, now, appUrl, sections);

  const text = [
    `Your Ledger digest for ${now.date}`,
    ...sections
      .filter(([, refs]) => refs.length)
      .map(([label, refs]) =>
        [`\n${label.toUpperCase()}`, ...refs.map((r) => `- ${r.task.title} (${[where(r), timing(r)].filter(Boolean).join(', ')})\n  ${link(r)}`)].join('\n'),
      ),
    `\nOpen Ledger: ${appUrl}\nYou get this because "Email me the daily digest" is on in Ledger's Settings.`,
  ].join('\n');

  const row = (r: TaskRef) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eeece6">` +
    `<a href="${esc(link(r))}" style="color:#1c1b19;text-decoration:none;font-weight:600">${esc(r.task.title)}</a>` +
    (where(r) ? `<div style="color:#8b8780;font-size:12px">${esc(where(r))}</div>` : '') +
    `</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #eeece6;text-align:right;white-space:nowrap;` +
    `font-family:monospace;font-size:12px;color:${r.daysLeft < 0 ? '#8f4a3c' : '#7a4a2f'}">${esc(timing(r))}</td></tr>`;

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1c1b19">` +
    `<h2 style="font-size:18px;margin:0 0 4px">Your Ledger digest</h2>` +
    `<div style="color:#8b8780;font-size:13px;margin-bottom:16px">${esc(now.date)} · ${esc(counts.join(', '))}</div>` +
    sections
      .filter(([, refs]) => refs.length)
      .map(
        ([label, refs]) =>
          `<div style="font-family:monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b8780;margin:16px 0 4px">${esc(label)}</div>` +
          `<table style="width:100%;border-collapse:collapse;font-size:14px">${refs.map(row).join('')}</table>`,
      )
      .join('') +
    `<p style="margin-top:20px"><a href="${esc(appUrl)}" style="background:#b4674a;color:#fffefb;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open Ledger</a></p>` +
    `<p style="color:#a5a099;font-size:11px">You get this because "Email me the daily digest" is on in Ledger's Settings.</p></div>`;

  return { key, to, subject, text, html };
}

const PRIVATE_NOTE = 'Task names are left out because "Private notifications" is on in Ledger\'s Settings.';

/**
 * Counts only: no task, project or workspace names, and no per-task links (their ids include
 * workspace names). The email still passes through the email service and sits in an inbox.
 */
function privateDigest(
  head: Pick<DigestEmail, 'key' | 'to' | 'subject'>,
  now: LocalNow,
  appUrl: string,
  sections: [string, TaskRef[]][],
): DigestEmail {
  const shown = sections.filter(([, refs]) => refs.length);
  const text = [
    `Your Ledger digest for ${now.date}`,
    '',
    ...shown.map(([label, refs]) => `${label}: ${refs.length}`),
    '',
    `Open Ledger: ${appUrl}`,
    PRIVATE_NOTE,
  ].join('\n');
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1c1b19">` +
    `<h2 style="font-size:18px;margin:0 0 4px">Your Ledger digest</h2>` +
    `<div style="color:#8b8780;font-size:13px;margin-bottom:16px">${esc(now.date)}</div>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    shown
      .map(
        ([label, refs]) =>
          `<tr><td style="padding:4px 16px 4px 0">${esc(label)}</td>` +
          `<td style="padding:4px 0;font-family:monospace;font-weight:600">${refs.length}</td></tr>`,
      )
      .join('') +
    `</table>` +
    `<p style="margin-top:20px"><a href="${esc(appUrl)}" style="background:#b4674a;color:#fffefb;padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open Ledger</a></p>` +
    `<p style="color:#a5a099;font-size:11px">${esc(PRIVATE_NOTE)}</p></div>`;
  return { ...head, text, html };
}
