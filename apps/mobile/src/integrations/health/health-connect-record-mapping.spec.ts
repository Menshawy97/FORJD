import { HEALTH_METRIC_TYPES } from "@forjd/domain";
import { SleepStageType } from "react-native-health-connect";

import {
  HEALTH_CONNECT_SUPPORTED_METRICS,
  mapActiveEnergyRecord,
  mapHeartRateRecord,
  mapHrvRecord,
  mapRespiratoryRateRecord,
  mapRestingHeartRateRecord,
  mapSleepSessionRecord,
  mapStepsRecord,
  mapVo2MaxRecord,
  mapWeightRecord,
  METRIC_TO_RECORD_TYPE,
  recordTypesFor,
} from "./health-connect-record-mapping";

/**
 * Pure mapping logic, tested with plain objects shaped like `readRecords`' real return
 * values (per the installed package's own `.d.ts` files) -- no native module, no mock, no
 * device. `health-connect.provider.spec.ts` covers the wiring around these functions;
 * this file is the actual regression guard for "does a Health Connect record turn into the
 * right canonical observation."
 */
describe("METRIC_TO_RECORD_TYPE / HEALTH_CONNECT_SUPPORTED_METRICS", () => {
  it("maps every domain metric type to a Health Connect record type", () => {
    for (const metricType of HEALTH_METRIC_TYPES) {
      expect(METRIC_TO_RECORD_TYPE[metricType]).toBeTruthy();
    }
  });

  it("declares support for the entire domain vocabulary, since every metric has a mapping", () => {
    expect(new Set(HEALTH_CONNECT_SUPPORTED_METRICS)).toEqual(new Set(HEALTH_METRIC_TYPES));
  });
});

describe("recordTypesFor", () => {
  it("collapses every sleep-stage metric type to a single SleepSession record type", () => {
    const result = recordTypesFor(["sleep_duration", "sleep_light_duration", "sleep_deep_duration"]);
    expect(result).toEqual(["SleepSession"]);
  });

  it("returns one entry per distinct record type across mixed metric types", () => {
    const result = recordTypesFor(["hrv", "steps", "sleep_duration"]);
    expect(new Set(result)).toEqual(new Set(["HeartRateVariabilityRmssd", "Steps", "SleepSession"]));
  });
});

describe("mapHeartRateRecord", () => {
  it("turns each sample into its own instantaneous observation", () => {
    const observations = mapHeartRateRecord({
      startTime: "2026-09-07T00:00:00.000Z",
      endTime: "2026-09-07T00:01:00.000Z",
      samples: [
        { time: "2026-09-07T00:00:00.000Z", beatsPerMinute: 60 },
        { time: "2026-09-07T00:01:00.000Z", beatsPerMinute: 62 },
      ],
      metadata: { id: "rec-1" },
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      metricType: "heart_rate",
      value: 60,
      unit: "bpm",
      providerRecordId: "rec-1",
    });
    expect(observations[0]?.startTime).toEqual(observations[0]?.endTime);
  });
});

describe("mapHrvRecord", () => {
  it("reads heartRateVariabilityMillis as the value in ms", () => {
    const [observation] = mapHrvRecord({ time: "2026-09-07T00:00:00.000Z", heartRateVariabilityMillis: 55 });
    expect(observation).toMatchObject({ metricType: "hrv", value: 55, unit: "ms" });
  });
});

describe("mapRestingHeartRateRecord", () => {
  it("reads beatsPerMinute as the value in bpm", () => {
    const [observation] = mapRestingHeartRateRecord({ time: "2026-09-07T00:00:00.000Z", beatsPerMinute: 48 });
    expect(observation).toMatchObject({ metricType: "resting_heart_rate", value: 48, unit: "bpm" });
  });
});

describe("mapStepsRecord", () => {
  it("reads count as the value, over the record's own interval", () => {
    const [observation] = mapStepsRecord({
      startTime: "2026-09-07T00:00:00.000Z",
      endTime: "2026-09-07T01:00:00.000Z",
      count: 1200,
    });
    expect(observation).toMatchObject({ metricType: "steps", value: 1200, unit: "steps" });
    expect(observation?.startTime).toEqual(new Date("2026-09-07T00:00:00.000Z"));
    expect(observation?.endTime).toEqual(new Date("2026-09-07T01:00:00.000Z"));
  });
});

