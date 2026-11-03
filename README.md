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

## Installing as an app (PWA)

Ledger is a Progressive Web App (via `vite-plugin-pwa`): on either deploy, use
the browser's **Install** button (desktop Chrome/Edge) or **Share → Add to Home
Screen** (iOS Safari) to run it in its own window. A service worker precaches
the app shell, so it opens offline; edits still land in `localStorage` and
sync to `/api/state` the next time a change is made online. The service worker
never caches `/api/state`. New deploys are picked up automatically on the next
launch.

The service worker only runs in production builds — use `npm run build &&
npm run preview` to try it locally. The PNG icons in `public/` are rendered
from `public/favicon.svg`.

## Cloud sync (Vercel deploy only)

Task data is written to `localStorage` immediately and mirrored to `/api/state`,
a serverless function backed by an Upstash Redis store, so it follows you across
devices. To enable it on a Vercel deployment:

1. In the Vercel project, open **Storage → Create Database** (or **Marketplace**)
   and add an **Upstash Redis** store, connected to this project. That injects
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` automatically.
2. Pick a password and hash it (salted scrypt; the password is prompted for and not echoed):
   ```bash
   npm run hash-password
   ```
3. Add the printed `scrypt$…` value as the `AUTH_PASSWORD_HASH` environment variable on the
   Vercel project, then redeploy. The password itself is never stored anywhere.

Signing in sends the password once to `/api/login`, which is rate-limited (5 attempts per
15 minutes per IP, 50 per hour overall) and returns a random session token. Only that token
is kept in the browser; sessions last 30 days from last use and can be signed out on every
device from Settings. A legacy bare SHA-256 `AUTH_PASSWORD_HASH` still works (with a warning
in the function logs) until you replace it.

Sync merges task by task (newest edit wins, deletions are remembered), so edits made
offline and edits on other devices are both kept.

**Local-only mode.** Builds outside Vercel — the GitHub Pages deploy and plain `npm run dev`
— have no API, so they skip the password gate, keep data in that browser only, and show
"Local only · this browser" in the sidebar. Use `vercel dev` to run the cloud build locally.

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

The spec's open decisions have since been resolved:

- **Recurrence** — completing a recurring task rolls it to its next
  occurrence (due date advanced, subtasks reset, status back to "to do")
  instead of resting at "done".
- **Blocked status is derived, not manual** — a task reads as Blocked
  whenever it has an unfinished dependency; it's no longer a status you pick
  from a dropdown. Dependencies are editable from the task drawer.
- **Manual board ordering** — the Board view supports drag-to-reorder within
  a column (via `@dnd-kit/sortable`), independent of the List view's
  due-date sort. The Blocked column stays derived-only: its cards can't be
  dragged, since leaving it requires resolving a dependency, not a drag.
- **Responsive layout** — below ~860px the sidebar becomes an off-canvas
  menu (hamburger toggle in the header), the dashboard's two columns stack,
  the board becomes a horizontally swipeable carousel, and the drawer/
  composer go full-width.
