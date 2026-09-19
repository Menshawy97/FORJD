import { MINIMUM_AGE_YEARS } from '@forjd/domain';

/** The design's empty state for the date-of-birth field (`signuppage2.png`). */
export const DOB_PLACEHOLDER = 'mm/dd/yyyy';

/**
 * A local calendar date as `YYYY-MM-DD`, reading local getters so the round trip through a
 * date picker cannot drift a day across a timezone (the same reasoning as `parseIsoDate` in
 * `edit-profile.tsx`).
 */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `mm/dd/yyyy`, exactly as the design shows it -- the placeholder until a date is chosen. */
export function formatDobDisplay(date: Date | null): string {
  if (date === null) {
    return DOB_PLACEHOLDER;
  }
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month}/${day}/${date.getFullYear().toString().padStart(4, '0')}`;
}

/**
 * The most recent birth date that is still old enough (ADR-042): today, `MINIMUM_AGE_YEARS`
 * ago. Used as the date picker's `maximumDate` where the goal is to prevent choosing an
 * under-age date at all (editing a profile). The sign-up step deliberately does not use it --
 * an under-age answer there must reach the server, which removes the account.
 */
export function latestAllowedBirthDate(today: Date): Date {
  return new Date(today.getFullYear() - MINIMUM_AGE_YEARS, today.getMonth(), today.getDate());
}
