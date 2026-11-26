/**
 * Delivery tracking (build plan Step 3): releases of each product with a partner, their progress
 * through the workspace's stage template, and the sign-offs that move them on. Sign-offs are
 * records: a mistake is fixed with a correction (a new sign-off naming the old one), and the
 * history shows both. Evidence is a link to the bank's own systems; nothing is uploaded.
 */
import { useState } from 'react';
import type { Release, SignOff, SignOffOutcome, Stage } from '../types';
import { useTaskStore } from '../store/taskStore';
import { byOrder, inForce, newestFirst, OUTCOMES, releaseProgress, type ReleaseProgress } from '../shared/delivery';
import { formatShortDate, isoToDate } from '../shared/date';
import s from './Releases.module.css';

const OUTCOME_MARK: Record<SignOffOutcome, string> = { passed: '✓', failed: '✗', waived: '~' };

/** The device's local date and time as 'YYYY-MM-DDTHH:MM' (what a datetime-local input holds). */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const when = (signedAt: string) => signedAt.replace('T', ' ');

function statusText(p: ReleaseProgress): string {
  if (p.status === 'live') return 'Live';
  if (p.status === 'failed') return `Failed at ${p.failedAt!.name}`;
  if (p.status === 'not-started') return 'Not started';
  return `Next: ${p.next!.name}`;
}

export function Releases() {
  const { products, partners, releases, stages, signoffs } = useTaskStore();
  const [adding, setAdding] = useState(false);
  const name = (list: { id: string; name: string }[], id: string) => list.find((g) => g.id === id)?.name ?? id;

  // One group per product and partner, in name order.
  const groups = new Map<string, { title: string; releases: Release[] }>();
  for (const r of [...releases].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `${r.product}+${r.partner}`;
    const group = groups.get(key) ?? { title: `${name(products, r.product)} · ${name(partners, r.partner)}`, releases: [] };
    group.releases.push(r);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className={s.page}>
      <div className={s.card}>
        {adding ? (
          <NewRelease done={() => setAdding(false)} />
        ) : (
          <button type="button" className={s.button} onClick={() => setAdding(true)}>
            + New release
          </button>
        )}
        {!releases.length && !adding && (
          <p className={s.note}>
            A release belongs to a product and a partner. Each one moves through the stages below, one sign-off at a time, with
            the approver, the time and a link to the evidence.
          </p>
        )}
      </div>

      {sorted.map((g) => (
        <section key={g.title} className={s.card} aria-label={g.title}>
          <h2 className={s.heading}>{g.title}</h2>
          {g.releases.map((r) => (
            <ReleaseCard key={r.id} release={r} stages={stages} signoffs={signoffs} />
          ))}
        </section>
      ))}

      <StageTemplate />
    </div>
  );
}

function NewRelease({ done }: { done: () => void }) {
  const { products, partners, addRelease } = useTaskStore();
  const [product, setProduct] = useState(products[0]?.id ?? '');
  const [partner, setPartner] = useState(partners[0]?.id ?? '');
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');

  if (!products.length || !partners.length) {
    return (
      <div className={s.formRow}>
        <span className={s.note}>Add a product and a partner in the sidebar first: a release is for the two together.</span>
        <button type="button" className={s.secondary} onClick={done}>
          Close
        </button>
      </div>
    );
  }
  return (
    <form
      className={s.formRow}
      aria-label="New release"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        addRelease({ product, partner, name, targetDate: target || undefined });
        done();
      }}
    >
      <select className={s.input} aria-label="Product" value={product} onChange={(e) => setProduct(e.target.value)}>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select className={s.input} aria-label="Partner" value={partner} onChange={(e) => setPartner(e.target.value)}>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input className={s.input} aria-label="Release name" placeholder="Release name, e.g. v2.3" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input className={s.input} type="date" aria-label="Target date" value={target} onChange={(e) => setTarget(e.target.value)} />
      <button type="submit" className={s.button} disabled={!name.trim()}>
        Add release
      </button>
      <button type="button" className={s.secondary} onClick={done}>
        Cancel
      </button>
    </form>
  );
}

