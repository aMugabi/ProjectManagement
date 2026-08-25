# Ledger

A single-user web app for tracking tasks across several concurrent personal
projects. Rather than living inside one project at a time, Ledger opens on a
cross-project view of what needs attention today, and lets you drill into a
single project's task list when you want to do focused work.

Built with React, TypeScript, and Vite.

## Screens

- **Dashboard** — a "Focus" layout (today's tasks, this week, project health,
  blocked work) and a "Portfolio" layout (portfolio-wide stats and per-project
  cards), switchable from the header.
- **All tasks** — a **List** view grouped by project with inline editing and
  status changes, and a **Board** view for dragging tasks between statuses.
- **Timeline** — a two-week view of upcoming due dates.
- A right-hand **task detail drawer** and a **new-task composer** (press `n`
  to open, `/` to focus search).

## Getting started

```bash
npm install
npm run dev
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`.

## Stack

- **React Router** — screens and filters are linkable via the URL.
- **Zustand** — task data (persisted to `localStorage`) and transient UI
  state (drawer, composer, inline editing) live in separate stores.
- **@dnd-kit** — accessible-friendlier drag and drop for the board view.
- CSS Modules for styling, using design tokens (colors, spacing, radii)
  lifted directly from the project's design spec.

## Origin

This app recreates a high-fidelity HTML/CSS design prototype and handoff
spec ("Ledger") in a real, typed, componentized codebase. Notable decisions
made while translating the prototype into production code:

- Tasks now carry a real `dueDate` (computed relative to the current date)
  instead of the prototype's `dueOffset` integer.
- Filter and view state (search, priority, hide-done, board/list, dashboard
  layout, project filter) live in the URL query string so views are
  shareable/linkable.
- Task data persists to `localStorage` between sessions.
- The Focus dashboard layout is the default; Portfolio remains available via
  the header toggle rather than being decided away.

Not yet implemented, called out in the original spec as open decisions:
recurrence semantics (completing a recurring task doesn't spawn the next
instance), derived-vs-manual `blocked` status, manual board ordering, and
mobile/responsive layouts.
