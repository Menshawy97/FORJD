/**
 * Suggested daily calorie and macro targets (docs/product/scan-height-age-plan.md §4.5, answered
 * and designed with the user on 2026-09-25). A suggestion only: nothing changes until the user
 * taps Use, and their own typed targets stay possible.
 *
 * - Energy: BMR × a physical-activity level (FAO/WHO/UNU, *Human energy requirements*, 2004),
 *   then the goal's change. BMR is the latest InBody scan's, else Mifflin–St Jeor
 *   (`mifflinStJeorBmrKcal`).
 * - Protein per kg of body weight: 1.6 g (Morton et al., *Br J Sports Med* 2018;52:376–384), and
 *   2.2 g for body recomposition, where its benefit plateaus (Morton; Barakat et al., *Strength
 *   Cond J* 2020;42(5):7–21).
 * - Fat 25% of calories; carbs the rest.
 *
 * Domain code: no UI, no provider SDK, no database (CLAUDE.md rules 1 and 2). Stored as slugs;
 * the display strings live in the app.
 */

export const ACTIVITY_LEVELS = ["mostly_sitting", "lightly_active", "active", "very_active", "athlete"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** Physical-activity levels, the multiple of BMR spent in an average day. */
export const ACTIVITY_LEVEL_FACTORS: Record<ActivityLevel, number> = {
  mostly_sitting: 1.4,
  lightly_active: 1.55,
  active: 1.7,
  very_active: 1.85,
  athlete: 2.0,
};

export const BODY_GOALS = ["lose_fat", "recomposition", "maintain", "build_muscle"] as const;
export type BodyGoal = (typeof BODY_GOALS)[number];

/** Each goal's change to maintenance energy (the user's percentages) and its protein per kg. */
export const BODY_GOAL_ADJUSTMENTS: Record<BodyGoal, { energyChange: number; proteinPerKg: number }> = {
  lose_fat: { energyChange: -0.15, proteinPerKg: 1.6 },
  recomposition: { energyChange: -0.05, proteinPerKg: 2.2 },
  maintain: { energyChange: 0, proteinPerKg: 1.6 },
  build_muscle: { energyChange: 0.1, proteinPerKg: 1.6 },
};

/** Fat's share of calories, the user's choice; carbs take what protein and fat leave. */
export const FAT_SHARE_OF_KCAL = 0.25;

const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

/** Calories are suggested to the nearest 10, like the approved design's 2,750. */
const roundTo10 = (kcal: number): number => Math.round(kcal / 10) * 10;

/**
 * Mifflin–St Jeor (Mifflin et al., *Am J Clin Nutr* 1990;51:241–247), the BMR fallback when there
 * is no InBody scan: 10·kg + 6.25·cm − 5·age, + 5 for men and − 161 for women. Without a stated
 * sex the midpoint of the two constants (− 78) is used, rather than guessing one.
 */
export function mifflinStJeorBmrKcal(input: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: "male" | "female" | "prefer_not_to_say" | null;
}): number {
  const constant = input.sex === "male" ? 5 : input.sex === "female" ? -161 : -78;
  return Math.round(10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears + constant);
}

export interface DailyTargets {
  maintenanceKcal: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * The least this app will ever suggest eating in a day (whole-app review 8.5, L6-1): calorie intake
 * "should not fall below 1,200 a day in women or 1,500 a day in men", except under a health
 * professional's supervision -- Harvard Health Publishing, "Calorie counting made easy", updated
 * 2024-04-03, https://www.health.harvard.edu/staying-healthy/calorie-counting-made-easy. Approved by
 * the user on 2026-09-25, with the midpoint for no stated sex, as `mifflinStJeorBmrKcal` does.
 */
export const MINIMUM_DAILY_KCAL = { female: 1200, male: 1500, unspecified: 1350 } as const;

function minimumDailyKcal(sex: "male" | "female" | "prefer_not_to_say" | null): number {
  if (sex === "female") return MINIMUM_DAILY_KCAL.female;
  if (sex === "male") return MINIMUM_DAILY_KCAL.male;
  return MINIMUM_DAILY_KCAL.unspecified;
}

export function suggestDailyTargets(input: {
  weightKg: number;
  bmrKcal: number;
  activityLevel: ActivityLevel;
  bodyGoal: BodyGoal;
  sex: "male" | "female" | "prefer_not_to_say" | null;
}): DailyTargets {
  const maintenance = input.bmrKcal * ACTIVITY_LEVEL_FACTORS[input.activityLevel];
  const goal = BODY_GOAL_ADJUSTMENTS[input.bodyGoal];
  // Raised to the minimum before the macros below are worked out, so they add up to what is shown.
  const kcal = Math.max(minimumDailyKcal(input.sex), roundTo10(maintenance * (1 + goal.energyChange)));
  const proteinG = Math.round(goal.proteinPerKg * input.weightKg);
  const fatKcal = kcal * FAT_SHARE_OF_KCAL;
  const carbsKcal = Math.max(0, kcal - proteinG * KCAL_PER_G_PROTEIN - fatKcal);
  return {
    maintenanceKcal: roundTo10(maintenance),
    kcal,
    proteinG,
    carbsG: Math.round(carbsKcal / KCAL_PER_G_CARBS),
    fatG: Math.round(fatKcal / KCAL_PER_G_FAT),
  };
}
