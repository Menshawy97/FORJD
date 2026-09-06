/**
 * Every closed body-vocabulary tuple in ./body-vocabulary.ts must have a matching entry in
 * its *DisplayName / *UNIT map — this test is the enforcement, not documentation of intent.
 * Written before the tuples exist (Phase 5A, RED first) per the standing TDD rule. Pattern
 * copied from exercise-vocabulary.spec.ts.
 */
import {
  BODY_METRICS,
  BODY_METRIC_DISPLAY_NAMES,
  BODY_METRIC_UNITS,
  SEGMENTAL_SITES,
  SEGMENTAL_SITE_DISPLAY_NAMES,
  SCAN_SOURCES,
  SCAN_SOURCE_DISPLAY_NAMES,
  CONFIDENCE_PREFILL_THRESHOLD,
  shouldPrefill,
} from "./index";

describe("body vocabulary display-name coverage", () => {
  const displayNameCases: Array<[string, readonly string[], Record<string, string>]> = [
    ["BODY_METRICS", BODY_METRICS, BODY_METRIC_DISPLAY_NAMES],
    ["SEGMENTAL_SITES", SEGMENTAL_SITES, SEGMENTAL_SITE_DISPLAY_NAMES],
    ["SCAN_SOURCES", SCAN_SOURCES, SCAN_SOURCE_DISPLAY_NAMES],
  ];

  it.each(displayNameCases)("every %s member has a non-empty display name", (_label, tuple, map) => {
    for (const member of tuple) {
      const name = map[member];
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect((name ?? "").length).toBeGreaterThan(0);
    }
  });

  it.each(displayNameCases)("%s display-name map has no orphan keys", (_label, tuple, map) => {
    const known = new Set<string>(tuple);
    for (const key of Object.keys(map)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("every BODY_METRICS member has a unit entry (empty string is valid, e.g. InBody score)", () => {
    for (const member of BODY_METRICS) {
      expect(Object.prototype.hasOwnProperty.call(BODY_METRIC_UNITS, member)).toBe(true);
      expect(typeof BODY_METRIC_UNITS[member]).toBe("string");
    }
  });

  it("BODY_METRIC_UNITS has no orphan keys", () => {
    const known = new Set<string>(BODY_METRICS);
    for (const key of Object.keys(BODY_METRIC_UNITS)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("BODY_METRICS matches the design's nine confirm-screen fields exactly", () => {
    expect(BODY_METRICS).toEqual([
      "weight_kg",
      "skeletal_muscle_mass_kg",
      "body_fat_mass_kg",
      "body_fat_percent",
      "visceral_fat_level",
      "total_body_water_l",
      "bmi",
      "basal_metabolic_rate_kcal",
      "inbody_score",
    ]);
  });

  it("SEGMENTAL_SITES matches the design's five segmental lean sites exactly", () => {
    expect(SEGMENTAL_SITES).toEqual(["right_arm", "left_arm", "trunk", "right_leg", "left_leg"]);
  });
});

describe("shouldPrefill", () => {
  it("returns false for confidence strictly below the threshold", () => {
    expect(shouldPrefill(CONFIDENCE_PREFILL_THRESHOLD - 0.01)).toBe(false);
    expect(shouldPrefill(0)).toBe(false);
  });

  it("returns true for confidence at or above the threshold", () => {
    expect(shouldPrefill(CONFIDENCE_PREFILL_THRESHOLD)).toBe(true);
    expect(shouldPrefill(1)).toBe(true);
  });

  it("the threshold is 0.9, matching the design's own visual amber cutoff", () => {
    // s_inbodyConfirm() switches the confidence bar and input border to amber at
    // exactly conf < .9 — the blank-vs-prefill decision reuses that same cutoff
    // rather than inventing a second one (see ADR-032).
    expect(CONFIDENCE_PREFILL_THRESHOLD).toBe(0.9);
  });
});
