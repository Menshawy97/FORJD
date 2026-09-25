import type { MacroGoalSuggestionResponse } from "@forjd/contracts";
import {
  ACTIVITY_LEVEL_FACTORS,
  BODY_GOAL_ADJUSTMENTS,
  FAT_SHARE_OF_KCAL,
  ageInYears,
  mifflinStJeorBmrKcal,
  suggestDailyTargets,
  type ActivityLevel,
  type BodyGoal,
  type Sex,
} from "@forjd/domain";

import type { ScanWithMeasurementsRow } from "../body/body.repository";

/** The request contract's own ranges: anything outside them is a stray value, never a basis. */
const PLAUSIBLE_WEIGHT_KG: readonly [number, number] = [20, 400];
const PLAUSIBLE_BMR_KCAL: readonly [number, number] = [500, 5000];
const within = (value: number, [min, max]: readonly [number, number]): boolean => value >= min && value <= max;

export interface MacroSuggestionInputs {
  profile: {
    activityLevel: ActivityLevel | null;
    bodyGoal: BodyGoal | null;
    heightCm: number | null;
    dateOfBirth: string | null;
    sex: Sex | null;
  } | null;
  /** Newest first, as `BodyRepository.listScansForUser` returns them. */
  scans: ScanWithMeasurementsRow[];
  /** Weight readings from health data (Health Connect, manual), any order. */
  healthWeights: Array<{ at: Date; kg: number }>;
  today: Date;
}

type Missing = MacroGoalSuggestionResponse["missing"][number];

function newestScanValue(scans: ScanWithMeasurementsRow[], metric: string, range: readonly [number, number]) {
  for (const scan of scans) {
    const value = scan.measurements.find((m) => m.metric === metric)?.value;
    if (value !== undefined && within(value, range)) return { value, at: scan.measuredAt };
  }
  return null;
}

/**
 * Suggested daily targets and everything they were worked out from
 * (docs/product/scan-height-age-plan.md §4.5). Pure, so every rule is unit-tested here:
 *
 * - Weight: the newest reading across InBody scans and health data.
 * - BMR: the newest scan that has one (measured or calculated, slice D), else Mifflin–St Jeor
 *   from that weight and the profile's height, age today and sex.
 * - Activity level and goal: the profile's, chosen at sign-up or in Profile.
 *
 * Anything missing gives no suggestion and a `missing` list, never an invented default.
 */
export function buildMacroGoalSuggestion(inputs: MacroSuggestionInputs): MacroGoalSuggestionResponse {
  const { profile, scans, healthWeights, today } = inputs;

  const scanWeight = newestScanValue(scans, "weight_kg", PLAUSIBLE_WEIGHT_KG);
  const healthWeight = healthWeights
    .filter((w) => within(w.kg, PLAUSIBLE_WEIGHT_KG))
    .reduce<{ value: number; at: Date } | null>(
      (best, w) => (best === null || w.at > best.at ? { value: w.kg, at: w.at } : best),
      null,
    );
  const weight =
    scanWeight && healthWeight ? (healthWeight.at > scanWeight.at ? healthWeight : scanWeight) : (scanWeight ?? healthWeight);

  const scanBmr = newestScanValue(scans, "basal_metabolic_rate_kcal", PLAUSIBLE_BMR_KCAL);
  const ageYears = profile?.dateOfBirth ? ageInYears(profile.dateOfBirth, today) : null;
  const estimatedBmr =
    !scanBmr && weight && profile?.heightCm != null && ageYears !== null
      ? mifflinStJeorBmrKcal({ weightKg: weight.value, heightCm: profile.heightCm, ageYears, sex: profile.sex })
      : null;

  const missing: Missing[] = [];
  if (!profile?.activityLevel) missing.push("activityLevel");
  if (!profile?.bodyGoal) missing.push("bodyGoal");
  if (!weight) missing.push("weight");
  if (!scanBmr && estimatedBmr === null) missing.push("bmr");
  if (missing.length > 0 || !profile?.activityLevel || !profile.bodyGoal || !weight) {
    return { suggestion: null, basis: null, missing };
  }

  const bmrKcal = scanBmr ? scanBmr.value : (estimatedBmr as number);
  const targets = suggestDailyTargets({
    weightKg: weight.value,
    bmrKcal,
    activityLevel: profile.activityLevel,
    bodyGoal: profile.bodyGoal,
  });
  const goal = BODY_GOAL_ADJUSTMENTS[profile.bodyGoal];
  return {
    suggestion: { kcal: targets.kcal, protein: targets.proteinG, carbs: targets.carbsG, fat: targets.fatG },
    basis: {
      maintenanceKcal: targets.maintenanceKcal,
      bmrKcal,
      bmrSource: scanBmr ? "scan" : "estimate",
      scanMeasuredAt: scanBmr ? scanBmr.at.toISOString() : null,
      weightKg: weight.value,
      activityLevel: profile.activityLevel,
      activityFactor: ACTIVITY_LEVEL_FACTORS[profile.activityLevel],
      bodyGoal: profile.bodyGoal,
      energyChange: goal.energyChange,
      proteinPerKg: goal.proteinPerKg,
      fatShare: FAT_SHARE_OF_KCAL,
    },
    missing: [],
  };
}