describe("mapActiveEnergyRecord", () => {
  it("reads energy.inKilocalories, not raw joules", () => {
    const [observation] = mapActiveEnergyRecord({
      startTime: "2026-09-07T00:00:00.000Z",
      endTime: "2026-09-07T01:00:00.000Z",
      energy: { inCalories: 250000, inJoules: 1046000, inKilocalories: 250, inKilojoules: 1046 },
    });
    expect(observation).toMatchObject({ metricType: "active_energy", value: 250, unit: "kcal" });
  });
});

describe("mapWeightRecord", () => {
  it("reads weight.inKilograms, not pounds or grams", () => {
    const [observation] = mapWeightRecord({
      time: "2026-09-07T00:00:00.000Z",
      weight: { inGrams: 80000, inKilograms: 80, inMilligrams: 80000000, inMicrograms: 8e10, inOunces: 2822, inPounds: 176.4 },
    });
    expect(observation).toMatchObject({ metricType: "weight", value: 80, unit: "kg" });
  });
});

describe("mapVo2MaxRecord", () => {
  it("reads vo2MillilitersPerMinuteKilogram as the value", () => {
    const [observation] = mapVo2MaxRecord({
      time: "2026-09-07T00:00:00.000Z",
      vo2MillilitersPerMinuteKilogram: 42,
      measurementMethod: 0,
    });
    expect(observation).toMatchObject({ metricType: "vo2_max", value: 42, unit: "ml/kg/min" });
  });
});

describe("mapRespiratoryRateRecord", () => {
  it("reads rate as the value in breaths/min", () => {
    const [observation] = mapRespiratoryRateRecord({ time: "2026-09-07T00:00:00.000Z", rate: 14 });
    expect(observation).toMatchObject({ metricType: "respiratory_rate", value: 14, unit: "breaths/min" });
  });
});

describe("mapSleepSessionRecord", () => {
  it("emits sleep_duration from the session's own interval regardless of stages", () => {
    const observations = mapSleepSessionRecord({
      startTime: "2026-09-07T22:00:00.000Z",
      endTime: "2026-09-08T06:00:00.000Z",
    });

    const duration = observations.find((o) => o.metricType === "sleep_duration");
    expect(duration?.value).toBe(480);
    expect(duration?.unit).toBe("min");
  });

  it("emits one observation per AWAKE/LIGHT/DEEP/REM stage segment, in minutes", () => {
    const observations = mapSleepSessionRecord({
      startTime: "2026-09-07T22:00:00.000Z",
      endTime: "2026-09-08T06:00:00.000Z",
      stages: [
        { startTime: "2026-09-07T22:00:00.000Z", endTime: "2026-09-07T22:30:00.000Z", stage: SleepStageType.LIGHT },
        { startTime: "2026-09-07T22:30:00.000Z", endTime: "2026-09-08T00:30:00.000Z", stage: SleepStageType.DEEP },
        { startTime: "2026-09-08T00:30:00.000Z", endTime: "2026-09-08T02:00:00.000Z", stage: SleepStageType.REM },
        { startTime: "2026-09-08T02:00:00.000Z", endTime: "2026-09-08T02:05:00.000Z", stage: SleepStageType.AWAKE },
      ],
    });

    expect(observations.find((o) => o.metricType === "sleep_light_duration")?.value).toBe(30);
    expect(observations.find((o) => o.metricType === "sleep_deep_duration")?.value).toBe(120);
    expect(observations.find((o) => o.metricType === "sleep_rem_duration")?.value).toBe(90);
    expect(observations.find((o) => o.metricType === "sleep_awake_duration")?.value).toBe(5);
  });

  it("excludes SLEEPING/OUT_OF_BED/UNKNOWN stage segments from the stage breakdown", () => {
    const observations = mapSleepSessionRecord({
      startTime: "2026-09-07T22:00:00.000Z",
      endTime: "2026-09-08T06:00:00.000Z",
      stages: [
        { startTime: "2026-09-07T22:00:00.000Z", endTime: "2026-09-07T23:00:00.000Z", stage: SleepStageType.SLEEPING },
        { startTime: "2026-09-07T23:00:00.000Z", endTime: "2026-09-07T23:10:00.000Z", stage: SleepStageType.OUT_OF_BED },
        { startTime: "2026-09-07T23:10:00.000Z", endTime: "2026-09-07T23:20:00.000Z", stage: SleepStageType.UNKNOWN },
      ],
    });

    // Only sleep_duration (from the session interval itself) -- no stage-specific rows.
    expect(observations).toHaveLength(1);
    expect(observations[0]?.metricType).toBe("sleep_duration");
  });
});
