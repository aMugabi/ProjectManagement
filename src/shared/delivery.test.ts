import { describe, expect, it } from 'vitest';
import type { SignOff } from '../types';
import { defaultStages, inForce, releaseProgress, signOffProblem } from './delivery';

const stages = defaultStages(1);
let n = 0;
const so = (stage: string, outcome: SignOff['outcome'], signedAt: string, extra: Partial<SignOff> = {}): SignOff => ({
  id: `s${++n}`, release: 'r1', stage, stageName: stage.toUpperCase(), outcome, approver: 'Jane', role: 'QA', signedAt, evidence: '', note: '', updatedAt: n, ...extra,
});

describe('delivery rules', () => {
  it('starts with SIT, UAT, UVT, InfoSec and Go-live', () => {
    expect(stages.map((s) => [s.id, s.name, s.order])).toEqual([['sit', 'SIT', 1], ['uat', 'UAT', 2], ['uvt', 'UVT', 3], ['infosec', 'InfoSec', 4], ['go-live', 'Go-live', 5]]);
  });

  it('a correction replaces the sign-off it names, and only that one', () => {
    const wrong = so('sit', 'failed', '2026-11-20T10:00');
    const other = so('uat', 'passed', '2026-11-21T10:00');
    const fix = so('sit', 'passed', '2026-11-20T10:00', { corrects: wrong.id });
    expect(inForce([wrong, other, fix]).map((s) => s.id)).toEqual([other.id, fix.id]);
  });

  it('follows a release through its stages: not started, in progress, failed, then live', () => {
    const r = { id: 'r1' };
    expect(releaseProgress(r, stages, []).status).toBe('not-started');
    const sit = so('sit', 'passed', '2026-11-20T10:00');
    expect(releaseProgress(r, stages, [sit])).toMatchObject({ status: 'in-progress', next: { id: 'uat' } });
    const uatFail = so('uat', 'failed', '2026-11-21T10:00');
    expect(releaseProgress(r, stages, [sit, uatFail])).toMatchObject({ status: 'failed', failedAt: { id: 'uat' }, next: { id: 'uat' } });
    const uatPass = so('uat', 'passed', '2026-11-22T10:00'); // a retest: the newest counts, the failure stays on record
    const rest = ['uvt', 'infosec'].map((s) => so(s, 'passed', '2026-11-23T10:00'));
    const waived = so('go-live', 'waived', '2026-11-24T10:00');
    const done = releaseProgress(r, stages, [sit, uatFail, uatPass, ...rest, waived]);
    expect(done.status).toBe('live');
    expect(done.next).toBeUndefined();
    expect(done.stages[1].signoff?.id).toBe(uatPass.id);
  });

  it("ignores other releases' sign-offs", () => {
    expect(releaseProgress({ id: 'r2' }, stages, [so('sit', 'failed', '2026-11-20T10:00')]).status).toBe('not-started');
  });

  it('checks what the database checks', () => {
    const good = { outcome: 'passed' as const, approver: 'Jane', signedAt: '2026-11-25T14:30', evidence: 'https://bank.example/x', stageName: 'UAT' };
    expect(signOffProblem(good)).toBeNull();
    expect(signOffProblem({ ...good, evidence: '' })).toBeNull();
    expect(signOffProblem({ ...good, outcome: 'maybe' as never })).toMatch(/outcome/);
    expect(signOffProblem({ ...good, approver: ' ' })).toMatch(/approver/);
    expect(signOffProblem({ ...good, signedAt: '2026-11-25' })).toMatch(/YYYY-MM-DDTHH:MM/);
    expect(signOffProblem({ ...good, evidence: 'javascript:alert(1)' })).toMatch(/web link/);
    expect(signOffProblem({ ...good, stageName: '' })).toMatch(/stage name/);
  });
});
