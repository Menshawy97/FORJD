import {
  bodyMetricSchema,
  segmentalSiteSchema,
  extractBodyScanResponseSchema,
  confirmBodyScanRequestSchema,
  bodyScanResponseSchema,
  bodyScanListResponseSchema,
  bodyScanSeriesResponseSchema,
} from "./index";

const NINE_METRICS = [
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

const FIVE_SEGMENTAL_SITES = ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"] as const;

const emptySegmental = Object.fromEntries(
  FIVE_SEGMENTAL_SITES.map((s) => [s, { value: null, confidence: 0, readingNote: "" }]),
);

describe("body contracts", () => {
  it("bodyMetricSchema accepts exactly the nine confirm-screen fields", () => {
    for (const metric of NINE_METRICS) {
      expect(bodyMetricSchema.safeParse(metric).success).toBe(true);
    }
    expect(bodyMetricSchema.safeParse("not_a_real_metric").success).toBe(false);
  });

  it("extractBodyScanResponseSchema accepts a full extraction, including null fields", () => {
    const fields = Object.fromEntries(
      NINE_METRICS.map((m) => [m, { value: null, confidence: 0, readingNote: "Blurry" }]),
    );
    const response = {
      inbodyModel: "570",
      testDate: "2026-01-15",
      fields,
      segmental: emptySegmental,
      imageQualityNotes: "Blurry",
    };
    expect(extractBodyScanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("extractBodyScanResponseSchema rejects a response missing a required field", () => {
    const incompleteFields = Object.fromEntries(
      NINE_METRICS.slice(0, 8).map((m) => [m, { value: 1, confidence: 0.9, readingNote: "" }]),
    );
    const response = {
      inbodyModel: null,
      testDate: null,
      fields: incompleteFields,
      segmental: emptySegmental,
      imageQualityNotes: "",
    };
    expect(extractBodyScanResponseSchema.safeParse(response).success).toBe(false);
  });

  it("segmentalSiteSchema accepts exactly the five segmental sites", () => {
    for (const site of FIVE_SEGMENTAL_SITES) {
      expect(segmentalSiteSchema.safeParse(site).success).toBe(true);
    }
    expect(segmentalSiteSchema.safeParse("not_a_real_site").success).toBe(false);
  });

  it("confirmBodyScanRequestSchema accepts a segmental site as a measurement metric", () => {
    const payload = {
      measuredAt: "2026-01-15T09:00:00.000Z",
      measurements: [{ metric: "right_arm", value: 3.62, unit: "kg", confidence: 0.9 }],
    };
    expect(confirmBodyScanRequestSchema.safeParse(payload).success).toBe(true);
  });

  it("confirmBodyScanRequestSchema requires at least one measurement", () => {
    expect(
      confirmBodyScanRequestSchema.safeParse({ measuredAt: "2026-01-15T09:00:00.000Z", measurements: [] }).success,
    ).toBe(false);
  });

  it("confirmBodyScanRequestSchema accepts a real confirmed payload", () => {
    const payload = {
      measuredAt: "2026-01-15T09:00:00.000Z",
      measurements: [
        { metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 },
        { metric: "body_fat_percent", value: 18.2, unit: "%", confidence: 0.98 },
      ],
    };
    expect(confirmBodyScanRequestSchema.safeParse(payload).success).toBe(true);
  });

  it("confirmBodyScanRequestSchema rejects an unknown metric", () => {
    const payload = {
      measuredAt: "2026-01-15T09:00:00.000Z",
      measurements: [{ metric: "not_a_real_metric", value: 1, unit: "", confidence: 0.9 }],
    };
    expect(confirmBodyScanRequestSchema.safeParse(payload).success).toBe(false);
  });

  it("bodyScanResponseSchema accepts a confirmed scan", () => {
    const response = {
      id: "11111111-1111-1111-1111-111111111111",
      measuredAt: "2026-01-15T09:00:00.000Z",
      source: "inbody",
      measurements: [{ metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 }],
    };
    expect(bodyScanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("bodyScanListResponseSchema accepts a history list with nullable headline fields", () => {
    const response = {
      scans: [
        { id: "11111111-1111-1111-1111-111111111111", measuredAt: "2026-01-15T09:00:00.000Z", weightKg: 84.6, bodyFatPercent: null },
      ],
    };
    expect(bodyScanListResponseSchema.safeParse(response).success).toBe(true);
  });

  it("bodyScanSeriesResponseSchema accepts a per-metric time series", () => {
    const response = {
      series: [
        {
          metric: "weight_kg",
          unit: "kg",
          points: [{ measuredAt: "2026-01-15T09:00:00.000Z", value: 84.6 }],
        },
      ],
    };
    expect(bodyScanSeriesResponseSchema.safeParse(response).success).toBe(true);
  });
});
