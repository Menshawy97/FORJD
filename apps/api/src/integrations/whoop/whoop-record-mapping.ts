import type { SyncedObservation } from "@forjd/domain";

/**
 * Pure WHOOP v2 record -> `SyncedObservation[]` mapping -- the normalization ADR-004 warns
 * is where an integration's data actually corrupts silently if untested. Field names and
 * units below are taken verbatim from WHOOP's own developer docs (confirmed during Phase 7
 * planning, see `docs/product/phase-7-plan.md`'s metric-mapping table), not guessed.
 *
 * Every function returns `[]` for an unscored record (`score_state !== "SCORED"`, `score`
 * absent) -- WHOOP's own docs describe `PENDING_SCORE`/`UNSCORABLE` states where the score
 * object is not populated; there is nothing to map yet, and returning `[]` rather than
 * throwing lets a webhook handler (Phase 7F) upsert nothing this delivery and simply wait
 * for a later `*.updated` event once WHOOP finishes scoring it.
 *
 * `deviceId` and `quality` are always `null` -- WHOOP's v2 API exposes neither a per-record
 * device identifier nor a 0-1 confidence value anywhere in these three object shapes.
 *
 * **`providerRecordId` is composed with the metric type, e.g. `"93845:hrv"`.**
 * `health_observations`' idempotent-reingest index is `(user_id, source, provider_record_id)`
 * -- it says nothing about `metric_type`, because every source before WHOOP has one metric
 * per provider record (Health Connect's `HrvRecord`/`HeartRateRecord`/etc. are already
 * split one-per-metric). A WHOOP recovery yields two metrics from one `cycle_id`, and a
 * WHOOP sleep yields six from one `id` -- upserting them in the same batch with an
 * unqualified shared id makes Postgres reject the whole statement ("ON CONFLICT DO UPDATE
 * command cannot affect row a second time"), caught by `whoop.e2e-spec.ts` hitting a real
 * database, not by any mocked-repository unit test. Suffixing the id per metric is the fix
 * that fits inside the existing schema/index without a migration.
 */

const MILLISECONDS_PER_MINUTE = 60_000;
/** 1 kcal = 4.184 kJ, the standard thermochemical conversion factor. */
const KILOJOULES_PER_KILOCALORIE = 4.184;

function providerRecordIdFor(recordId: string | number, metricType: string): string {
  return `${recordId}:${metricType}`;
}

interface WhoopRecoveryScore {
  resting_heart_rate: number;
  hrv_rmssd_milli: number;
}

interface WhoopRecovery {
  cycle_id: number;
  created_at: string;
  score_state: string;
  score?: WhoopRecoveryScore;
}

/**
 * Recovery has no field of its own named "id" in WHOOP's v2 schema -- `cycle_id` is the
 * stable identifier a recovery is naturally keyed by (WHOOP's own recovery endpoint is
 * `GET /v2/cycle/{cycleId}/recovery`), so it is what dedup keys off for re-delivered
 * webhooks. `created_at` is the one WHOOP-supplied instant for when the score was computed;
 * used as both `startTime` and `endTime`, matching `health_observations`' own convention for
 * an instantaneous reading.
 */
export function mapRecoveryToObservations(recovery: WhoopRecovery): SyncedObservation[] {
  if (recovery.score_state !== "SCORED" || !recovery.score) {
    return [];
  }

  const at = new Date(recovery.created_at);

  return [
    {
      metricType: "hrv",
      value: recovery.score.hrv_rmssd_milli,
      unit: "ms",
      startTime: at,
      endTime: at,
      providerRecordId: providerRecordIdFor(recovery.cycle_id, "hrv"),
      deviceId: null,
      quality: null,
    },
    {
      metricType: "resting_heart_rate",
      value: recovery.score.resting_heart_rate,
      unit: "bpm",
      startTime: at,
      endTime: at,
      providerRecordId: providerRecordIdFor(recovery.cycle_id, "resting_heart_rate"),
      deviceId: null,
      quality: null,
    },
  ];
}

