/**
 * Training calculations — the derived numbers the app shows an athlete about their own
 * lifting, as opposed to the raw sets they logged.
 *
 * Domain code: no UI, no provider SDK, no database (CLAUDE.md rules 1 and 2). It lives here
 * rather than in the API or the app because both sides will eventually want the same answer,
 * and two implementations of a formula are two chances to disagree about an athlete's numbers.
 */

/**
 * Epley's divisor. The formula is `weight x (1 + reps / 30)` — the estimator the
 * strength-training literature uses most widely, and the one whose behaviour is best
 * understood in the rep range that matters here.
 */
const EPLEY_DIVISOR = 30;

/**
 * Beyond this the formula stops meaning anything. Epley extrapolates a 20-rep set to roughly
 * 1.63x the load, which is not a number to put in front of an athlete as their own one-rep
 * max. Twelve is the conventional upper bound for estimators in this family.
 */
const MAX_ESTIMABLE_REPS = 12;

/**
 * Estimated one-rep max in kilograms, or `null` when no honest estimate exists.
 *
 * **`null` is a real answer here, not an error path.** A set of twenty, a set with no load, or
 * a fractional rep count all describe something the formula cannot speak to, and the screen
 * renders its em dash rather than a number that looks authoritative and is wrong. That is the
 * same call this project has already made for heart rate, City Rank and the PR badge.
 *
 * A single rep is returned unchanged: one rep *is* a one-rep max, and the unadjusted formula
 * would inflate it by a thirtieth — which is why the exponent is `reps - 1`, not `reps`.
 *
 * Rounded to one decimal here rather than at each call site, so two screens showing "the same"
 * estimate cannot disagree in the last digit.
 */
export function estimateOneRepMaxKg(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps <= 0) return null;
  if (reps > MAX_ESTIMABLE_REPS) return null;

  const estimate = weightKg * (1 + (reps - 1) / EPLEY_DIVISOR);
  return Math.round(estimate * 10) / 10;
}
