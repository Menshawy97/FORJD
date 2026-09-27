/**
 * The last time zone this sign-in sent to the server (`features/forge/time-zone-sync.ts`). Its
 * own module, with no imports, so `account-preferences.ts` can forget it on sign-out without
 * importing the sync (which imports the API client, which imports secure storage, which imports
 * account preferences: a cycle).
 */
export const TIME_ZONE_SENT_STORAGE_KEY = 'forjd.timeZoneSent.v1';

/**
 * Counts sign-outs in this app run. A sync takes the count when it starts and writes its "last
 * sent" copy only if the count has not moved: a send that finishes after a sign-out must not write
 * the old account's zone into the slot the next account reads, or that account would skip its own.
 */
let signOuts = 0;

export function timeZoneSentEpoch(): number {
  return signOuts;
}

/** Called by `forgetAccountPreferences` on every sign-out, beside removing the stored copy. */
export function forgetTimeZoneSent(): void {
  signOuts += 1;
}
