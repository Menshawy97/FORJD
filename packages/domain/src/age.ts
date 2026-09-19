/**
 * The youngest age allowed to hold a FORJD account (ADR-042). Health data is collected, so the
 * bar is the conservative one for the EU and US. This is the only place the number lives; the
 * contracts, the API and the app all read it from here.
 */
export const MINIMUM_AGE_YEARS = 16;

/**
 * Whole years between a `YYYY-MM-DD` date of birth and `today`, counted on calendar parts so
 * a timezone can never shift the answer by a day. A birthday that falls on `today` has already
 * been reached; a 29 February birthday is reached on 1 March in a non-leap year.
 *
 * Throws on anything that is not a real calendar date -- an age gate that guessed at a
 * malformed value would be a gate that can be walked around.
 */
export function ageInYears(dateOfBirth: string, today: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) {
    throw new Error(`ageInYears: not a YYYY-MM-DD date: "${dateOfBirth}"`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    throw new Error(`ageInYears: not a real calendar date: "${dateOfBirth}"`);
  }

  let age = today.getFullYear() - year;
  const birthdayNotYetReached =
    today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (birthdayNotYetReached) {
    age -= 1;
  }

  return age;
}

/** True once the person has reached `MINIMUM_AGE_YEARS`. A future date of birth is never old enough. */
export function isOldEnough(dateOfBirth: string, today: Date): boolean {
  return ageInYears(dateOfBirth, today) >= MINIMUM_AGE_YEARS;
}
