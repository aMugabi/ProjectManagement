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
4. Turn on the second sign-in step (MFA): run `npm run setup-mfa` in your own terminal (not
   through a chat or anything that records output), scan the QR code it draws with an
   authenticator app (or use *Enter a setup key* with the key it prints), type the code the app
   shows, then add the printed
   `AUTH_TOTP_SECRET` and `AUTH_RECOVERY_CODES` values to the Vercel project and redeploy. Keep
   the ten recovery codes in a password manager or on paper: each signs in once without the phone.
   Running the script again makes a new key and new codes (the old ones stop working once the
   variables are replaced). Without `AUTH_TOTP_SECRET`, sign-in asks for the password only.

Signing in sends the password (and, with MFA on, the authenticator or recovery code) once to
`/api/login`, which is rate-limited (5 attempts per 15 minutes per IP, 50 per hour overall) and
returns a random session token. Each authenticator code and each recovery code works once, and a
wrong password and a wrong code get the same answer. Only that token
is kept in the browser; sessions last 30 days from last use and can be signed out on every
device from Settings.

Signing out uploads any unsynced edits, turns off push for that device, ends the session and then
deletes Ledger's data from that browser (it stays in the cloud). If the edits can't be uploaded
(offline), Ledger asks before deleting them. *All devices* also drops every push subscription, and
each other device deletes its copy the next time it opens, unless it holds edits the cloud hasn't
received yet; those are kept until the next sign-in uploads them. A legacy bare SHA-256 `AUTH_PASSWORD_HASH` still works (with a warning
in the function logs) until you replace it.

Sync merges task by task (newest edit wins, deletions are remembered), so edits made
offline and edits on other devices are both kept.

**Local-only mode.** Builds outside Vercel — the GitHub Pages deploy and plain `npm run dev`
— have no API, so they skip the password gate, keep data in that browser only, and show
"Local only · this browser" in the sidebar. Use `vercel dev` to run the cloud build locally.

## Backups (Vercel deploy only)

`npm run backup` signs in (password, and code if MFA is on), downloads the whole cloud copy,
saves it encrypted with gpg, and signs that session out. The unencrypted data never touches the
disk. Backups go to `~/ledger-backups/` (set `LEDGER_BACKUP_DIR` to change it; never inside this
repository, which is public). Keep a second copy somewhere else, such as an external drive.

- **Encryption:** set `LEDGER_BACKUP_RECIPIENT` to your gpg key's email or id to encrypt to that
  key (make one with `gpg --quick-gen-key "Your Name <you@example.org>"`, and back up its private
  half too). Without it, gpg asks for a passphrase (AES-256).
- **Check a backup:** `npm run backup -- --verify FILE` decrypts it and prints counts per
  workspace, never the content.
- **Restore:** `npm run backup -- --restore FILE` uploads it, merged with the cloud copy: newer
  edits there are kept, and anything deleted since the backup stays deleted. It asks you to type
  `restore` first.
- `LEDGER_URL` points the script at another deploy.

## Reminders and notifications

Ledger warns you about tasks that are overdue, due today or coming up:

- **Daily digest** at a time you choose (Settings → Reminders): what's due today, plus
  anything overdue.
- **Lead reminders** for each task inside its reminder window (default: 1 day before; change it
  per task under *Remind me*).
- **Pop-ups** inside the app (Open task · Snooze 1h · Dismiss), and a 🔔 in the header listing
  everything overdue, due today and coming up across all workspaces.
- **System notifications** while Ledger is open in a background tab, once allowed.
- **Push notifications** that arrive even when Ledger is closed (Vercel deploy only).
- **Email digest** — one email each morning at the digest time (Vercel deploy only; Settings →
  *Email me the daily digest*). Digest only, never one email per task.
- **Private notifications** (on by default) — emails, push and system notifications show counts
  only ("2 due today, 1 overdue", "A task is due tomorrow"), never task, project or workspace
  names, since they can appear on a lock screen and emails pass through the email service. Turn it
  off under Settings → Notifications. In-app pop-ups always show the full text.

On iPhone/iPad, push needs Ledger added to the Home Screen and opened from there (iOS 16.4+).
In Brave, turn on *Use Google services for push messaging* (`brave://settings/privacy`).

### Server setup (Vercel)

Add these environment variables to the Vercel project (Production), then redeploy:

| Variable | What it's for |
| --- | --- |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push. Generate the keys with `npx web-push generate-vapid-keys`; the subject is `mailto:` + a contact address. |
| `REMINDERS_SECRET` | Long random string; lets the timer below call `/api/reminders`. |
| `RESEND_API_KEY` | Email, via [Resend](https://resend.com). |
| `EMAIL_FROM` (optional) | Sender, e.g. `Ledger <ledger@yourdomain.org>` once that domain is verified in Resend. Without it, Resend's test sender is used, which only delivers to the Resend account owner's address. |

### The 15-minute timer

`.github/workflows/reminders.yml` calls `/api/reminders` every 15 minutes (free for public
repositories). Add a repository secret **`REMINDERS_SECRET`** (GitHub → Settings → Secrets and
variables → Actions) with the same value as in Vercel. To point it at another deploy, set a
repository variable `LEDGER_URL`. Trigger a run by hand from the Actions tab (*Send reminders →
Run workflow*). GitHub may start scheduled runs a few minutes late; each reminder and each day's
email is still sent at most once.

If the morning email can't be sent, the endpoint answers 502 and that run fails, so GitHub emails
whoever last edited the workflow's schedule (keep *Actions* notifications on under GitHub →
Settings → Notifications). The next run retries the email.

Alternatively, an Upstash QStash schedule can call the same endpoint (it verifies the
`QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` signature).

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
