import { create } from 'zustand';
import type { Priority } from '../types';

interface UiStore {
  openId: string | null;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;

  editingId: string | null;
  editDraft: string;
  startEdit: (id: string, initial: string) => void;
  setEditDraft: (v: string) => void;
  stopEdit: () => void;

  dragId: string | null;
  setDragId: (id: string | null) => void;

  composing: boolean;
  draftTitle: string;
  draftProject: string;
  draftPrio: Priority;
  draftDueOffset: number;
  openComposer: () => void;
  closeComposer: () => void;
  setDraftTitle: (v: string) => void;
  setDraftProject: (v: string) => void;
  setDraftPrio: (v: Priority) => void;
  setDraftDueOffset: (v: number) => void;
  resetDraftTitle: () => void;

  subDraft: string;
  setSubDraft: (v: string) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  openId: null,
  openDrawer: (id) => set({ openId: id, editingId: null }),
  closeDrawer: () => set({ openId: null }),

  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),

  editingId: null,
  editDraft: '',
  startEdit: (id, initial) => set({ editingId: id, editDraft: initial, openId: null }),
  setEditDraft: (v) => set({ editDraft: v }),
  stopEdit: () => set({ editingId: null, editDraft: '' }),

  dragId: null,
  setDragId: (id) => set({ dragId: id }),

  composing: false,
  draftTitle: '',
  draftProject: 'aur',
  draftPrio: 'med',
  draftDueOffset: 0,
  openComposer: () => set({ composing: true }),
  closeComposer: () => set({ composing: false }),
  setDraftTitle: (v) => set({ draftTitle: v }),
  setDraftProject: (v) => set({ draftProject: v }),
  setDraftPrio: (v) => set({ draftPrio: v }),
  setDraftDueOffset: (v) => set({ draftDueOffset: v }),
  resetDraftTitle: () => set({ draftTitle: '' }),

  subDraft: '',
  setSubDraft: (v) => set({ subDraft: v }),
}));
