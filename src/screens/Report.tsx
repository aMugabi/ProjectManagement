/**
 * The weekly report (build plan Step 4) for a product, partner or project, or everything: shown
 * here, and exported as copy-ready email text or as CSV. What leaves the app is the owner's
 * choice: nothing is sent anywhere.
 */
import { useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { activeSnapshot } from '../shared/state';
import { dateToIso, isoToDate, today } from '../shared/date';
import { addDaysIso } from '../shared/followUp';
import { reportCsv, reportText, weekStart, weeklyReport, type ReportScope, type ScopeKind } from '../shared/report';
import s from './Report.module.css';

function parseScope(value: string): ReportScope {
  if (value === 'all') return { kind: 'all' };
  const [kind, ...rest] = value.split(':');
  return { kind: kind as ScopeKind, id: rest.join(':') };
}

export function Report() {
  const store = useTaskStore();
  const todayIso = dateToIso(today());
  const [scopeValue, setScopeValue] = useState('all');
  const [monday, setMonday] = useState(() => weekStart(todayIso));
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);

  const report = weeklyReport(activeSnapshot(store), parseScope(scopeValue), monday, todayIso, (ms) => dateToIso(new Date(ms)));
  const day = (iso: string) => isoToDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const range = `${day(report.from)} – ${day(report.to)} ${report.to.slice(0, 4)}`;
  const text = reportText(report);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      setCopied('failed'); // the text is shown below to copy by hand
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-report-${scopeValue.replace(/[^a-z0-9]+/gi, '-')}-${report.from}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const groups: [string, string, { id: string; name: string }[]][] = [
    ['Products', 'product', store.products],
    ['Partners', 'partner', store.partners],
    ['Projects', 'project', store.projects],
  ];

  return (
    <div className={s.page}>
      <div className={`${s.card} ${s.controls}`}>
        <select className={s.input} aria-label="Report on" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
          <option value="all">All items</option>
          {groups.map(
            ([label, kind, list]) =>
              list.length > 0 && (
                <optgroup key={kind} label={label}>
                  {list.map((g) => (
                    <option key={g.id} value={`${kind}:${g.id}`}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
        </select>
        <span className={s.week}>
          <button type="button" className={s.secondary} aria-label="Previous week" onClick={() => setMonday(addDaysIso(monday, -7))}>
            ←
          </button>
          <span className={s.range} aria-label="Week">
            {range}
          </span>
          <button type="button" className={s.secondary} aria-label="Next week" onClick={() => setMonday(addDaysIso(monday, 7))}>
            →
          </button>
          {monday !== weekStart(todayIso) && (
            <button type="button" className={s.secondary} onClick={() => setMonday(weekStart(todayIso))}>
              This week
            </button>
          )}
        </span>
        <span className={s.exports}>
          <button type="button" className={s.button} onClick={() => void copy()}>
            Copy as email text
          </button>
          <button type="button" className={s.secondary} onClick={download}>
            Download CSV
          </button>
        </span>
        {copied === 'copied' && (
          <span className={s.muted} role="status">
            Copied: paste it into an email.
          </span>
        )}
      </div>

      {copied === 'failed' && (
        <div className={s.card}>
          <p className={s.muted}>This browser didn't allow copying. Select the text below and copy it.</p>
          <textarea className={s.text} readOnly value={text} rows={12} aria-label="Report text" onFocus={(e) => e.target.select()} />
        </div>
      )}

      {report.sections.map((section) => (
        <section key={section.key} className={s.card} aria-label={section.title}>
          <h2 className={s.heading}>
            {section.title}
            <span className={s.count}>{section.rows.length}</span>
          </h2>
          {section.rows.length === 0 ? (
            <p className={s.muted}>Nothing.</p>
          ) : (
            <table className={s.table}>
              <tbody>
                {section.rows.map((row, i) => (
                  <tr key={`${row.title}-${row.date}-${i}`}>
                    <td className={s.title}>
                      {row.title}
                      {row.detail && <div className={s.muted}>{row.detail}</div>}
                    </td>
                    <td className={s.muted}>{row.home}</td>
                    <td className={s.muted}>{row.type === 'Task' ? '' : row.type}</td>
                    <td>{row.status}</td>
                    <td className={s.date}>{row.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
