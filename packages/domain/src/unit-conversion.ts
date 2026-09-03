/**
 * Display-unit conversion.
 *
 * **Storage is always metric.** Weights are kilograms and distances are metres everywhere in
 * this system — in the database, in the contracts, in the session log (ADR-016). These functions
 * exist purely so a screen can *show* a number in the unit the athlete asked for, and turn what
 * they typed back into the canonical one. Nothing here should ever decide what gets persisted.
 *
 * The rounding is the prototype's own (`convOut` / `convIn` in `FORJD Mobile.dc.html`), not a
 * choice invented here:
 *
 * - kilograms to pounds rounds to the nearest **half pound**, because plates come in halves and
 *   `112.43567 lb` is a number nobody has ever loaded onto a bar;
 * - pounds back to kilograms keeps **one decimal**, which is finer than any gym scale and finer
 *   than the half-pound step above, so a round trip through the toggle cannot drift.
 */

/** The exact international avoirdupois pound, in kilograms. Not an approximation. */
const KG_PER_LB = 0.45359237;
const LB_PER_KG = 1 / KG_PER_LB;
const METRES_PER_MILE = 1609.344;

/** How a weight is displayed. Storage is always `kg`. */
export const WEIGHT_DISPLAY_UNITS = ['kg', 'lb'] as const;
export type WeightDisplayUnit = (typeof WEIGHT_DISPLAY_UNITS)[number];

/** How a distance is displayed. Storage is always `m`. */
export const DISTANCE_DISPLAY_UNITS = ['m', 'mi'] as const;
export type DistanceDisplayUnit = (typeof DISTANCE_DISPLAY_UNITS)[number];

/**
 * Stored kilograms to the number shown on screen.
 *
 * `kg` returns the value untouched rather than rounding it, because it is already canonical —
 * rounding the identity case would quietly discard precision the database is holding.
 */
export function weightForDisplay(kg: number, unit: WeightDisplayUnit): number {
  if (unit === 'kg') {
    return kg;
  }
  return Math.round(kg * LB_PER_KG * 2) / 2;
}

/** What the athlete typed, back to the kilograms that get stored. */
export function weightFromDisplay(value: number, unit: WeightDisplayUnit): number {
  if (unit === 'kg') {
    return value;
  }
  return Math.round(value * KG_PER_LB * 10) / 10;
}

/** Stored metres to the number shown on screen. Miles keep two decimals; metres stay whole. */
export function distanceForDisplay(metres: number, unit: DistanceDisplayUnit): number {
  if (unit === 'm') {
    return Math.round(metres);
  }
  return Math.round((metres / METRES_PER_MILE) * 100) / 100;
}

/** What the athlete typed, back to the metres that get stored. */
export function distanceFromDisplay(value: number, unit: DistanceDisplayUnit): number {
  if (unit === 'm') {
    return Math.round(value);
  }
  return Math.round(value * METRES_PER_MILE);
}

/** The other one. The chip is a toggle, not a menu — there are only ever two. */
export function nextWeightUnit(unit: WeightDisplayUnit): WeightDisplayUnit {
  return unit === 'kg' ? 'lb' : 'kg';
}

export function nextDistanceUnit(unit: DistanceDisplayUnit): DistanceDisplayUnit {
  return unit === 'm' ? 'mi' : 'm';
}
