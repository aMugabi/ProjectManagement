/**
 * The morning digest as an email: due today, overdue (if enabled) and coming up, each linking to
 * the task. Pure, so api/reminders.ts and the tests share it. Email is digest-only by design —
 * one message a day, never one per task.
 */
import { attentionTasks, dueLabel, parseTime, taskUrl, type LocalNow, type TaskRef } from './reminders.js';
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

  const { overdue, today, upcoming } = attentionTasks(state, now.date);
  const late = settings.includeOverdue ? overdue : [];
  if (!today.length && !late.length && !upcoming.length) return null;

  const multiWorkspace = state.workspaces.length > 1;
  const where = (r: TaskRef) => [r.projectName, multiWorkspace ? r.workspace.name : ''].filter(Boolean).join(' · ');
  const link = (r: TaskRef) => `${appUrl.replace(/\/$/, '')}/${taskUrl(r)}`;
  const sections: [string, TaskRef[]][] = [
    ['Due today', today],
    ['Overdue', late],
    ['Coming up', upcoming],
  ];

  const counts = [
    today.length && `${today.length} due today`,
    late.length && `${late.length} overdue`,
    upcoming.length && `${upcoming.length} coming up`,
  ].filter(Boolean);
  const subject = `Ledger · ${counts.join(', ')}`;

  const text = [
    `Your Ledger digest for ${now.date}`,
    ...sections
      .filter(([, refs]) => refs.length)
      .map(([label, refs]) =>
        [`\n${label.toUpperCase()}`, ...refs.map((r) => `- ${r.task.title} (${[where(r), dueLabel(r.daysLeft)].filter(Boolean).join(', ')})\n  ${link(r)}`)].join('\n'),
      ),
    `\nOpen Ledger: ${appUrl}\nYou get this because "Email me the daily digest" is on in Ledger's Settings.`,
  ].join('\n');

  const row = (r: TaskRef) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eeece6">` +
    `<a href="${esc(link(r))}" style="color:#1c1b19;text-decoration:none;font-weight:600">${esc(r.task.title)}</a>` +
    (where(r) ? `<div style="color:#8b8780;font-size:12px">${esc(where(r))}</div>` : '') +
    `</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #eeece6;text-align:right;white-space:nowrap;` +
    `font-family:monospace;font-size:12px;color:${r.daysLeft < 0 ? '#8f4a3c' : '#7a4a2f'}">${esc(dueLabel(r.daysLeft))}</td></tr>`;

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

  return { key: `email-digest:${now.date}`, to: settings.email.trim(), subject, text, html };
}
