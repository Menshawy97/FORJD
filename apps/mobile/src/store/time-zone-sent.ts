/**
 * The last time zone this sign-in sent to the server (`features/forge/time-zone-sync.ts`). Its
 * own module, with no imports, so `account-preferences.ts` can forget it on sign-out without
 * importing the sync (which imports the API client, which imports secure storage, which imports
 * account preferences: a cycle).
 */
export const TIME_ZONE_SENT_STORAGE_KEY = 'forjd.timeZoneSent.v1';
