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
});
