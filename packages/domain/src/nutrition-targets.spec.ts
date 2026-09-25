import {
  ACTIVITY_LEVELS,
  ACTIVITY_LEVEL_FACTORS,
  BODY_GOALS,
  BODY_GOAL_ADJUSTMENTS,
  mifflinStJeorBmrKcal,
  suggestDailyTargets,
} from "./nutrition-targets";

/**
 * Suggested daily targets (docs/product/scan-height-age-plan.md §4.5, answered and designed with
 * the user on 2026-09-25). Energy = BMR × activity factor (FAO/WHO/UNU 2004), adjusted for the goal;
 * protein per kg of body weight; fat 25% of calories; carbs the rest.
 */
describe("activity levels and body goals", () => {
  it("are the five approved activity levels, with their factors", () => {
    expect(ACTIVITY_LEVELS).toEqual(["mostly_sitting", "lightly_active", "active", "very_active", "athlete"]);
    expect(ACTIVITY_LEVEL_FACTORS).toEqual({
      mostly_sitting: 1.4,
      lightly_active: 1.55,
      active: 1.7,
      very_active: 1.85,
      athlete: 2.0,
    });
  });

  it("are the four approved goals, each with its energy change and protein per kg", () => {
    expect(BODY_GOALS).toEqual(["lose_fat", "recomposition", "maintain", "build_muscle"]);
    expect(BODY_GOAL_ADJUSTMENTS).toEqual({
      lose_fat: { energyChange: -0.15, proteinPerKg: 1.6 },
      recomposition: { energyChange: -0.05, proteinPerKg: 2.2 },
      maintain: { energyChange: 0, proteinPerKg: 1.6 },
      build_muscle: { energyChange: 0.1, proteinPerKg: 1.6 },
    });
  });
});

describe("mifflinStJeorBmrKcal", () => {
  it("is 10·kg + 6.25·cm − 5·age + 5 for men and − 161 for women (Mifflin et al. 1990)", () => {
    // 10 × 86.6 + 6.25 × 178 − 5 × 31 + 5 = 1,828.5
    expect(mifflinStJeorBmrKcal({ weightKg: 86.6, heightCm: 178, ageYears: 31, sex: "male" })).toBe(1829);
    // 10 × 60 + 6.25 × 165 − 5 × 30 − 161 = 1,320.25
    expect(mifflinStJeorBmrKcal({ weightKg: 60, heightCm: 165, ageYears: 30, sex: "female" })).toBe(1320);
  });

  it("uses the midpoint of the two constants (− 78) when sex is not given", () => {
    // 10 × 70 + 6.25 × 175 − 5 × 30 − 78 = 1,565.75
    expect(mifflinStJeorBmrKcal({ weightKg: 70, heightCm: 175, ageYears: 30, sex: "prefer_not_to_say" })).toBe(1566);
    expect(mifflinStJeorBmrKcal({ weightKg: 70, heightCm: 175, ageYears: 30, sex: null })).toBe(1566);
  });
});

describe("suggestDailyTargets", () => {
  const omar = { weightKg: 86.6, bmrKcal: 1905, activityLevel: "active" as const, sex: "male" as const };

  it("matches the approved design for losing fat: 2,750 kcal · protein 139 g · carbs 377 g · fat 76 g", () => {
    // 1,905 × 1.7 = 3,238.5 maintenance; −15% = 2,752.7 → 2,750. Protein 1.6 × 86.6 = 139 g.
    // Fat 25% of 2,750 = 687.5 kcal = 76 g. Carbs (2,750 − 556 − 687.5) ÷ 4 = 376.6 → 377 g.
    expect(suggestDailyTargets({ ...omar, bodyGoal: "lose_fat" })).toEqual({
      maintenanceKcal: 3240,
      kcal: 2750,
      proteinG: 139,
      carbsG: 377,
      fatG: 76,
      minimumApplied: null,
    });
  });

  it("matches the approved design for body recomposition: 3,080 kcal · 191 g · 387 g · 86 g", () => {
    // 3,238.5 − 5% = 3,076.6 → 3,080. Protein 2.2 × 86.6 = 190.5 → 191 g (764 kcal).
    // Fat 770 kcal = 86 g. Carbs (3,080 − 764 − 770) ÷ 4 = 386.5 → 387 g.
    expect(suggestDailyTargets({ ...omar, bodyGoal: "recomposition" })).toEqual({
      maintenanceKcal: 3240,
      kcal: 3080,
      proteinG: 191,
      carbsG: 387,
      fatG: 86,
      minimumApplied: null,
    });
  });

  it("eats at maintenance to maintain, and 10% over it to build muscle", () => {
    expect(suggestDailyTargets({ ...omar, bodyGoal: "maintain" }).kcal).toBe(3240);
    // 3,238.5 × 1.1 = 3,562.4 → 3,560.
    expect(suggestDailyTargets({ ...omar, bodyGoal: "build_muscle" }).kcal).toBe(3560);
  });

  it("never leaves carbs negative", () => {
    // A very high protein share on a low energy budget: carbs floor at zero.
    const tiny = suggestDailyTargets({
      weightKg: 150,
      bmrKcal: 900,
      activityLevel: "mostly_sitting",
      bodyGoal: "recomposition",
      sex: null,
    });
    expect(tiny.carbsG).toBe(0);
  });
});

/**
 * Whole-app review 8.5, L6-1. Never suggest less than 1,200 kcal a day for women or 1,500 for men,
 * the minimum Harvard Health Publishing gives without a health professional's supervision
 * ("Calorie counting made easy", updated 2024-04-03), approved by the user on 2026-09-25. With no
 * stated sex, the midpoint (1,350), as Mifflin-St Jeor's own unknown-sex case does.
 */
describe("suggestDailyTargets minimum calories", () => {
  // 45 kg, 150 cm, 60 y woman: BMR 927; × 1.4 = 1,298 maintenance; −15% → 1,100 before the floor.
  const smallAndSitting = { weightKg: 45, bmrKcal: 927, activityLevel: "mostly_sitting" as const, bodyGoal: "lose_fat" as const };

  it("never suggests less than 1,200 kcal for a woman", () => {
    expect(suggestDailyTargets({ ...smallAndSitting, sex: "female" }).kcal).toBe(1200);
  });

  it("never suggests less than 1,500 kcal for a man", () => {
    expect(suggestDailyTargets({ ...smallAndSitting, sex: "male" }).kcal).toBe(1500);
  });

  it.each([null, "prefer_not_to_say"] as const)("uses the midpoint, 1,350 kcal, when sex is %s", (sex) => {
    expect(suggestDailyTargets({ ...smallAndSitting, sex }).kcal).toBe(1350);
  });

  it("works out fat and carbs from the raised target, not the one below the floor", () => {
    // 1,200 kcal: protein 1.6 × 45 = 72 g (288 kcal); fat 25% = 300 kcal = 33 g; carbs (1,200 − 288 − 300) ÷ 4 = 153 g.
    expect(suggestDailyTargets({ ...smallAndSitting, sex: "female" })).toEqual({
      maintenanceKcal: 1300,
      kcal: 1200,
      proteinG: 72,
      carbsG: 153,
      fatG: 33,
      minimumApplied: 1200,
    });
  });

  it("leaves a target already above the minimum untouched", () => {
    expect(suggestDailyTargets({ ...smallAndSitting, bodyGoal: "maintain", sex: "female" }).kcal).toBe(1300);
  });
});
