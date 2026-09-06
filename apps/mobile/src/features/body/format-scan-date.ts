const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The InBody scan-history row's date format -- the design's own "11 Aug 2026", distinct from
 * `features/home/date.ts`'s "Tuesday, 19 Aug" (that file's docblock explains why display
 * formats are hand-built here rather than through `Intl.DateTimeFormat`: no locale produces
 * an exact match, and Hermes's trimmed ICU on Android makes locale output non-deterministic
 * for tests anyway). This is a second, differently-shaped format, not a reuse of that one.
 */
/**
 * Reads UTC getters, not local ones -- `edit-profile.tsx`'s `parseIsoDate` docblock explains
 * the exact failure this avoids: a local-getter read of a UTC instant shifts the displayed
 * date backward by a day in any timezone behind UTC by more than the instant's own time-of-
 * day component. `measuredAt` from the API is a full ISO instant, not a bare calendar date,
 * so this format is stable regardless of the viewer's device timezone.
 */
export function formatScanDate(iso: string): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}
