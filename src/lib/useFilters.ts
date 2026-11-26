import { useSearchParams } from 'react-router-dom';
import type { DashLayout, ItemType, Priority, TaskView } from '../types';
import { isItemType } from '../shared/itemTypes';

/** Filter & view-mode state, kept in the URL so every view is linkable. */
export function useFilters() {
  const [params, setParams] = useSearchParams();

  const project = params.get('project');
  const product = params.get('product');
  const partner = params.get('partner');
  const typeParam = params.get('type');
  const type: ItemType | null = isItemType(typeParam) ? typeParam : null;
  const priority = (params.get('priority') as Priority | null) ?? null;
  const search = params.get('q') ?? '';
  const hideDone = params.get('hideDone') !== 'false'; // default true
  const taskView = (params.get('view') as TaskView | null) ?? 'list';
  const dashLayout = (params.get('layout') as DashLayout | null) ?? 'focus';

  function update(patch: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }

  return {
    project,
    product,
    partner,
    type,
    priority,
    search,
    hideDone,
    taskView,
    dashLayout,
    setProject: (id: string | null) => update({ project: id }),
    setPriority: (p: Priority | null) => update({ priority: p === priority ? null : p }),
    setSearch: (q: string) => update({ q: q || null }),
    setHideDone: (v: boolean) => update({ hideDone: v ? null : 'false' }),
    setTaskView: (v: TaskView) => update({ view: v === 'list' ? null : v }),
    setDashLayout: (v: DashLayout) => update({ layout: v === 'focus' ? null : v }),
    clearProject: () => update({ project: null, product: null, partner: null }),
    setType: (t: ItemType | null) => update({ type: t }),
  };
}
