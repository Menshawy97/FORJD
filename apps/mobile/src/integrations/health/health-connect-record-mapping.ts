import { HEALTH_METRIC_TYPES, HEALTH_METRIC_UNITS, type HealthMetricType } from "@forjd/domain";
import { SleepStageType } from "react-native-health-connect";
import type { Metadata, RecordResult, RecordType } from "react-native-health-connect";

import type { SyncedObservation } from "./health-provider.interface";

/**
 * `readRecords`'s own result rows -- `RecordResult<'HeartRate'>` etc -- are the only shapes
 * this file needs; the package's public API surface (`export * from './types'` in its own
 * `index.ts`) does not re-export the per-record `*RecordResult` interface names directly, only
 * the `RecordResult<T>` generic utility type, so every record parameter below is typed through
 * that generic rather than an unexported concrete interface name.
 */
type ActiveCaloriesBurnedRecordResult = RecordResult<"ActiveCaloriesBurned">;
type HeartRateRecordResult = RecordResult<"HeartRate">;
type HeartRateVariabilityRmssdRecordResult = RecordResult<"HeartRateVariabilityRmssd">;
type RespiratoryRateRecordResult = RecordResult<"RespiratoryRate">;
type RestingHeartRateRecordResult = RecordResult<"RestingHeartRate">;
type SleepSessionRecordResult = RecordResult<"SleepSession">;
type StepsRecordResult = RecordResult<"Steps">;
type Vo2MaxRecordResult = RecordResult<"Vo2Max">;
type WeightRecordResult = RecordResult<"Weight">;

/**
 * Pure mapping between `@forjd/domain`'s canonical vocabulary and Health Connect's own record
 * shapes, following `inbody-extraction-prompt.ts`/`inbody-response-parser.ts`'s precedent for
 * why this lives in its own file: the logic that actually matters (which Health Connect record
 * maps to which metric, and what unit conversion applies) is testable with plain objects, with
 * no native module, no mock, no device -- `health-connect.provider.ts` only wires this to the
 * library's `readRecords`/`requestPermission` calls.
 *
 * Almost every metric type in `HEALTH_METRIC_TYPES` maps to exactly one Health Connect
 * `RecordType`, except the five sleep-related types, which all read from the single
 * `SleepSession` record -- Health Connect represents sleep stages as segments within one
 * session, not as separate per-stage records, matching `health-vocabulary.ts`'s own docblock
 * on why sleep stages are modelled as separate metric types in the first place.
 *
 * **`walking_heart_rate` is the one deliberate exception**, absent from this map entirely.
 * Android's Health Connect has no equivalent record type -- its `HeartRateRecord` samples
 * carry no activity-context flag distinguishing a walking period from any other -- while
 * Apple HealthKit does have this as a native type. `Partial<Record<...>>`, not the full
 * `Record<...>`, is what lets this entry stay genuinely absent rather than forcing a made-up
 * mapping; `HEALTH_CONNECT_SUPPORTED_METRICS` and `recordTypesFor` both derive from this map's
 * actual keys, so the gap propagates correctly to `getCapabilities()` (ADR-003's "a provider
 * missing a metric degrades gracefully") instead of needing a second place to declare it.
 */
export const METRIC_TO_RECORD_TYPE: Partial<Record<HealthMetricType, RecordType>> = {
  heart_rate: "HeartRate",
  hrv: "HeartRateVariabilityRmssd",
  resting_heart_rate: "RestingHeartRate",
  sleep_duration: "SleepSession",
  sleep_light_duration: "SleepSession",
  sleep_deep_duration: "SleepSession",
  sleep_rem_duration: "SleepSession",
  sleep_awake_duration: "SleepSession",
  steps: "Steps",
  active_energy: "ActiveCaloriesBurned",
  weight: "Weight",
  vo2_max: "Vo2Max",
  respiratory_rate: "RespiratoryRate",
};

/** Every metric type this provider can actually supply -- derived from `METRIC_TO_RECORD_TYPE`'s
 *  own keys rather than restated, so a metric this provider cannot map (`walking_heart_rate`)
 *  cannot silently drift into looking supported here while staying absent from the map above. */
export const HEALTH_CONNECT_SUPPORTED_METRICS: readonly HealthMetricType[] = HEALTH_METRIC_TYPES.filter(
  (metricType) => METRIC_TO_RECORD_TYPE[metricType] !== undefined,
);

/** The distinct set of Health Connect record types to actually fetch for a set of requested
 *  metric types -- multiple sleep metric types collapse to one `SleepSession` read, so a sync
 *  requesting all five never issues the same read five times. A metric type with no mapping
 *  (`walking_heart_rate`) contributes nothing, rather than throwing -- the caller is expected
 *  to have already filtered requested permissions down to `HEALTH_CONNECT_SUPPORTED_METRICS`,
 *  but this stays defensive rather than assuming that happened. */
export function recordTypesFor(metricTypes: readonly HealthMetricType[]): RecordType[] {
  const recordTypes = metricTypes
    .map((m) => METRIC_TO_RECORD_TYPE[m])
    .filter((recordType): recordType is RecordType => recordType !== undefined);
  return Array.from(new Set(recordTypes));
}

