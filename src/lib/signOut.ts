/**
 * Signing out of a cloud build: upload what this device hasn't synced, stop push reaching it, end
 * the session, then delete Ledger's data from this browser. Ledger holds work data, so a shared or
 * lost device shouldn't keep a copy once signed out. The data stays in the cloud.
 */
import { endSession } from './auth';
import { syncNow } from './cloudStorage';
import { clearDeviceData } from './deviceData';
import { disablePush } from './push';

/** 'unsynced': edits couldn't be uploaded (offline?), so nothing was done; ask before discarding them. */
export type SignOutResult = 'signed-out' | 'unsynced';

export async function signOut(everywhere = false, discardUnsynced = false): Promise<SignOutResult> {
  if (!(await syncNow()) && !discardUnsynced) return 'unsynced';
  // While the session is still valid, so the server forgets this device's subscription too.
  await disablePush().catch(() => undefined);
  await endSession(everywhere);
  clearDeviceData();
  // Drops the in-memory copy as well; the app reopens at the sign-in screen with nothing stored.
  window.location.reload();
  return 'signed-out';
}
