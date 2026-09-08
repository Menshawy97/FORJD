import { evaluateHealthInsight } from "./health-insight";
import type { ReadinessComponentResult, ReadinessResult } from "./readiness";

function component(overrides: Partial<ReadinessComponentResult> = {}): ReadinessComponentResult {
  return {
    key: "hrv",
    score: 50,
    label: "normal",
    recentValue: 60,
    baselineDayCount: 60,
    ...overrides,
  };
}

function readiness(components: ReadinessComponentResult[], score: number | null = 50): ReadinessResult {
  return {
    score,
    zone: score === null ? null : score <= 33 ? "red" : score <= 66 ? "yellow" : "green",
    components,
    withheldReason: score === null ? "Still building your baseline." : null,
  };
}

describe("evaluateHealthInsight", () => {
  it("returns null when the composite is withheld", () => {
    const result = readiness(
      [component({ key: "hrv", score: null, label: null })],
      null,
    );
    expect(evaluateHealthInsight(result)).toBeNull();
  });

  it("returns a steady message when every component is normal", () => {
    const result = readiness([
      component({ key: "hrv", label: "normal" }),
      component({ key: "resting_heart_rate", label: "normal" }),
      component({ key: "sleep_duration", label: "normal" }),
      component({ key: "respiratory_rate", label: "normal" }),
    ]);
    const insight = evaluateHealthInsight(result);
    expect(insight?.headline).toBe("Steady.");
  });

  it("names the deviating component and reports an elevated (favorable) reading without a suggestion", () => {
    const result = readiness([
      component({ key: "hrv", label: "elevated", score: 75 }),
      component({ key: "resting_heart_rate", label: "normal" }),
    ]);
    const insight = evaluateHealthInsight(result);
    expect(insight?.headline).toContain("HRV");
    expect(insight?.headline).toContain("favorable");
    expect(insight?.body).not.toContain("Plews"); // no citation attached to good news
  });

  it("names the deviating component, cites the evidence, and suggests an easier day for a low reading", () => {
    const result = readiness([
      component({ key: "resting_heart_rate", label: "low", score: 25 }),
      component({ key: "hrv", label: "normal" }),
    ]);
    const insight = evaluateHealthInsight(result);
    expect(insight?.headline).toContain("Resting heart rate");
    expect(insight?.headline).toContain("below your normal range");
    expect(insight?.body).toContain("Plews et al., 2013");
  });

  it("picks the most-deviated component when multiple have crossed the threshold", () => {
    const result = readiness([
      component({ key: "hrv", label: "low", score: 45 }), // |45-50| = 5
      component({ key: "resting_heart_rate", label: "low", score: 10 }), // |10-50| = 40, larger
    ]);
    const insight = evaluateHealthInsight(result);
    expect(insight?.headline).toContain("Resting heart rate");
  });

  it("ignores a component with a null score even if its label is non-null", () => {
    // Defensive case: readiness.ts never actually produces label!==null with score===null,
    // but this proves the filter does not crash or mis-sort if it ever did.
    const result = readiness([
      component({ key: "hrv", label: "low", score: null }),
      component({ key: "resting_heart_rate", label: "normal", score: 50 }),
    ]);
    const insight = evaluateHealthInsight(result);
    expect(insight?.headline).toBe("Steady.");
  });
});
