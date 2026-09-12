import {
  healthMetricTypeSchema,
  healthSourceSchema,
  ingestHealthObservationSchema,
  batchIngestHealthObservationsRequestSchema,
  healthObservationResponseSchema,
  healthObservationSeriesResponseSchema,
  healthConnectionListResponseSchema,
} from "./index";

const KNOWN_METRICS = [
  "heart_rate",
  "hrv",
  "resting_heart_rate",
  "sleep_duration",
  "sleep_light_duration",
  "sleep_deep_duration",
  "sleep_rem_duration",
  "sleep_awake_duration",
  "steps",
  "active_energy",
  "weight",
  "vo2_max",
  "respiratory_rate",
] as const;

const KNOWN_SOURCES = ["health_connect", "apple_health", "whoop", "manual"] as const;

const validObservation = {
  metricType: "hrv",
  value: 62,
  unit: "ms",
  startTime: "2026-09-07T00:00:00.000Z",
  endTime: "2026-09-07T00:00:00.000Z",
  source: "health_connect",
};

describe("health contracts", () => {
  it("healthMetricTypeSchema accepts exactly the thirteen declared metric types", () => {
    for (const metric of KNOWN_METRICS) {
      expect(healthMetricTypeSchema.safeParse(metric).success).toBe(true);
    }
    expect(healthMetricTypeSchema.safeParse("skin_temperature").success).toBe(false);
  });

  it("healthSourceSchema accepts exactly the four declared sources", () => {
    for (const source of KNOWN_SOURCES) {
      expect(healthSourceSchema.safeParse(source).success).toBe(true);
    }
    expect(healthSourceSchema.safeParse("garmin").success).toBe(false);
  });

  it("ingestHealthObservationSchema accepts a minimal valid observation", () => {
    expect(ingestHealthObservationSchema.safeParse(validObservation).success).toBe(true);
  });

  it("ingestHealthObservationSchema accepts optional providerRecordId/deviceId/quality", () => {
    const full = { ...validObservation, providerRecordId: "hc-123", deviceId: "pixel-7", quality: 0.92 };
    expect(ingestHealthObservationSchema.safeParse(full).success).toBe(true);
  });

  it("ingestHealthObservationSchema accepts explicit nulls for providerRecordId/deviceId/quality", () => {
    const nulled = { ...validObservation, providerRecordId: null, deviceId: null, quality: null };
    expect(ingestHealthObservationSchema.safeParse(nulled).success).toBe(true);
  });

  it("ingestHealthObservationSchema rejects quality outside 0-1", () => {
    expect(ingestHealthObservationSchema.safeParse({ ...validObservation, quality: 1.5 }).success).toBe(false);
    expect(ingestHealthObservationSchema.safeParse({ ...validObservation, quality: -0.1 }).success).toBe(false);
  });

  it("ingestHealthObservationSchema does not accept a client-supplied id, userId, or createdAt", () => {
    // The server owns these -- z.object without .strict() silently drops unknown keys on
    // parse, which is the actual enforcement: assert the parsed output never carries them
    // through, not just that the input "looks accepted".
    const withForbiddenFields = {
      ...validObservation,
      id: "forged-id",
      userId: "someone-elses-user-id",
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    const result = ingestHealthObservationSchema.parse(withForbiddenFields);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("createdAt");
  });

  it("ingestHealthObservationSchema rejects an unknown metric type or source", () => {
    expect(ingestHealthObservationSchema.safeParse({ ...validObservation, metricType: "skin_temperature" }).success).toBe(
      false,
    );
    expect(ingestHealthObservationSchema.safeParse({ ...validObservation, source: "garmin" }).success).toBe(false);
  });

  it("batchIngestHealthObservationsRequestSchema requires at least one observation", () => {
    expect(batchIngestHealthObservationsRequestSchema.safeParse({ observations: [] }).success).toBe(false);
    expect(
      batchIngestHealthObservationsRequestSchema.safeParse({ observations: [validObservation] }).success,
    ).toBe(true);
  });

  it("batchIngestHealthObservationsRequestSchema accepts a real sync-sized batch", () => {
    const batch = { observations: Array.from({ length: 50 }, () => validObservation) };
    expect(batchIngestHealthObservationsRequestSchema.safeParse(batch).success).toBe(true);
  });

  it("healthObservationResponseSchema omits provider-internal fields even if present on the input object", () => {
    const raw = { ...validObservation, providerRecordId: "hc-123", deviceId: "pixel-7", quality: 0.9 };
    const result = healthObservationResponseSchema.parse(raw);
    expect(result).not.toHaveProperty("providerRecordId");
    expect(result).not.toHaveProperty("deviceId");
    expect(result).not.toHaveProperty("quality");
    expect(result).not.toHaveProperty("id");
  });

  it("healthObservationSeriesResponseSchema accepts an empty series (no metric measured yet)", () => {
    expect(healthObservationSeriesResponseSchema.safeParse({ series: [] }).success).toBe(true);
  });

  it("healthObservationSeriesResponseSchema accepts one entry per measured metric type", () => {
    const response = {
      series: [
        { metricType: "hrv", unit: "ms", points: [{ startTime: "2026-09-07T00:00:00.000Z", value: 62 }] },
        { metricType: "steps", unit: "steps", points: [] },
      ],
    };
    expect(healthObservationSeriesResponseSchema.safeParse(response).success).toBe(true);
  });

  it("healthConnectionListResponseSchema accepts a connection with a null sync checkpoint", () => {
    const response = { connections: [{ source: "health_connect", lastSuccessfulSyncAt: null }] };
    expect(healthConnectionListResponseSchema.safeParse(response).success).toBe(true);
  });

  it("healthConnectionListResponseSchema accepts multiple connected providers", () => {
    const response = {
      connections: [
        { source: "health_connect", lastSuccessfulSyncAt: "2026-09-07T00:00:00.000Z" },
        { source: "whoop", lastSuccessfulSyncAt: null },
      ],
    };
    expect(healthConnectionListResponseSchema.safeParse(response).success).toBe(true);
  });

  // R10 -- physiological bounds at the contract boundary. `value: z.number()` with no bounds
  // fed `Math.log(0) = -Infinity` into readiness and let a corrupt row (a 5000 kg body scan,
  // a 900,000 kcal meal) into aggregates unnoticed. Ranges below are documented on the schema
  // itself alongside the citation each one is sourced from.
  describe("per-metric physiological bounds", () => {
    const withMetric = (metricType: string, value: number) => ({ ...validObservation, metricType, value });

    it.each([
      ["heart_rate", 20, 300],
      ["walking_heart_rate", 20, 300],
      ["resting_heart_rate", 20, 200],
      ["hrv", 1, 300],
      ["respiratory_rate", 4, 60],
      ["sleep_duration", 0, 1440],
      ["sleep_light_duration", 0, 1440],
      ["sleep_deep_duration", 0, 1440],
      ["sleep_rem_duration", 0, 1440],
      ["sleep_awake_duration", 0, 1440],
      ["steps", 0, 200_000],
      ["active_energy", 0, 20_000],
      ["weight", 20, 500],
      ["vo2_max", 10, 95],
    ])("accepts %s at both ends of its documented range (%d - %d)", (metricType, min, max) => {
      expect(ingestHealthObservationSchema.safeParse(withMetric(metricType, min)).success).toBe(true);
      expect(ingestHealthObservationSchema.safeParse(withMetric(metricType, max)).success).toBe(true);
    });

    it.each([
      ["heart_rate", 19, 301],
      ["resting_heart_rate", 19, 201],
      ["respiratory_rate", 3, 61],
      ["sleep_duration", -1, 1441],
      ["weight", 19, 501],
      ["vo2_max", 9, 96],
    ])("rejects %s outside its documented range (below %d, above %d)", (metricType, tooLow, tooHigh) => {
      expect(ingestHealthObservationSchema.safeParse(withMetric(metricType, tooLow)).success).toBe(false);
      expect(ingestHealthObservationSchema.safeParse(withMetric(metricType, tooHigh)).success).toBe(false);
    });

    it("rejects zero for hrv -- the one metric readiness log-transforms (Math.log(0) = -Infinity)", () => {
      expect(ingestHealthObservationSchema.safeParse(withMetric("hrv", 0)).success).toBe(false);
    });

    it("accepts zero sleep duration -- a real night can have zero minutes of a given stage", () => {
      expect(ingestHealthObservationSchema.safeParse(withMetric("sleep_deep_duration", 0)).success).toBe(true);
    });
  });

  it("batchIngestHealthObservationsRequestSchema caps the batch at 1000 observations", () => {
    const tooMany = { observations: Array.from({ length: 1001 }, () => ({ ...validObservation })) };
    expect(batchIngestHealthObservationsRequestSchema.safeParse(tooMany).success).toBe(false);

    const atCap = { observations: Array.from({ length: 1000 }, () => ({ ...validObservation })) };
    expect(batchIngestHealthObservationsRequestSchema.safeParse(atCap).success).toBe(true);
  });
});
