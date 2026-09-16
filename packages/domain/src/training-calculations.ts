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
 *
 * Reference: Epley, B. (1985). "Poundage Chart." Boyd Epley Workout. Lincoln, NE: Body
 * Enterprises. Standard Epley, chosen over a `reps - 1` variant after the R29 audit
 * remediation found this file previously implemented the variant while this docblock
 * claimed the standard formula — see
 * [ADR-038](../../../docs/decisions/ADR-038-audit-remediation-pass-2026-09.md).
 */
const EPLEY_DIVISOR = 30;

/**
 * Beyond this the formula stops meaning anything. Epley extrapolates a 20-rep set to roughly
 * 1.63x the load, which is not a number to put in front of an athlete as their own one-rep
 * max.
 *
 * **Ten, not the more commonly quoted twelve** (ADR-030, R7/R8): DiStasio's validation of the
 * Brzycki and Epley equations against a measured back-squat 1RM, and the seven-equation
 * accuracy comparison in sedentary older adults, both find these estimators meaningfully more
 * accurate under ten reps, with error growing fastest just past it. Ten is the boundary the
 * evidence actually supports.
 */
const MAX_ESTIMABLE_REPS = 10;

/**
 * Estimated one-rep max in kilograms, or `null` when no honest estimate exists.
 *
 * **`null` is a real answer here, not an error path.** A set of twenty, a set with no load, or
 * a fractional rep count all describe something the formula cannot speak to, and the screen
 * renders its em dash rather than a number that looks authoritative and is wrong. That is the
 * same call this project has already made for heart rate, City Rank and the PR badge.
 *
 * **Standard Epley, unmodified: `weight x (1 + reps / 30)` for every rep count in range,
 * including one.** An earlier version of this function used a `reps - 1` exponent instead,
 * which reads about 3 percent low against the published formula and disagreed with this file's
 * own top-of-file docblock. The R29 audit remediation put both curves in front of the user, who
 * chose the standard, published formula — see
 * [ADR-038](../../../docs/decisions/ADR-038-audit-remediation-pass-2026-09.md). One consequence
 * worth being explicit about: at exactly one rep the unmodified formula returns a touch above
 * the lifted weight (`weight x 31/30`) rather than the weight itself — that is the standard
 * formula's own behaviour at its boundary, not a bug introduced here.
 *
 * Rounded to one decimal here rather than at each call site, so two screens showing "the same"
 * estimate cannot disagree in the last digit.
 */
export function estimateOneRepMaxKg(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps <= 0) return null;
  if (reps > MAX_ESTIMABLE_REPS) return null;

  const estimate = weightKg * (1 + reps / EPLEY_DIVISOR);
  return Math.round(estimate * 10) / 10;
}
