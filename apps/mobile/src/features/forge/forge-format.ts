import type { ForgeLadderProgress } from '@forjd/contracts';

/**
 * How Weekly Forge writes its numbers, as the approved Phase 7 card does: "3,000 / 5,600 kg",
 * "8.4 / 11 km", "145 / 210 min".
 *
 * Built by hand rather than with `Intl.NumberFormat`, for the reason `features/home/date.ts`
 * gives: Hermes ships a trimmed ICU on Android, so locale output is not guaranteed.
 */
export type ForgeUnit = ForgeLadderProgress['unit'];

/** Kilometres keep one decimal (and drop a trailing ".0"); every other unit is a whole number. */
export function formatForgeAmount(value: number, unit: ForgeUnit): string {
  if (unit === 'km') {
    const tenths = Math.round(value * 10);
    const whole = withThousands(Math.trunc(tenths / 10));
    const fraction = tenths % 10;
    return fraction === 0 ? whole : `${whole}.${fraction}`;
  }
  return withThousands(Math.round(value));
}

/** The unit as the card prints it: the short "min" for minutes, as in the mock-up. */
export function unitLabel(unit: ForgeUnit): string {
  return unit === 'minutes' ? 'min' : unit;
}

/** "3 days left", and "Last day" on the week's final day (Friday). */
export function daysLeftLabel(daysLeft: number): string {
  return daysLeft <= 1 ? 'Last day' : `${daysLeft} days left`;
}

function withThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
