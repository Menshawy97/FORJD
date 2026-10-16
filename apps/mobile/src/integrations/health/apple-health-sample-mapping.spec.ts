import { HEALTH_METRIC_TYPES, HEALTH_METRIC_UNITS } from "@forjd/domain";

import {
  APPLE_HEALTH_SUPPORTED_METRICS,
  QUANTITY_READS,
  SLEEP_ANALYSIS,
  SleepValue,
  mapQuantitySample,
  mapSleepSample,
  readTypesFor,
  type AppleCategorySample,
  type AppleQuantitySample,
} from "./apple-health-sample-mapping";

/**
 * ADR-068 / ADR-069. The pure half of `AppleHealthProvider`: HealthKit samples in, canonical
 * `SyncedObservation`s out (ADR-003/ADR-004: normalization is the adapter's job). No native module
 * here; the shapes are HealthKit's sample fields as `@kingstinct/react-native-healthkit` returns them.
 */
const start = new Date("2026-10-16T06:00:00.000Z");
const end = new Date("2026-10-16T06:30:00.000Z");
const source = { source: { name: "Apple Watch", bundleIdentifier: "com.apple.health.ABC" }, operatingSystemVersion: "26.0" };

function quantity(overrides: Partial<AppleQuantitySample> = {}): AppleQuantitySample {
  return {
    uuid: "q-1",
    quantity: 62,
    unit: "count/min",
    startDate: start,
    endDate: start,
    sourceRevision: source,
    device: { model: "Watch", manufacturer: "Apple Inc." },
    ...overrides,
  };
}

function sleep(value: number, overrides: Partial<AppleCategorySample> = {}): AppleCategorySample {
  return { uuid: "s-1", value, startDate: start, endDate: end, sourceRevision: source, ...overrides };
}

describe("APPLE_HEALTH_SUPPORTED_METRICS", () => {
  it("covers every canonical metric, walking heart rate included (HealthKit has it, Health Connect does not)", () => {
    expect([...APPLE_HEALTH_SUPPORTED_METRICS].sort()).toEqual([...HEALTH_METRIC_TYPES].sort());
  });
});

describe("QUANTITY_READS", () => {
  it.each([
    ["heart_rate", "HKQuantityTypeIdentifierHeartRate", "count/min"],
    ["walking_heart_rate", "HKQuantityTypeIdentifierWalkingHeartRateAverage", "count/min"],
    ["hrv", "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "ms"],
    ["resting_heart_rate", "HKQuantityTypeIdentifierRestingHeartRate", "count/min"],
    ["steps", "HKQuantityTypeIdentifierStepCount", "count"],
    ["active_energy", "HKQuantityTypeIdentifierActiveEnergyBurned", "kcal"],
    ["weight", "HKQuantityTypeIdentifierBodyMass", "kg"],
    ["vo2_max", "HKQuantityTypeIdentifierVO2Max", "ml/(kg*min)"],
    ["respiratory_rate", "HKQuantityTypeIdentifierRespiratoryRate", "count/min"],
  ] as const)("reads %s as %s in %s, so the value is already in the canonical unit", (metric, identifier, unit) => {
    expect(QUANTITY_READS[metric]).toEqual({ identifier, unit });
  });
});

describe("readTypesFor", () => {
  it("asks for each HealthKit type once, all sleep metrics sharing sleep analysis", () => {
    expect(readTypesFor(["heart_rate", "sleep_duration", "sleep_deep_duration", "heart_rate"])).toEqual([
      "HKQuantityTypeIdentifierHeartRate",
      SLEEP_ANALYSIS,
    ]);
  });
});

describe("mapQuantitySample", () => {
  it("keeps the value in the canonical unit and records where it came from (rule 10)", () => {
    expect(mapQuantitySample("heart_rate", quantity())).toEqual({
      metricType: "heart_rate",
      value: 62,
      unit: HEALTH_METRIC_UNITS.heart_rate,
      startTime: start,
      endTime: start,
      providerRecordId: "q-1",
      deviceId: "Watch",
      dataOrigin: "com.apple.health.ABC",
      quality: null,
    });
  });

  it("falls back to the manufacturer, then null, for the device", () => {
    expect(mapQuantitySample("steps", quantity({ device: { manufacturer: "Apple Inc." } }))?.deviceId).toBe("Apple Inc.");
    expect(mapQuantitySample("steps", quantity({ device: undefined }))?.deviceId).toBeNull();
  });

  it("drops a reading that is not a finite number instead of storing it", () => {
    expect(mapQuantitySample("weight", quantity({ quantity: Number.NaN }))).toBeNull();
  });
});

describe("mapSleepSample", () => {
  it.each([
    [SleepValue.asleepCore, "sleep_light_duration"],
    [SleepValue.asleepDeep, "sleep_deep_duration"],
    [SleepValue.asleepREM, "sleep_rem_duration"],
  ] as const)("turns an asleep stage (%s) into time asleep plus its stage, in minutes", (value, stageMetric) => {
    const observations = mapSleepSample(sleep(value));

    expect(observations.map((o) => o.metricType)).toEqual(["sleep_duration", stageMetric]);
    expect(observations.every((o) => o.value === 30 && o.unit === "min")).toBe(true);
    expect(observations.every((o) => o.dataOrigin === "com.apple.health.ABC")).toBe(true);
  });

  it("counts asleep with no stage as time asleep only", () => {
    expect(mapSleepSample(sleep(SleepValue.asleepUnspecified)).map((o) => o.metricType)).toEqual(["sleep_duration"]);
  });

  it("counts awake time as awake in bed, not as sleep", () => {
    expect(mapSleepSample(sleep(SleepValue.awake)).map((o) => o.metricType)).toEqual(["sleep_awake_duration"]);
  });

  it("ignores plain in-bed samples, which overlap the stages", () => {
    expect(mapSleepSample(sleep(SleepValue.inBed))).toEqual([]);
  });

  it("ignores a sample whose end is before its start", () => {
    expect(mapSleepSample(sleep(SleepValue.asleepDeep, { endDate: new Date(start.getTime() - 1) }))).toEqual([]);
  });
});