function ReleaseCard({ release, stages, signoffs }: { release: Release; stages: Stage[]; signoffs: SignOff[] }) {
  const { updateRelease, deleteRelease } = useTaskStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ stage: string; corrects?: SignOff } | null>(null);
  const progress = releaseProgress(release, stages, signoffs);
  const mine = signoffs.filter((x) => x.release === release.id);
  const history = [...mine].sort(newestFirst);
  const live = new Set(inForce(mine).map((x) => x.id));
  const correctedBy = new Map(mine.filter((x) => x.corrects).map((x) => [x.corrects!, x]));

  return (
    <div className={s.release}>
      <button type="button" className={s.releaseHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={s.releaseName}>{release.name}</span>
        {release.targetDate && <span className={s.muted}>target {formatShortDate(isoToDate(release.targetDate))}</span>}
        <span className={`${s.status} ${s[progress.status]}`}>{statusText(progress)}</span>
      </button>
      <div className={s.strip} aria-label={`Stages of ${release.name}`}>
        {progress.stages.map(({ stage, signoff }) => (
          <span
            key={stage.id}
            className={`${s.cell} ${signoff ? s[signoff.outcome] : ''}`}
            title={signoff ? `${signoff.outcome} · ${signoff.approver} · ${when(signoff.signedAt)}` : 'not signed off'}
          >
            {signoff ? OUTCOME_MARK[signoff.outcome] : '·'} {stage.name}
          </span>
        ))}
      </div>

      {open && (
        <div className={s.detail}>
          <div className={s.formRow}>
            <input
              className={s.input}
              aria-label={`Name of ${release.name}`}
              defaultValue={release.name}
              onBlur={(e) => e.target.value.trim() !== release.name && updateRelease(release.id, { name: e.target.value })}
            />
            <input
              className={s.input}
              type="date"
              aria-label={`Target date of ${release.name}`}
              value={release.targetDate ?? ''}
              onChange={(e) => updateRelease(release.id, { targetDate: e.target.value })}
            />
            {mine.length === 0 && (
              <button
                type="button"
                className={s.secondary}
                onClick={() => window.confirm(`Delete release "${release.name}"?`) && deleteRelease(release.id)}
              >
                Delete release
              </button>
            )}
          </div>

          <table className={s.table}>
            <tbody>
              {progress.stages.map(({ stage, signoff }) => (
                <tr key={stage.id}>
                  <td className={s.stageName}>{stage.name}</td>
                  <td>{signoff ? <Outcome so={signoff} /> : <span className={s.muted}>Not signed off</span>}</td>
                  <td className={s.right}>
                    <button
                      type="button"
                      className={s.secondary}
                      aria-label={`Sign off ${stage.name} for ${release.name}`}
                      onClick={() => setForm({ stage: stage.id })}
                    >
                      Sign off
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {form && (
            <SignOffForm
              release={release}
              stages={stages}
              stage={form.stage}
              corrects={form.corrects}
              done={() => setForm(null)}
            />
          )}

          {history.length > 0 && (
            <div className={s.history} aria-label={`History of ${release.name}`}>
              <div className={s.label}>History</div>
              {history.map((so) => (
                <div key={so.id} className={`${s.entry} ${live.has(so.id) ? '' : s.corrected}`}>
                  <div>
                    <strong>{so.stageName}</strong> <Outcome so={so} />
                    {so.corrects && <span className={s.muted}> · corrects an earlier entry</span>}
                    {!live.has(so.id) && <span className={s.muted}> · corrected by {correctedBy.get(so.id)?.approver ?? 'a later entry'}</span>}
                  </div>
                  {so.note && <div className={s.muted}>{so.note}</div>}
                  {live.has(so.id) && (
                    <button
                      type="button"
                      className={s.link}
                      aria-label={`Correct sign-off by ${so.approver} on ${so.stageName}`}
                      onClick={() => setForm({ stage: so.stage, corrects: so })}
                    >
                      Correct
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Outcome({ so }: { so: SignOff }) {
  return (
    <span>
      <span className={`${s.badge} ${s[so.outcome]}`}>{OUTCOMES.find((o) => o.id === so.outcome)?.label}</span>{' '}
      {so.approver}
      {so.role && <span className={s.muted}>, {so.role}</span>}
      <span className={s.muted}> · {when(so.signedAt)}</span>
      {so.evidence && (
        <>
          {' · '}
          <a href={so.evidence} target="_blank" rel="noopener noreferrer">
            evidence
          </a>
        </>
      )}
    </span>
  );
}

function SignOffForm({ release, stages, stage, corrects, done }: { release: Release; stages: Stage[]; stage: string; corrects?: SignOff; done: () => void }) {
  const signOff = useTaskStore((st) => st.signOff);
  const [fields, setFields] = useState({
    stage,
    outcome: (corrects?.outcome ?? 'passed') as SignOffOutcome,
    approver: corrects?.approver ?? '',
    role: corrects?.role ?? '',
    signedAt: corrects?.signedAt ?? localNow(),
    evidence: corrects?.evidence ?? '',
    note: '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<typeof fields>) => setFields((f) => ({ ...f, ...patch }));

  return (
    <form
      className={s.signForm}
      aria-label="Sign-off"
      onSubmit={(e) => {
        e.preventDefault();
        const why = signOff({ ...fields, release: release.id, corrects: corrects?.id });
        if (why) setProblem(why);
        else done();
      }}
    >
      <div className={s.label}>{corrects ? `Correcting ${corrects.approver}'s ${corrects.stageName} sign-off` : `Sign off ${release.name}`}</div>
      <div className={s.formGrid}>
        <label>
          Stage
          <select className={s.input} value={fields.stage} disabled={Boolean(corrects)} onChange={(e) => set({ stage: e.target.value })}>
            {[...stages].sort(byOrder).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Outcome
          <select className={s.input} value={fields.outcome} onChange={(e) => set({ outcome: e.target.value as SignOffOutcome })}>
            {OUTCOMES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Approver
          <input className={s.input} value={fields.approver} onChange={(e) => set({ approver: e.target.value })} placeholder="Full name" />
        </label>
        <label>
          Role
          <input className={s.input} value={fields.role} onChange={(e) => set({ role: e.target.value })} placeholder="e.g. Head of QA" />
        </label>
        <label>
          Signed at
          <input className={s.input} type="datetime-local" value={fields.signedAt} onChange={(e) => set({ signedAt: e.target.value })} />
        </label>
        <label>
          Evidence link
          <input className={s.input} type="url" value={fields.evidence} onChange={(e) => set({ evidence: e.target.value })} placeholder="https://…" />
        </label>
        <label className={s.wide}>
          Note
          <input
            className={s.input}
            value={fields.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder={corrects ? 'What was wrong with the earlier entry' : 'Optional'}
          />
        </label>
      </div>
      {problem && (
        <p className={s.problem} role="alert">
          Not recorded: {problem}.
        </p>
      )}
      <div className={s.formRow}>
        <button type="submit" className={s.button}>
          {corrects ? 'Record correction' : 'Record sign-off'}
        </button>
        <button type="button" className={s.secondary} onClick={done}>
          Cancel
        </button>
        <span className={s.muted}>Sign-offs can't be edited or deleted afterwards: a mistake is fixed with a correction.</span>
      </div>
    </form>
  );
}

function StageTemplate() {
  const { stages, signoffs, addStage, renameStage, moveStage, deleteStage } = useTaskStore();
  const [draft, setDraft] = useState('');
  const sorted = [...stages].sort(byOrder);
  const used = new Set(signoffs.map((x) => x.stage));

  return (
    <section className={s.card} aria-label="Stages">
      <h2 className={s.heading}>Stages</h2>
      <p className={s.note}>
        Every release in this workspace goes through these, in this order.{' '}
        {stages.length === 0 && 'The first release starts them as SIT, UAT, UVT, InfoSec and Go-live.'}
      </p>
      {sorted.map((st, i) => (
        <div key={st.id} className={s.formRow}>
          <input
            className={s.input}
            aria-label={`Stage ${st.name}`}
            defaultValue={st.name}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== st.name && renameStage(st.id, e.target.value)}
          />
          <button type="button" className={s.secondary} aria-label={`Move ${st.name} earlier`} disabled={i === 0} onClick={() => moveStage(st.id, -1)}>
            ↑
          </button>
          <button
            type="button"
            className={s.secondary}
            aria-label={`Move ${st.name} later`}
            disabled={i === sorted.length - 1}
            onClick={() => moveStage(st.id, 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className={s.secondary}
            aria-label={`Delete stage ${st.name}`}
            disabled={used.has(st.id)}
            title={used.has(st.id) ? 'Sign-offs name this stage, so it stays' : undefined}
            onClick={() => deleteStage(st.id)}
          >
            Delete
          </button>
        </div>
      ))}
      <form
        className={s.formRow}
        onSubmit={(e) => {
          e.preventDefault();
          addStage(draft);
          setDraft('');
        }}
      >
        <input className={s.input} aria-label="New stage" placeholder="New stage" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className={s.secondary} disabled={!draft.trim()}>
          Add stage
        </button>
      </form>
    </section>
  );
}
