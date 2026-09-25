import { buildMacroGoalSuggestion, type MacroSuggestionInputs } from "./macro-suggestion";

/**
 * Suggested daily targets (docs/product/scan-height-age-plan.md §4.5). BMR from the latest InBody
 * scan (measured or calculated), else Mifflin–St Jeor from profile height, weight and age; weight is
 * the newest of the scans' and the health data's; the profile gives activity level and goal.
 */
describe("buildMacroGoalSuggestion", () => {
  const today = new Date("2026-09-25T12:00:00.000Z");
  const measurement = (metric: string, value: number) => ({ metric, value, unit: "", confidence: 1, calculated: false });
  const scan = (measuredAt: string, values: Record<string, number>) => ({
    id: measuredAt,
    measuredAt: new Date(measuredAt),
    source: "inbody",
    heightCm: 178,
    ageYears: 31,
    measurements: Object.entries(values).map(([metric, value]) => measurement(metric, value)),
  });
  const profile = {
    activityLevel: "active" as const,
    bodyGoal: "lose_fat" as const,
    heightCm: 178,
    dateOfBirth: "1994-09-26",
    sex: "male" as const,
  };
  const inputs = (overrides: Partial<MacroSuggestionInputs> = {}): MacroSuggestionInputs => ({
    profile,
    // Newest first, as the repository lists them.
    scans: [
      scan("2026-09-22T09:00:00.000Z", { weight_kg: 86.6, basal_metabolic_rate_kcal: 1905 }),
      scan("2026-08-22T09:00:00.000Z", { weight_kg: 87.2, basal_metabolic_rate_kcal: 1897 }),
    ],
    healthWeights: [],
    today,
    ...overrides,
  });

  it("suggests the approved design's targets from the latest scan, with every input it used", () => {
    expect(buildMacroGoalSuggestion(inputs())).toEqual({
      suggestion: { kcal: 2750, protein: 139, carbs: 377, fat: 76 },
      basis: {
        maintenanceKcal: 3240,
        bmrKcal: 1905,
        bmrSource: "scan",
        scanMeasuredAt: "2026-09-22T09:00:00.000Z",
        weightKg: 86.6,
        activityLevel: "active",
        activityFactor: 1.7,
        bodyGoal: "lose_fat",
        energyChange: -0.15,
        proteinPerKg: 1.6,
        fatShare: 0.25,
        minimumKcalApplied: null,
      },
      missing: [],
    });
  });

  it("says when the suggestion was raised to the daily minimum (review 8.5, L6-1)", () => {
    const result = buildMacroGoalSuggestion(
      inputs({
        profile: { ...profile, sex: "female", activityLevel: "mostly_sitting", heightCm: 150, dateOfBirth: "1966-09-26" },
        scans: [],
        healthWeights: [{ at: new Date("2026-09-24T07:00:00.000Z"), kg: 45 }],
      }),
    );
    expect(result.suggestion?.kcal).toBe(1200);
    expect(result.basis?.minimumKcalApplied).toBe(1200);
  });

  it("uses a newer weight from health data than the scan's", () => {
    const result = buildMacroGoalSuggestion(inputs({ healthWeights: [{ at: new Date("2026-09-24T07:00:00.000Z"), kg: 85 }] }));
    expect(result.basis?.weightKg).toBe(85);
    // 1.6 × 85 = 136 g.
    expect(result.suggestion?.protein).toBe(136);
  });

  it("falls back to Mifflin–St Jeor from the profile when there is no scan", () => {
    const result = buildMacroGoalSuggestion(
      inputs({ scans: [], healthWeights: [{ at: new Date("2026-09-24T07:00:00.000Z"), kg: 86.6 }] }),
    );
    // 10 × 86.6 + 6.25 × 178 − 5 × 31 + 5 = 1,828.5 → 1,829; age 31 until 26 Sep.
    expect(result.basis).toMatchObject({ bmrKcal: 1829, bmrSource: "estimate", scanMeasuredAt: null });
  });

  it("takes the newest scan that has a BMR", () => {
    const result = buildMacroGoalSuggestion(
      inputs({
        scans: [
          scan("2026-09-22T09:00:00.000Z", { weight_kg: 86.6 }),
          scan("2026-08-22T09:00:00.000Z", { weight_kg: 87.2, basal_metabolic_rate_kcal: 1897 }),
        ],
      }),
    );
    expect(result.basis).toMatchObject({ bmrKcal: 1897, scanMeasuredAt: "2026-08-22T09:00:00.000Z", weightKg: 86.6 });
  });

  it("says what is missing instead of guessing", () => {
    expect(buildMacroGoalSuggestion(inputs({ profile: { ...profile, activityLevel: null, bodyGoal: null } }))).toEqual({
      suggestion: null,
      basis: null,
      missing: ["activityLevel", "bodyGoal"],
    });
    expect(buildMacroGoalSuggestion(inputs({ scans: [], healthWeights: [] })).missing).toEqual(["weight", "bmr"]);
    // No scan, and no height to estimate one from.
    const noHeight = inputs({ scans: [], profile: { ...profile, heightCm: null }, healthWeights: [{ at: today, kg: 80 }] });
    expect(buildMacroGoalSuggestion(noHeight).missing).toEqual(["bmr"]);
    expect(buildMacroGoalSuggestion(inputs({ profile: null })).missing).toEqual(["activityLevel", "bodyGoal"]);
  });
});
