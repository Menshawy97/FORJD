/**
 * Body-composition arithmetic for checking a read InBody sheet and filling in what a scan lacks
 * (docs/product/scan-height-age-plan.md §4.1–4.2).
 *
 * Domain code: no UI, no provider SDK, no database (CLAUDE.md rules 1 and 2).
 *
 * - **BMI** = weight kg ÷ (height m)². WHO, *Obesity: preventing and managing the global
 *   epidemic*, Technical Report Series 894 (2000).
 * - **BMR** = 370 + 21.6 × fat-free mass kg (Katch–McArdle; McArdle, Katch & Katch, *Exercise
 *   Physiology*). It is the formula InBody itself prints BMR from, so it both checks a read BMR
 *   and fills in a missing one.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Weight over height in metres squared, to one decimal like the sheet prints it. */
export function bmiFrom(weightKg: number, heightCm: number): number {
  const metres = heightCm / 100;
  return round1(weightKg / (metres * metres));
}

/**
 * Weight minus body fat mass, or weight × (1 − body fat % ÷ 100) when only the percentage is known.
 * Null without either: only weight is required on a scan, and fat-free mass cannot be guessed.
 */
export function fatFreeMassKg(values: {
  weightKg: number;
  bodyFatMassKg: number | null;
  bodyFatPercent: number | null;
}): number | null {
  if (values.bodyFatMassKg !== null) return round1(values.weightKg - values.bodyFatMassKg);
  if (values.bodyFatPercent !== null) return round1(values.weightKg * (1 - values.bodyFatPercent / 100));
  return null;
}

/** Katch–McArdle: 370 + 21.6 × fat-free mass, in whole kcal. */
export function katchMcArdleBmrKcal(fatFreeMassKg: number): number {
  return Math.round(370 + 21.6 * fatFreeMassKg);
}

/**
 * A sheet BMI further than this from the computed one was misread. Wide enough for the sheet's
 * own rounding of weight, height and BMI; narrow enough to catch a misread digit (29.3 for 25.3).
 */
export const BMI_TOLERANCE = 0.5;

/** A sheet BMR further than this share from Katch–McArdle was misread (plan §4.2). */
export const BMR_TOLERANCE_RATIO = 0.05;

export function bmiDisagrees(sheetBmi: number, computedBmi: number): boolean {
  return Math.abs(sheetBmi - computedBmi) > BMI_TOLERANCE + 1e-9;
}

export function bmrDisagrees(sheetBmrKcal: number, computedBmrKcal: number): boolean {
  return Math.abs(sheetBmrKcal - computedBmrKcal) > computedBmrKcal * BMR_TOLERANCE_RATIO;
}
