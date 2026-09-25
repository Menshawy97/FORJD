import {
  bodyMetricSchema,
  segmentalSiteSchema,
  extractBodyScanResponseSchema,
  confirmBodyScanRequestSchema,
  bodyScanResponseSchema,
  bodyScanListResponseSchema,
  bodyScanSeriesResponseSchema,
  createManualBodyScanRequestSchema,
  measurementBounds,
  SCAN_AGE_YEARS_BOUNDS,
  SCAN_HEIGHT_CM_BOUNDS,
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

  // R10 -- the audit's own example: a 5000 kg body scan was accepted and corrupted every
  // aggregate that read it back. Bounds are generous but reject obvious corruption.
  describe("per-metric physiological bounds on confirmed measurements", () => {
    const withMeasurement = (metric: string, value: number) => ({
      measuredAt: "2026-01-15T09:00:00.000Z",
      measurements: [{ metric, value, unit: "kg", confidence: 0.9 }],
    });

    it.each([
      ["weight_kg", 20, 400],
      ["skeletal_muscle_mass_kg", 5, 100],
      ["body_fat_mass_kg", 1, 200],
      ["body_fat_percent", 2, 70],
      ["visceral_fat_level", 1, 30],
      ["total_body_water_l", 5, 100],
      ["bmi", 10, 80],
      ["basal_metabolic_rate_kcal", 500, 5000],
      ["inbody_score", 0, 100],
      ["right_arm", 0.5, 50],
      ["trunk", 0.5, 90],
    ])("accepts %s at both ends of its documented range (%d - %d)", (metric, min, max) => {
      expect(confirmBodyScanRequestSchema.safeParse(withMeasurement(metric, min)).success).toBe(true);
      expect(confirmBodyScanRequestSchema.safeParse(withMeasurement(metric, max)).success).toBe(true);
    });

    it("rejects a 5000 kg body scan -- the audit's own corrupting example", () => {
      expect(confirmBodyScanRequestSchema.safeParse(withMeasurement("weight_kg", 5000)).success).toBe(false);
    });

    it("rejects a body-fat percentage above 100", () => {
      expect(confirmBodyScanRequestSchema.safeParse(withMeasurement("body_fat_percent", 150)).success).toBe(false);
    });
  });

  it("bodyScanResponseSchema accepts a confirmed scan", () => {
    const response = {
      id: "11111111-1111-1111-1111-111111111111",
      measuredAt: "2026-01-15T09:00:00.000Z",
      source: "inbody",
      heightCm: 178,
      ageYears: 31,
      measurements: [{ metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 }],
    };
    expect(bodyScanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("bodyScanListResponseSchema accepts a history list with nullable headline fields", () => {
    const response = {
      scans: [
        { id: "11111111-1111-1111-1111-111111111111", measuredAt: "2026-01-15T09:00:00.000Z", source: "inbody", weightKg: 84.6, bodyFatPercent: null },
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

/**
 * Manual entry (docs/product/manual-inbody-entry-plan.md): the user types values in with no
 * photo. Only weight is required (the user's choice; body fat % became optional on
 * 2026-09-25); the rest are optional and bounded exactly like a confirmed scan's values.
 */
describe("createManualBodyScanRequestSchema", () => {
  const request = (measurements: Array<{ metric: string; value: number; unit: string }>) => ({
    measuredAt: "2026-09-24T09:15:00.000Z",
    measurements,
  });
  const weight = { metric: "weight_kg", value: 82.4, unit: "kg" };
  const bodyFat = { metric: "body_fat_percent", value: 12.1, unit: "%" };

  it("accepts weight and body fat % on their own", () => {
    expect(createManualBodyScanRequestSchema.safeParse(request([weight, bodyFat])).success).toBe(true);
  });

  it("accepts optional values and segmental masses alongside them", () => {
    const result = createManualBodyScanRequestSchema.safeParse(
      request([weight, bodyFat, { metric: "skeletal_muscle_mass_kg", value: 41.8, unit: "kg" }, { metric: "trunk", value: 25, unit: "kg" }]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a request without weight", () => {
    expect(createManualBodyScanRequestSchema.safeParse(request([bodyFat])).success).toBe(false);
  });

  // The user's rule (2026-09-25): body fat % is optional; only weight is required.
  it("accepts weight on its own, without body fat %", () => {
    expect(createManualBodyScanRequestSchema.safeParse(request([weight])).success).toBe(true);
  });

  it("rejects the same metric twice", () => {
    expect(createManualBodyScanRequestSchema.safeParse(request([weight, bodyFat, weight])).success).toBe(false);
  });

  it("applies the same physiological bounds as a confirmed scan", () => {
    expect(createManualBodyScanRequestSchema.safeParse(request([{ ...weight, value: 5000 }, bodyFat])).success).toBe(false);
  });

  it("carries no confidence: the user typed every value", () => {
    const parsed = createManualBodyScanRequestSchema.parse(request([{ ...weight, confidence: 0.2 } as never, bodyFat]));
    expect(parsed.measurements[0]).not.toHaveProperty("confidence");
  });
});

describe("scan source on the history list", () => {
  it("accepts a manual scan summary and reports its source", () => {
    const list = {
      scans: [
        { id: "11111111-1111-1111-1111-111111111111", measuredAt: "2026-09-24T09:15:00.000Z", source: "manual", weightKg: 82.4, bodyFatPercent: 12.1 },
      ],
    };
    expect(bodyScanListResponseSchema.parse(list).scans[0]?.source).toBe("manual");
  });

  it("requires the source, so the app can always tell a manual entry from a scan", () => {
    const list = {
      scans: [{ id: "11111111-1111-1111-1111-111111111111", measuredAt: "2026-09-24T09:15:00.000Z", weightKg: 82.4, bodyFatPercent: 12.1 }],
    };
    expect(bodyScanListResponseSchema.safeParse(list).success).toBe(false);
  });
});

/**
 * Device report: a real InBody 120 sheet printed trunk lean mass 30.5 kg and the save was
 * rejected -- the trunk ceiling was 30 kg, which a muscular adult's trunk routinely exceeds.
 */
describe("segmental lean mass bounds", () => {
  it("accepts the real sheet's 30.5 kg trunk, and a large athlete's 45 kg", () => {
    for (const value of [30.5, 45]) {
      const result = confirmBodyScanRequestSchema.safeParse({
        measuredAt: "2026-01-15T09:00:00.000Z",
        measurements: [{ metric: "trunk", value, unit: "kg", confidence: 0.99 }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("still rejects an impossible trunk mass", () => {
    const result = confirmBodyScanRequestSchema.safeParse({
      measuredAt: "2026-01-15T09:00:00.000Z",
      measurements: [{ metric: "trunk", value: 300, unit: "kg", confidence: 0.99 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("measurementBounds", () => {
  it("returns the range a value breaks, so the app can say which field and why", () => {
    expect(measurementBounds("weight_kg", 5000)).toEqual([20, 400]);
    expect(measurementBounds("trunk", 30.5)).toBeNull();
    expect(measurementBounds("weight_kg", 82.4)).toBeNull();
  });
});

/**
 * Height and age on a scan (docs/product/scan-height-age-plan.md §2). Stored on the scan itself,
 * never as BODY_METRICS rows, so they never become Body-tab trend lines. Optional on the two
 * create requests until the app sends them (slice C makes them required, in the same PR as the
 * screens), nullable on every read because scans saved before this change have neither.
 */
describe("scan height and age", () => {
  const confirm = (extra: Record<string, unknown>) => ({
    measuredAt: "2026-09-25T09:00:00.000Z",
    measurements: [{ metric: "weight_kg", value: 82.4, unit: "kg", confidence: 0.97 }],
    ...extra,
  });
  const manual = (extra: Record<string, unknown>) => ({
    measuredAt: "2026-09-25T09:00:00.000Z",
    measurements: [
      { metric: "weight_kg", value: 82.4, unit: "kg" },
      { metric: "body_fat_percent", value: 12.1, unit: "%" },
    ],
    ...extra,
  });
  const issue = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }, field: string) =>
    result.error?.issues.find((i) => i.path[0] === field)?.message;

  it("uses 100-250 cm and the account minimum age (16) to 110 years", () => {
    expect(SCAN_HEIGHT_CM_BOUNDS).toEqual([100, 250]);
    expect(SCAN_AGE_YEARS_BOUNDS).toEqual([16, 110]);
  });

  it.each([
    ["confirm", confirmBodyScanRequestSchema, confirm],
    ["manual", createManualBodyScanRequestSchema, manual],
  ] as const)("%s request carries height and age through", (_label, schema, build) => {
    const parsed = schema.parse(build({ heightCm: 178.5, ageYears: 31 }));
    expect(parsed.heightCm).toBe(178.5);
    expect(parsed.ageYears).toBe(31);
  });

  it.each([
    ["confirm", confirmBodyScanRequestSchema, confirm],
    ["manual", createManualBodyScanRequestSchema, manual],
  ] as const)("%s request still saves without them, so today's app keeps working until slice C", (_label, schema, build) => {
    expect(schema.safeParse(build({})).success).toBe(true);
  });

  it.each([
    ["confirm", confirmBodyScanRequestSchema, confirm],
    ["manual", createManualBodyScanRequestSchema, manual],
  ] as const)("%s request names the field and its range when height is out of bounds", (_label, schema, build) => {
    for (const heightCm of [99.9, 250.1]) {
      const result = schema.safeParse(build({ heightCm, ageYears: 31 }));
      expect(result.success).toBe(false);
      expect(issue(result, "heightCm")).toBe("heightCm must be between 100 and 250");
    }
  });

  it.each([
    ["confirm", confirmBodyScanRequestSchema, confirm],
    ["manual", createManualBodyScanRequestSchema, manual],
  ] as const)("%s request names the field and its range when age is out of bounds", (_label, schema, build) => {
    for (const ageYears of [15, 111]) {
      const result = schema.safeParse(build({ heightCm: 178, ageYears }));
      expect(result.success).toBe(false);
      expect(issue(result, "ageYears")).toBe("ageYears must be between 16 and 110");
    }
  });

  it("rejects a fractional age: the sheet prints whole years and the column is a smallint", () => {
    const result = confirmBodyScanRequestSchema.safeParse(confirm({ heightCm: 178, ageYears: 31.5 }));
    expect(result.success).toBe(false);
    expect(issue(result, "ageYears")).toBe("ageYears must be a whole number of years");
  });

  it("returns both as null for a scan saved before this change", () => {
    const response = {
      id: "11111111-1111-1111-1111-111111111111",
      measuredAt: "2026-01-15T09:00:00.000Z",
      source: "manual",
      heightCm: null,
      ageYears: null,
      measurements: [{ metric: "weight_kg", value: 84.6, unit: "kg", confidence: 1 }],
    };
    expect(bodyScanResponseSchema.safeParse(response).success).toBe(true);
  });

  it("always states them on a read, even when null, so a client never guesses", () => {
    const response = {
      id: "11111111-1111-1111-1111-111111111111",
      measuredAt: "2026-01-15T09:00:00.000Z",
      source: "inbody",
      measurements: [{ metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 }],
    };
    expect(bodyScanResponseSchema.safeParse(response).success).toBe(false);
  });
});
