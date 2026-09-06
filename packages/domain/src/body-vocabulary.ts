/**
 * Canonical body-composition vocabulary (Phase 5, InBody). Same `as const` tuple +
 * display-name map pattern as `exercise-vocabulary.ts` and `workout-vocabulary.ts` --
 * `@forjd/contracts` builds `z.enum(...)` from these tuples, so drift between the domain
 * and the wire is unrepresentable, and the UI never hardcodes a label.
 *
 * `BODY_METRICS` backs `body_measurements.metric` -- a `text` column, never a Postgres
 * enum, for the same reason `workout-vocabulary.ts` gives: adding a metric an InBody model
 * prints (bone mass, phase angle) is then a tuple edit, not a migration.
 *
 * This file is pure TypeScript with no imports beyond this package, enforced by CI's
 * conformance check (CLAUDE.md rules 1-2).
 *
 * @see docs/architecture/health-data.md -- the tall, one-row-per-measurement shape this
 *      vocabulary's fields are read into (`BodyCompositionMeasurement`).
 * @see docs/decisions/ADR-032-... -- the confirm-screen pre-fill threshold this file defines.
 */

/**
 * The nine fields on the design's confirm screen (`s_inbodyConfirm`, `FORJD Mobile.dc.html`),
 * in the order the screen renders them. `weight_kg`, `skeletal_muscle_mass_kg`, and
 * `body_fat_mass_kg` are always stored in kilograms regardless of what unit the InBody
 * sheet printed -- the vision extraction step converts before this vocabulary ever sees a
 * value (see `docs/decisions/ADR-032-...`).
 */
export const BODY_METRICS = [
  "weight_kg",
  "skeletal_muscle_mass_kg",
  "body_fat_mass_kg",
  "body_fat_percent",
  "visceral_fat_level",
  "total_body_water_l",
  "bmi",
  "basal_metabolic_rate_kcal",
  "inbody_score",
] as const;
export type BodyMetric = (typeof BODY_METRICS)[number];

export const BODY_METRIC_DISPLAY_NAMES: Record<BodyMetric, string> = {
  weight_kg: "Weight",
  skeletal_muscle_mass_kg: "Skeletal muscle mass",
  body_fat_mass_kg: "Body fat mass",
  body_fat_percent: "Body fat percentage",
  visceral_fat_level: "Visceral fat level",
  total_body_water_l: "Total body water",
  bmi: "Body mass index",
  basal_metabolic_rate_kcal: "Basal metabolic rate",
  inbody_score: "InBody score",
};

/**
 * Display unit per metric, exactly as the confirm screen renders it. Empty string for the
 * three unitless fields (visceral fat level, BMI, InBody score) rather than omitting them,
 * so every `BODY_METRICS` member has a defined entry here -- see the coverage test.
 */
export const BODY_METRIC_UNITS: Record<BodyMetric, string> = {
  weight_kg: "kg",
  skeletal_muscle_mass_kg: "kg",
  body_fat_mass_kg: "kg",
  body_fat_percent: "%",
  visceral_fat_level: "",
  total_body_water_l: "L",
  bmi: "",
  basal_metabolic_rate_kcal: "kcal",
  inbody_score: "",
};

/**
 * The five sites in the design's "Segmental lean analysis" section (Body tab and the
 * confirm screen's `state.seg`), always in kilograms.
 */
export const SEGMENTAL_SITES = ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"] as const;
export type SegmentalSite = (typeof SEGMENTAL_SITES)[number];

export const SEGMENTAL_SITE_DISPLAY_NAMES: Record<SegmentalSite, string> = {
  right_arm: "Right arm",
  left_arm: "Left arm",
  trunk: "Trunk",
  right_leg: "Right leg",
  left_leg: "Left leg",
};

/**
 * Where a body-composition measurement came from. `inbody` is the only source Phase 5
 * writes; the vocabulary is not a single literal so Phase 6's Health Connect / Apple
 * Health providers (and the source-priority read-time policy `health-data.md` describes)
 * have somewhere to land without a schema change.
 */
export const SCAN_SOURCES = ["inbody"] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

export const SCAN_SOURCE_DISPLAY_NAMES: Record<ScanSource, string> = {
  inbody: "InBody",
};

/**
 * Below this confidence, the confirm screen renders a field blank instead of pre-filling
 * it -- `docs/architecture/health-data.md`'s "nothing saves unconfirmed" rule applied to
 * the specific case of a low-confidence reading a tired user might tap past. Set to 0.9 to
 * match the design's own visual cutoff: `s_inbodyConfirm()` already switches the
 * confidence bar and the input's border to amber at exactly `conf < .9`, so this reuses
 * that line instead of inventing a second threshold that could drift from it.
 */
export const CONFIDENCE_PREFILL_THRESHOLD = 0.9;

/** Whether a reading at this confidence should pre-fill its field on the confirm screen. */
export function shouldPrefill(confidence: number): boolean {
  return confidence >= CONFIDENCE_PREFILL_THRESHOLD;
}
