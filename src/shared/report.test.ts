import { describe, expect, it } from 'vitest';
import type { SignOff, Task } from '../types';
import { emptySnapshot } from './state';
import { reportCsv, reportText, weekStart, weeklyReport } from './report';

const MONDAY = '2026-11-23';
const TODAY = '2026-11-27';
// Times in ms are read as UTC days here; the app passes the device's own day.
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

function item(id: string, extra: Partial<Task> = {}): Task {
  return { id, project: '', product: 'loans', title: id, status: 'todo', priority: 'med', dueDate: '2026-12-31', subs: [], recurring: null, deps: [], notes: '', order: 0, updatedAt: at('2026-11-01'), ...extra };
}
const signoff = (id: string, extra: Partial<SignOff> = {}): SignOff => ({
  id, release: 'rel-1', stage: 'uat', stageName: 'UAT', outcome: 'passed', approver: 'Jane Okello', role: 'Head of QA', signedAt: '2026-11-25T14:30', evidence: 'https://bank.example/uat', note: '', updatedAt: 1, ...extra,
});

const snap = {
  ...emptySnapshot(),
  products: [{ id: 'loans', name: 'Loans', color: '#000000', updatedAt: 1 }, { id: 'cards', name: 'Cards', color: '#000000', updatedAt: 1 }],
  partners: [{ id: 'telco', name: 'Telco', color: '#000000', updatedAt: 1 }],
  releases: [{ id: 'rel-1', product: 'loans', partner: 'telco', name: 'Loans v2', updatedAt: 1 }],
  tasks: [
    item('finished', { status: 'done', completedOn: '2026-11-24' }),
    item('finished-last-week', { status: 'done', completedOn: '2026-11-20' }),
    item('weekly-report', { recurring: 'weekly', completions: ['2026-11-16', '2026-11-23'] }),
    item('risk-moved', { type: 'risk', status: 'mitigating', details: { likelihood: 'high', mitigation: 'Second line' }, updatedAt: at('2026-11-26') }),
    item('risk-quiet', { type: 'risk', status: 'open' }),
    item('decided', { type: 'decision', status: 'decided', completedOn: '2026-11-25', details: { decidedBy: 'Committee' } }),
    item('waiting', { waitingOn: 'Telco IT', chaseOn: '2026-11-28' }),
    item('late', { dueDate: '2026-11-20' }),
    item('next-week', { dueDate: '2026-12-02' }),
    item('other-product', { product: 'cards', status: 'done', completedOn: '2026-11-24' }),
  ],
  signoffs: [signoff('so-1', { outcome: 'failed' }), signoff('so-2', { corrects: 'so-1' }), signoff('so-old', { signedAt: '2026-11-10T09:00' })],
};

describe('weekly report', () => {
  it('weeks start on Monday', () => {
    expect([weekStart('2026-11-23'), weekStart('2026-11-27'), weekStart('2026-11-29'), weekStart('2026-12-01')]).toEqual(['2026-11-23', '2026-11-23', '2026-11-23', '2026-11-30']);
  });

  it("covers a product's week: done, risks, decisions, sign-offs, waiting, overdue and next week", () => {
    const r = weeklyReport(snap, { kind: 'product', id: 'loans' }, MONDAY, TODAY, dayOf);
    expect([r.scopeName, r.from, r.to]).toEqual(['Loans (product)', '2026-11-23', '2026-11-29']);
    const ids = Object.fromEntries(r.sections.map((s) => [s.key, s.rows.map((x) => x.title)]));
    expect(ids).toEqual({
      done: ['weekly-report', 'finished'],
      risks: ['risk-moved'],
      decisions: ['decided'],
      signoffs: ['Loans v2 · UAT', 'Loans v2 · UAT'],
      waiting: ['waiting'],
      overdue: ['late'],
      next: ['next-week'],
    });
    const risk = r.sections.find((s) => s.key === 'risks')!.rows[0];
    expect(risk).toEqual({ title: 'risk-moved', home: 'Loans', type: 'Risk', status: 'Mitigating', date: '2026-11-26', detail: 'Likelihood: high · Mitigation: Second line' });
    const signed = r.sections.find((s) => s.key === 'signoffs')!.rows;
    expect(signed.map((x) => [x.status, x.detail])).toEqual([
      ['Failed', 'Jane Okello, Head of QA · since corrected · https://bank.example/uat'],
      ['Passed', 'Jane Okello, Head of QA · a correction · https://bank.example/uat'],
    ]);
    expect(r.sections.find((s) => s.key === 'waiting')!.rows[0].detail).toBe('waiting on Telco IT, chase 2026-11-28');
  });

  it("keeps to its scope: a partner's report has the release's sign-offs, not other products' items", () => {
    const telco = weeklyReport(snap, { kind: 'partner', id: 'telco' }, MONDAY, TODAY, dayOf);
    expect(telco.sections.find((s) => s.key === 'signoffs')!.rows).toHaveLength(2);
    expect(telco.sections.find((s) => s.key === 'done')!.rows).toEqual([]);
    const all = weeklyReport(snap, { kind: 'all' }, MONDAY, TODAY, dayOf);
    expect(all.sections.find((s) => s.key === 'done')!.rows.map((x) => x.title)).toEqual(['weekly-report', 'finished', 'other-product']);
  });

  it('reads as email text, with every section even when empty', () => {
    const text = reportText(weeklyReport(snap, { kind: 'partner', id: 'telco' }, MONDAY, TODAY, dayOf));
    expect(text.split('\n').slice(0, 4)).toEqual(['Weekly report: Telco (partner), 2026-11-23 to 2026-11-29', '', 'DONE (0)', '- nothing']);
    expect(text).toContain('SIGN-OFFS (2)\n- Loans v2 · UAT (Loans · Telco · Sign-off · Failed · 2026-11-25)\n  Jane Okello, Head of QA · since corrected');
  });

  it('exports CSV that a spreadsheet reads safely', () => {
    const r = weeklyReport(
      { ...snap, tasks: [item('=HYPERLINK("http://x")', { status: 'done', completedOn: '2026-11-24' }), item('Plan, "phase 2"', { status: 'done', completedOn: '2026-11-25' })] },
      { kind: 'all' },
      MONDAY,
      TODAY,
      dayOf,
    );
    const lines = reportCsv(r).split('\r\n');
    expect(lines[0]).toBe('section,title,belongs to,type,status,date,detail');
    expect(lines[1]).toBe(`Done,"'=HYPERLINK(""http://x"")",Loans,Task,Done,2026-11-24,`);
    expect(lines[2]).toBe('Done,"Plan, ""phase 2""",Loans,Task,Done,2026-11-25,');
  });
});
