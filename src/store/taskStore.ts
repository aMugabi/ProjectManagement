import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Priority, Status, Task } from '../types';
import { buildSeedTasks, PROJECTS } from '../data/seed';

interface TaskStore {
  tasks: Task[];
  projects: typeof PROJECTS;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Status) => void;
  setPriority: (id: string, priority: Priority) => void;
  setTitle: (id: string, title: string) => void;
  setNotes: (id: string, notes: string) => void;
  addSubtask: (id: string, text: string) => void;
  toggleSubtask: (id: string, index: number) => void;
  deleteTask: (id: string) => void;
  addTask: (input: { title: string; project: string; priority: Priority; dueDate: string }) => void;
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set) => ({
      tasks: buildSeedTasks(),
      projects: PROJECTS,

      toggleDone: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t,
          ),
        })),

      setStatus: (id, status) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)) })),

      setPriority: (id, priority) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, priority } : t)) })),

      setTitle: (id, title) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, title } : t)) })),

      setNotes: (id, notes) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, notes } : t)) })),

      addSubtask: (id, text) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, subs: [...t.subs, { text, done: false }] } : t,
          ),
        })),

      toggleSubtask: (id, index) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  subs: t.subs.map((sub, i) => (i === index ? { ...sub, done: !sub.done } : sub)),
                }
              : t,
          ),
        })),

      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      addTask: ({ title, project, priority, dueDate }) =>
        set((s) => ({
          tasks: [
            {
              id: `t${Date.now()}`,
              project,
              title,
              status: 'todo',
              priority,
              dueDate,
              subs: [],
              recurring: null,
              deps: [],
              notes: '',
            },
            ...s.tasks,
          ],
        })),
    }),
    { name: 'ledger-tasks' },
  ),
);
