/**
 * The sorting tool (build plan Step 1b): every plain project of the active workspace with its item
 * counts, each marked to stay a project or become a product, a partner, or a product with a
 * partner. The dry run shows what applying would make and move; applying goes through the store,
 * so it syncs like any other edit (to Redis today, Postgres later). Rollback is the backup taken
 * before (npm run backup, then --restore).
 */
import { useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { activeSnapshot } from '../shared/state';
import { isDone } from '../shared/itemTypes';
import { sortProjects, sortSummary, type ProjectTarget, type SortSummary } from '../lib/items';
import s from './SortProjects.module.css';

type Becomes = 'keep' | 'product' | 'partner' | 'pair';

interface Row {
  becomes: Becomes;
  /** Typed names; undefined = the default (the project's own name, or empty for a pair's partner). */
  product?: string;
  partner?: string;
}

const BECOMES: { value: Becomes; label: string }[] = [
  { value: 'keep', label: 'Stays a project' },
  { value: 'product', label: 'A product' },
  { value: 'partner', label: 'A partner' },
  { value: 'pair', label: 'A product with a partner' },
];

function names(list: string[]): string {
  return list.length ? list.join(', ') : 'none';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function SortProjects() {
  const store = useTaskStore();
  const apply = useTaskStore((st) => st.sortProjects);
  const workspace = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [result, setResult] = useState<SortSummary | null>(null);

  const snap = activeSnapshot(store);
  const row = (id: string): Row => rows[id] ?? { becomes: 'keep' };
  const setRow = (id: string, patch: Partial<Row>) => {
    setResult(null);
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { becomes: 'keep' }), ...patch } }));
  };

  // What each project becomes, as names: an existing product or partner of that name is reused.
  const { choices, missing } = (() => {
    const out: Record<string, ProjectTarget> = {};
    const gaps: string[] = [];
    for (const p of snap.projects) {
      const r = rows[p.id];
      if (!r || r.becomes === 'keep') continue;
      const product = (r.product ?? p.name).trim();
      const partner = (r.partner ?? (r.becomes === 'partner' ? p.name : '')).trim();
      if ((r.becomes !== 'partner' && !product) || (r.becomes !== 'product' && !partner)) {
        gaps.push(p.name);
        continue;
      }
      if (r.becomes === 'product') out[p.id] = { kind: 'product', product: `new:${product}` };
      else if (r.becomes === 'partner') out[p.id] = { kind: 'partner', partner: `new:${partner}` };
      else out[p.id] = { kind: 'pair', product: `new:${product}`, partner: `new:${partner}` };
    }
    return { choices: out, missing: gaps };
  })();

  // The dry run: the same pure function the store runs, on the current snapshot (the time is unused).
  const preview = sortSummary(snap, sortProjects(snap, choices, store.activeWorkspaceId, 0).snap);
  const ready = preview.projectsSorted > 0 && missing.length === 0 && preview.itemsBefore === preview.itemsAfter;

  function run() {
    const before = activeSnapshot(useTaskStore.getState());
    const message = `Sort ${plural(preview.projectsSorted, 'project')} and move ${plural(preview.itemsMoved, 'item')}? Every device gets the change when it next syncs.`;
    if (!window.confirm(message)) return;
    apply(choices);
    // The check after: the same counts again, from what the store now holds.
    setResult(sortSummary(before, activeSnapshot(useTaskStore.getState())));
    setRows({});
  }

  const counts = (projectId: string) => {
    const items = snap.tasks.filter((t) => t.project === projectId);
    const done = items.filter(isDone).length;
    return `${items.length - done} open · ${done} done`;
  };

  return (
    <div className={s.card}>
      <h2 className={s.heading}>Sort projects into products and partners</h2>
      <p className={s.note}>
        Sorting the <strong>{workspace?.name ?? 'current'}</strong> workspace; switch workspace in the sidebar to sort
        another. A project that becomes a product or partner moves all its items there, and the project goes; nothing
        else is deleted. Typing the name of an existing product or partner adds to it. Take a backup first (
        <code>npm run backup</code>): restoring it is the way back.
      </p>

      <datalist id="sort-products">
        {snap.products.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <datalist id="sort-partners">
        {snap.partners.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>

      {snap.projects.length === 0 && <p className={s.empty}>No plain projects left in this workspace.</p>}

      {snap.projects.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Items</th>
              <th>Becomes</th>
              <th>Product</th>
              <th>Partner</th>
            </tr>
          </thead>
          <tbody>
            {snap.projects.map((p) => {
              const r = row(p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <span className={s.dot} style={{ background: p.color }} />
                    {p.name}
                  </td>
                  <td className={s.counts}>{counts(p.id)}</td>
                  <td>
                    <select
                      className={s.input}
                      aria-label={`What "${p.name}" becomes`}
                      value={r.becomes}
                      onChange={(e) => setRow(p.id, { becomes: e.target.value as Becomes })}
                    >
                      {BECOMES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Product">
                    {(r.becomes === 'product' || r.becomes === 'pair') && (
                      <input
                        className={s.input}
                        list="sort-products"
                        aria-label={`Product for "${p.name}"`}
                        value={r.product ?? p.name}
                        onChange={(e) => setRow(p.id, { product: e.target.value })}
                      />
                    )}
                  </td>
                  <td data-label="Partner">
                    {(r.becomes === 'partner' || r.becomes === 'pair') && (
                      <input
                        className={s.input}
                        list="sort-partners"
                        aria-label={`Partner for "${p.name}"`}
                        placeholder="Partner name"
                        value={r.partner ?? (r.becomes === 'partner' ? p.name : '')}
                        onChange={(e) => setRow(p.id, { partner: e.target.value })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {preview.projectsSorted > 0 && (
        <div className={s.summary} aria-label="Dry run">
          <div className={s.summaryTitle}>Dry run</div>
          <p>
            {plural(preview.projectsSorted, 'project')} sorted, {plural(preview.projectsLeft, 'project')}{' '}
            {preview.projectsLeft === 1 ? 'stays' : 'stay'}; {plural(preview.itemsMoved, 'item')}{' '}
            {preview.itemsMoved === 1 ? 'moves' : 'move'}.
          </p>
          <p>New products: {names(preview.newProducts)}. New partners: {names(preview.newPartners)}.</p>
          <p>New pairs: {names(preview.newPairs)}.</p>
          <p>
            Items before: {preview.itemsBefore}; after: {preview.itemsAfter}.
          </p>
        </div>
      )}
      {missing.length > 0 && <p className={s.warning}>Give a name for: {missing.join(', ')}.</p>}

      <div className={s.actions}>
        <button type="button" className={s.button} disabled={!ready} onClick={run}>
          Sort {preview.projectsSorted > 0 ? plural(preview.projectsSorted, 'project') : 'projects'}
        </button>
      </div>

      {result && (
        <p className={result.itemsBefore === result.itemsAfter ? s.done : s.warning} role="status">
          {result.itemsBefore === result.itemsAfter
            ? `Done: ${plural(result.projectsSorted, 'project')} sorted and ${plural(result.itemsMoved, 'item')} moved; ${result.itemsAfter} items before and after.`
            : `Item count changed from ${result.itemsBefore} to ${result.itemsAfter}: restore the backup and report this.`}
        </p>
      )}
    </div>
  );
}