function providerRecordId(metadata: Metadata | undefined): string | null {
  return metadata?.id ?? null;
}

function deviceId(metadata: Metadata | undefined): string | null {
  return metadata?.device?.model ?? metadata?.device?.manufacturer ?? null;
}

export function mapHeartRateRecord(record: HeartRateRecordResult): SyncedObservation[] {
  return record.samples.map((sample) => ({
    metricType: "heart_rate",
    value: sample.beatsPerMinute,
    unit: HEALTH_METRIC_UNITS.heart_rate,
    startTime: new Date(sample.time),
    endTime: new Date(sample.time),
    providerRecordId: providerRecordId(record.metadata),
    deviceId: deviceId(record.metadata),
    quality: null,
  }));
}

export function mapHrvRecord(record: HeartRateVariabilityRmssdRecordResult): SyncedObservation[] {
  const time = new Date(record.time);
  return [
    {
      metricType: "hrv",
      value: record.heartRateVariabilityMillis,
      unit: HEALTH_METRIC_UNITS.hrv,
      startTime: time,
      endTime: time,
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

export function mapRestingHeartRateRecord(record: RestingHeartRateRecordResult): SyncedObservation[] {
  const time = new Date(record.time);
  return [
    {
      metricType: "resting_heart_rate",
      value: record.beatsPerMinute,
      unit: HEALTH_METRIC_UNITS.resting_heart_rate,
      startTime: time,
      endTime: time,
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

export function mapStepsRecord(record: StepsRecordResult): SyncedObservation[] {
  return [
    {
      metricType: "steps",
      value: record.count,
      unit: HEALTH_METRIC_UNITS.steps,
      startTime: new Date(record.startTime),
      endTime: new Date(record.endTime),
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

export function mapActiveEnergyRecord(record: ActiveCaloriesBurnedRecordResult): SyncedObservation[] {
  return [
    {
      metricType: "active_energy",
      value: record.energy.inKilocalories,
      unit: HEALTH_METRIC_UNITS.active_energy,
      startTime: new Date(record.startTime),
      endTime: new Date(record.endTime),
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

export function mapWeightRecord(record: WeightRecordResult): SyncedObservation[] {
  const time = new Date(record.time);
  return [
    {
      metricType: "weight",
      value: record.weight.inKilograms,
      unit: HEALTH_METRIC_UNITS.weight,
      startTime: time,
      endTime: time,
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

export function mapVo2MaxRecord(record: Vo2MaxRecordResult): SyncedObservation[] {
  const time = new Date(record.time);
  return [
    {
      metricType: "vo2_max",
      value: record.vo2MillilitersPerMinuteKilogram,
      unit: HEALTH_METRIC_UNITS.vo2_max,
      startTime: time,
      endTime: time,
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

export function mapRespiratoryRateRecord(record: RespiratoryRateRecordResult): SyncedObservation[] {
  const time = new Date(record.time);
  return [
    {
      metricType: "respiratory_rate",
      value: record.rate,
      unit: HEALTH_METRIC_UNITS.respiratory_rate,
      startTime: time,
      endTime: time,
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];
}

const SLEEP_STAGE_METRIC: Partial<Record<number, HealthMetricType>> = {
  [SleepStageType.AWAKE]: "sleep_awake_duration",
  [SleepStageType.LIGHT]: "sleep_light_duration",
  [SleepStageType.DEEP]: "sleep_deep_duration",
  [SleepStageType.REM]: "sleep_rem_duration",
};

function durationMinutes(startTime: string, endTime: string): number {
  return (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000;
}

/**
 * One `sleep_duration` observation for the session's own interval, plus one observation per
 * stage segment whose stage is AWAKE/LIGHT/DEEP/REM -- `SLEEPING` (stage unspecified) and
 * `OUT_OF_BED`/`UNKNOWN` segments have no corresponding metric type in
 * `HEALTH_METRIC_TYPES` and are silently excluded from the stage breakdown (they still count
 * toward `sleep_duration`, which comes from the session's own start/end, not from summing
 * segments).
 */
export function mapSleepSessionRecord(record: SleepSessionRecordResult): SyncedObservation[] {
  const observations: SyncedObservation[] = [
    {
      metricType: "sleep_duration",
      value: durationMinutes(record.startTime, record.endTime),
      unit: HEALTH_METRIC_UNITS.sleep_duration,
      startTime: new Date(record.startTime),
      endTime: new Date(record.endTime),
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    },
  ];

  for (const stage of record.stages ?? []) {
    const metricType = SLEEP_STAGE_METRIC[stage.stage];
    if (!metricType) continue;

    observations.push({
      metricType,
      value: durationMinutes(stage.startTime, stage.endTime),
      unit: HEALTH_METRIC_UNITS[metricType],
      startTime: new Date(stage.startTime),
      endTime: new Date(stage.endTime),
      providerRecordId: providerRecordId(record.metadata),
      deviceId: deviceId(record.metadata),
      quality: null,
    });
  }

  return observations;
}