interface WhoopSleepStageSummary {
  total_awake_time_milli: number;
  total_light_sleep_time_milli: number;
  total_slow_wave_sleep_time_milli: number;
  total_rem_sleep_time_milli: number;
}

interface WhoopSleepScore {
  stage_summary: WhoopSleepStageSummary;
  respiratory_rate: number;
}

interface WhoopSleep {
  id: string;
  start: string;
  end: string;
  score_state: string;
  score?: WhoopSleepScore;
}

/**
 * `sleep_duration` (the canonical "how long did they actually sleep" metric) is derived as
 * light + deep (WHOOP's "slow wave") + REM -- deliberately excluding both awake time and
 * no-data time, rather than `total_in_bed_time_milli`, since time spent lying awake in bed
 * is not sleep. This mirrors the plan's own worked mapping table.
 */
export function mapSleepToObservations(sleep: WhoopSleep): SyncedObservation[] {
  if (sleep.score_state !== "SCORED" || !sleep.score) {
    return [];
  }

  const stages = sleep.score.stage_summary;
  const startTime = new Date(sleep.start);
  const endTime = new Date(sleep.end);

  const asMinutes = (milliseconds: number) => milliseconds / MILLISECONDS_PER_MINUTE;
  const totalAsleepMilli =
    stages.total_light_sleep_time_milli + stages.total_slow_wave_sleep_time_milli + stages.total_rem_sleep_time_milli;

  const base = { startTime, endTime, deviceId: null, quality: null } as const;
  const withId = (metricType: string) => providerRecordIdFor(sleep.id, metricType);

  return [
    {
      ...base,
      metricType: "sleep_light_duration",
      value: asMinutes(stages.total_light_sleep_time_milli),
      unit: "min",
      providerRecordId: withId("sleep_light_duration"),
    },
    {
      ...base,
      metricType: "sleep_deep_duration",
      value: asMinutes(stages.total_slow_wave_sleep_time_milli),
      unit: "min",
      providerRecordId: withId("sleep_deep_duration"),
    },
    {
      ...base,
      metricType: "sleep_rem_duration",
      value: asMinutes(stages.total_rem_sleep_time_milli),
      unit: "min",
      providerRecordId: withId("sleep_rem_duration"),
    },
    {
      ...base,
      metricType: "sleep_awake_duration",
      value: asMinutes(stages.total_awake_time_milli),
      unit: "min",
      providerRecordId: withId("sleep_awake_duration"),
    },
    {
      ...base,
      metricType: "sleep_duration",
      value: asMinutes(totalAsleepMilli),
      unit: "min",
      providerRecordId: withId("sleep_duration"),
    },
    {
      ...base,
      metricType: "respiratory_rate",
      value: sleep.score.respiratory_rate,
      unit: "breaths/min",
      providerRecordId: withId("respiratory_rate"),
    },
  ];
}

interface WhoopWorkoutScore {
  kilojoule: number;
}

interface WhoopWorkout {
  id: string;
  start: string;
  end: string;
  score_state: string;
  score?: WhoopWorkoutScore;
}

/**
 * WHOOP reports workout energy in kilojoules; `active_energy`'s canonical unit is kcal
 * (`HEALTH_METRIC_UNITS` in `@forjd/domain`) -- converted here, at the adapter boundary, per
 * ADR-003/ADR-004's rule that normalization is the adapter's job, not the caller's.
 */
export function mapWorkoutToObservations(workout: WhoopWorkout): SyncedObservation[] {
  if (workout.score_state !== "SCORED" || !workout.score) {
    return [];
  }

  return [
    {
      metricType: "active_energy",
      value: workout.score.kilojoule / KILOJOULES_PER_KILOCALORIE,
      unit: "kcal",
      startTime: new Date(workout.start),
      endTime: new Date(workout.end),
      providerRecordId: providerRecordIdFor(workout.id, "active_energy"),
      deviceId: null,
      quality: null,
    },
  ];
}
