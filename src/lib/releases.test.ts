import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../shared/state';
import { addRelease, addSignOff, addStage, deleteRelease, deleteStage, moveStage, releasesOf, renameStage, updateRelease, withStages } from './releases';

const base = {
  ...emptySnapshot(),
  products: [{ id: 'loans', name: 'Loans', color: '#111111', updatedAt: 1 }],
  partners: [{ id: 'telco', name: 'Telco', color: '#222222', updatedAt: 1 }],
};
const input = { stage: 'uat', outcome: 'passed' as const, approver: 'Jane Okello', role: 'Head of QA', signedAt: '2026-11-25T14:30', evidence: 'https://bank.example/uat', note: '' };

describe('releases and sign-offs', () => {
  it('a first release brings the default stages and the pair', () => {
    const { snap, id } = addRelease(base, { product: 'loans', partner: 'telco', name: ' v1 ', targetDate: '2026-12-15' }, 50);
    expect(snap.stages.map((s) => s.id)).toEqual(['sit', 'uat', 'uvt', 'infosec', 'go-live']);
    expect(snap.pairs.map((p) => p.id)).toEqual(['loans+telco']);
    expect(snap.releases).toEqual([{ id, product: 'loans', partner: 'telco', name: 'v1', targetDate: '2026-12-15', updatedAt: 50 }]);
    expect(withStages(snap, 60).stages).toBe(snap.stages); // never added twice
  });

  it('records a sign-off with the stage name it had, and refuses what the database would', () => {
    const { snap, id: release } = addRelease(base, { product: 'loans', partner: 'telco', name: 'v1' }, 50);
    const done = addSignOff(snap, { ...input, release }, 60, 'so-1');
    if ('problem' in done) throw new Error(done.problem);
    expect(done.snap.signoffs).toEqual([{ id: 'so-1', release, stage: 'uat', stageName: 'UAT', outcome: 'passed', approver: 'Jane Okello', role: 'Head of QA', signedAt: '2026-11-25T14:30', evidence: 'https://bank.example/uat', note: '', updatedAt: 60 }]);
    expect(addSignOff(snap, { ...input, release, evidence: 'file:///c/x.pdf' }, 60)).toEqual({ problem: 'the evidence is not a web link (http:// or https://)' });
    expect(addSignOff(snap, { ...input, release, stage: 'nope' }, 60)).toEqual({ problem: 'that stage is not in the template' });
    expect(addSignOff(snap, { ...input, release: 'nope' }, 60)).toEqual({ problem: 'that release does not exist' });
    expect(addSignOff(done.snap, { ...input, release, corrects: 'other' }, 70)).toEqual({ problem: 'the sign-off to correct is not on this release' });
    const fix = addSignOff(done.snap, { ...input, release, outcome: 'failed', corrects: 'so-1' }, 70, 'so-2');
    expect('snap' in fix && fix.snap.signoffs.map((s) => [s.id, s.corrects])).toEqual([['so-1', undefined], ['so-2', 'so-1']]);
  });

  it('keeps what sign-offs name: their release, stage, product and partner', () => {
    const { snap, id: release } = addRelease(base, { product: 'loans', partner: 'telco', name: 'v1' }, 50);
    expect(deleteRelease(snap, release, 'bank', 70)).toEqual({ snap: { ...snap, releases: [] }, deleted: { [`release:bank:${release}`]: 70 } });
    const signed = addSignOff(snap, { ...input, release }, 60);
    if ('problem' in signed) throw new Error(signed.problem);
    expect(deleteRelease(signed.snap, release, 'bank', 70)).toBeNull();
    expect(deleteStage(signed.snap, 'uat', 'bank', 70)).toBeNull();
    expect(deleteStage(signed.snap, 'sit', 'bank', 70)?.deleted).toEqual({ 'stage:bank:sit': 70 });
    expect([releasesOf(snap, 'product', 'loans'), releasesOf(snap, 'partner', 'telco'), releasesOf(snap, 'partner', 'other')]).toEqual([1, 1, 0]);
  });

  it('edits the template: add, rename and move stages', () => {
    let snap = addStage(base, 'Pen test', 10); // brings the defaults first
    expect(snap.stages.map((s) => [s.id, s.order])).toEqual([['sit', 1], ['uat', 2], ['uvt', 3], ['infosec', 4], ['go-live', 5], ['pen-test', 6]]);
    snap = renameStage(snap, 'pen-test', 'Penetration test', 11);
    snap = moveStage(snap, 'pen-test', -1, 12);
    const order = [...snap.stages].sort((a, b) => a.order - b.order).map((s) => s.name);
    expect(order).toEqual(['SIT', 'UAT', 'UVT', 'InfoSec', 'Penetration test', 'Go-live']);
    expect(moveStage(snap, 'sit', -1, 13)).toBe(snap); // already first
  });

  it('updates a release name and target date, and clears the date', () => {
    const { snap, id } = addRelease(base, { product: 'loans', partner: 'telco', name: 'v1', targetDate: '2026-12-15' }, 50);
    const next = updateRelease(snap, id, { name: 'v1.1', targetDate: '' }, 60);
    expect(next.releases[0]).toEqual({ id, product: 'loans', partner: 'telco', name: 'v1.1', updatedAt: 60 });
  });
});
