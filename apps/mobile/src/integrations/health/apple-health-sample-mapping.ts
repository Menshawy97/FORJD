import { HEALTH_METRIC_TYPES, HEALTH_METRIC_UNITS } from "@forjd/domain";
import type { HealthMetricType, SyncedObservation } from "@forjd/domain";

/**
 * ADR-068 / ADR-069. The pure half of `AppleHealthProvider`: which HealthKit type answers each
 * canonical metric, and how a HealthKit sample becomes a `SyncedObservation` (ADR-003/ADR-004:
 * normalization is the adapter's job). No runtime import from the HealthKit library, so this file is
 * safe anywhere and tested without a native module; the provider passes samples in.
 *
 * Two differences from Health Connect, recorded because readiness compares values over time
 * (ADR-031). Each observation keeps its source (rule 10), so they are never mixed silently:
 * - **HRV is SDNN on Apple, RMSSD on Health Connect.** Both are in ms but are different measures;
 *   a baseline must not mix the two sources.
 * - **`sleep_duration` is time asleep on Apple** (one reading per asleep segment), where Health
 *   Connect reports the whole sleep session. HealthKit has no session, only stage segments.
 */

/** The fields of a HealthKit quantity sample this mapping reads. */
export interface AppleQuantitySample {
  readonly uuid: string;
  readonly quantity: number;
  readonly unit: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly sourceRevision?: { readonly source?: { readonly bundleIdentifier?: string } };
  readonly device?: { readonly model?: string; readonly manufacturer?: string };
}

/** The fields of a HealthKit category sample (sleep analysis) this mapping reads. */
export interface AppleCategorySample {
  readonly uuid: string;
  readonly value: number;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly sourceRevision?: AppleQuantitySample["sourceRevision"];
  readonly device?: AppleQuantitySample["device"];
}

/** HealthKit's identifier for sleep: one category type, its value naming the stage. */
export const SLEEP_ANALYSIS = "HKCategoryTypeIdentifierSleepAnalysis";

/** `HKCategoryValueSleepAnalysis` raw values (Apple's documented constants, iOS 16+ stages). */
export const SleepValue = {
  inBed: 0,
  asleepUnspecified: 1,
  awake: 2,
  asleepCore: 3,
  asleepDeep: 4,
  asleepREM: 5,
} as const;

/**
 * Each quantity metric's HealthKit type, read in the unit that already equals the canonical one
 * (`HEALTH_METRIC_UNITS`), so no conversion happens here: HealthKit converts on its side.
 */
export const QUANTITY_READS: Partial<Record<HealthMetricType, { identifier: string; unit: string }>> = {
  heart_rate: { identifier: "HKQuantityTypeIdentifierHeartRate", unit: "count/min" },
  walking_heart_rate: { identifier: "HKQuantityTypeIdentifierWalkingHeartRateAverage", unit: "count/min" },
  hrv: { identifier: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", unit: "ms" },
  resting_heart_rate: { identifier: "HKQuantityTypeIdentifierRestingHeartRate", unit: "count/min" },
  steps: { identifier: "HKQuantityTypeIdentifierStepCount", unit: "count" },
  active_energy: { identifier: "HKQuantityTypeIdentifierActiveEnergyBurned", unit: "kcal" },
  weight: { identifier: "HKQuantityTypeIdentifierBodyMass", unit: "kg" },
  vo2_max: { identifier: "HKQuantityTypeIdentifierVO2Max", unit: "ml/(kg*min)" },
  respiratory_rate: { identifier: "HKQuantityTypeIdentifierRespiratoryRate", unit: "count/min" },
};

const SLEEP_METRICS: readonly HealthMetricType[] = [
  "sleep_duration",
  "sleep_light_duration",
  "sleep_deep_duration",
  "sleep_rem_duration",
  "sleep_awake_duration",
];

/** Every canonical metric: HealthKit has a type for each, walking heart rate included. */
export const APPLE_HEALTH_SUPPORTED_METRICS: readonly HealthMetricType[] = HEALTH_METRIC_TYPES.filter(
  (metric) => QUANTITY_READS[metric] !== undefined || SLEEP_METRICS.includes(metric),
);

/** The HealthKit type behind one metric, or undefined when it has none. */
export function readTypeFor(metric: HealthMetricType): string | undefined {
  return QUANTITY_READS[metric]?.identifier ?? (SLEEP_METRICS.includes(metric) ? SLEEP_ANALYSIS : undefined);
}

/** The HealthKit types to ask for, each once, in the order first needed. */
export function readTypesFor(metrics: readonly HealthMetricType[]): string[] {
  const types = metrics.map(readTypeFor).filter((type): type is string => type !== undefined);
  return Array.from(new Set(types));
}

type Provenance = Pick<SyncedObservation, "providerRecordId" | "deviceId" | "dataOrigin" | "quality">;

/** Where a reading came from, recorded explicitly (rule 10): the app that wrote it and the device. */
function provenance(sample: AppleQuantitySample | AppleCategorySample): Provenance {
  return {
    providerRecordId: sample.uuid,
    deviceId: sample.device?.model ?? sample.device?.manufacturer ?? null,
    dataOrigin: sample.sourceRevision?.source?.bundleIdentifier ?? null,
    quality: null,
  };
}

/** One quantity sample as a canonical reading, or null when its value is not a finite number. */
export function mapQuantitySample(metric: HealthMetricType, sample: AppleQuantitySample): SyncedObservation | null {
  if (!Number.isFinite(sample.quantity)) return null;
  return {
    metricType: metric,
    value: sample.quantity,
    unit: HEALTH_METRIC_UNITS[metric],
    startTime: sample.startDate,
    endTime: sample.endDate,
    ...provenance(sample),
  };
}

const STAGE_METRIC: Partial<Record<number, HealthMetricType>> = {
  [SleepValue.asleepCore]: "sleep_light_duration",
  [SleepValue.asleepDeep]: "sleep_deep_duration",
  [SleepValue.asleepREM]: "sleep_rem_duration",
};

const ASLEEP = new Set<number>([SleepValue.asleepUnspecified, SleepValue.asleepCore, SleepValue.asleepDeep, SleepValue.asleepREM]);

/**
 * One sleep segment as canonical readings, in minutes: an asleep segment gives time asleep plus its
 * stage (core counts as light, Apple's own equivalence); awake gives time awake in bed; plain in-bed
 * samples overlap the stages and are skipped, as is a segment that ends before it starts.
 */
export function mapSleepSample(sample: AppleCategorySample): SyncedObservation[] {
  const minutes = (sample.endDate.getTime() - sample.startDate.getTime()) / 60_000;
  if (!(minutes >= 0)) return [];

  const metrics: HealthMetricType[] = [];
  if (ASLEEP.has(sample.value)) metrics.push("sleep_duration");
  const stage = STAGE_METRIC[sample.value];
  if (stage) metrics.push(stage);
  if (sample.value === SleepValue.awake) metrics.push("sleep_awake_duration");

  return metrics.map((metricType) => ({
    metricType,
    value: minutes,
    unit: HEALTH_METRIC_UNITS[metricType],
    startTime: sample.startDate,
    endTime: sample.endDate,
    ...provenance(sample),
  }));
}
