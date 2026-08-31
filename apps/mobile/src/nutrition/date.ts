/**
 * `YYYY-MM-DD` for "today", in the device's own local timezone -- never `new Date().toISOString()`,
 * which reads UTC and would name the wrong calendar day for roughly half the world's
 * timezones at certain hours. Mirrors `edit-profile.tsx`'s `toIsoDate` local-getters technique.
 * `nutrition.schema.ts`'s own docblock is explicit that `loggedDate` is the client's local
 * calendar day, never server-derived -- this is the one place that day gets computed.
 */
export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
