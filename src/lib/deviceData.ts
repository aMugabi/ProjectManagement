/**
 * What Ledger keeps in this browser, so signing out can remove all of it. Every key starts with
 * 'ledger-': the task store, the "unsynced edits" flag, the reminder log, the push flag and the
 * session token. No imports, so auth.ts and cloudStorage.ts can both use it without a cycle, and
 * it is evaluated before any module that reads storage at start-up.
 */
export const STORE_KEY = 'ledger-tasks-v2';

/** Set while this browser has edits the cloud hasn't confirmed; survives reloads so offline edits get uploaded. */
export const PENDING_KEY = 'ledger-sync-pending';

const PREFIX = 'ledger-';
/** sessionStorage marker: clear again on the next page load (see clearDeviceData). */
const WIPE_KEY = 'ledger-wipe-on-load';

export function hasUnsyncedEdits(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function removeLedgerKeys() {
  for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
}

/**
 * Removes every Ledger key from this browser's storage. Callers then reload the page to drop the
 * in-memory copy too, but the running app can still save that copy before the reload takes
 * effect, so the next page load clears once more before anything reads storage.
 */
export function clearDeviceData(): void {
  try {
    removeLedgerKeys();
    sessionStorage.setItem(WIPE_KEY, '1');
  } catch {
    // Storage unavailable: nothing was saved here either.
  }
}

try {
  if (sessionStorage.getItem(WIPE_KEY)) {
    removeLedgerKeys();
    sessionStorage.removeItem(WIPE_KEY);
  }
} catch {
  // ignore
}
