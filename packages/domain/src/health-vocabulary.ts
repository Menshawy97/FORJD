/**
 * Canonical health-observation vocabulary (Phase 6). Same `as const` tuple + display-name
 * map pattern as `body-vocabulary.ts` / `workout-vocabulary.ts` -- `@forjd/contracts` builds
 * `z.enum(...)` from these tuples, so drift between the domain and the wire is
 * unrepresentable, and the UI never hardcodes a label.
 *
 * `HEALTH_METRIC_TYPES` backs `health_observations.metric_type` -- a `text` column, never a
 * Postgres enum, for the same reason every other closed vocabulary in this package gives:
 * a new metric type (a wearable starts reporting skin temperature) is then a tuple edit, not
 * a migration.
 *
 * This file is pure TypeScript with no imports beyond this package, enforced by CI's
 * conformance check (CLAUDE.md rules 1-2).
 *
 * @see docs/architecture/health-data.md -- the `HealthObservation` shape and the
 *      read-time source-priority reconciliation policy this file encodes as data.
 * @see docs/decisions/ADR-031-readiness-score-methodology.md -- why the four sleep-stage
 *      duration types and `respiratory_rate` are here from the start, not retrofitted.
 */

/**
 * The provider-agnostic metric vocabulary `health-data.md` names verbatim (`heart_rate`,
 * `hrv`, `resting_heart_rate`, `sleep_duration`, `steps`, `active_energy`, `weight`,
 * `vo2_max`, `respiratory_rate`), plus four sleep-stage duration types. ADR-031's
 * consequence section is explicit that the four-input, sleep-window readiness approach
 * "implies Phase 6 needs sleep-stage ... data types from Health Connect / HealthKit, not
 * just HRV and steps" -- `sleep_duration` alone cannot express that, since "sleep
 * performance" depends on how much of the night was deep/REM sleep versus merely lying
 * awake in bed. Modelled as one metric type per stage (matching how Health Connect's own
 * API represents sleep-stage segments) rather than a second dimension on the observation,
 * since `HealthObservation` has no such dimension and adding one would widen every provider
 * adapter's normalization for a need only sleep has.
 */
export const HEALTH_METRIC_TYPES = [
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
export type HealthMetricType = (typeof HEALTH_METRIC_TYPES)[number];

export const HEALTH_METRIC_TYPE_DISPLAY_NAMES: Record<HealthMetricType, string> = {
  heart_rate: "Heart rate",
  hrv: "Heart rate variability",
  resting_heart_rate: "Resting heart rate",
  sleep_duration: "Sleep duration",
  sleep_light_duration: "Light sleep",
  sleep_deep_duration: "Deep sleep",
  sleep_rem_duration: "REM sleep",
  sleep_awake_duration: "Awake in bed",
  steps: "Steps",
  active_energy: "Active energy",
  weight: "Weight",
  vo2_max: "VO2 max",
  respiratory_rate: "Respiratory rate",
};

/**
 * Canonical storage unit per metric -- what every provider adapter must normalize *to*
 * before a `HealthObservation` row is written, mirroring `docs/decisions/ADR-016`'s
 * "storage is always metric" rule for workout weights/distances. A display-unit toggle, if
 * one is ever needed here, converts at the read boundary the same way
 * `unit-conversion.ts` already does for weight and distance -- never at write time.
 */
export const HEALTH_METRIC_UNITS: Record<HealthMetricType, string> = {
  heart_rate: "bpm",
  hrv: "ms",
  resting_heart_rate: "bpm",
  sleep_duration: "min",
  sleep_light_duration: "min",
  sleep_deep_duration: "min",
  sleep_rem_duration: "min",
  sleep_awake_duration: "min",
  steps: "steps",
  active_energy: "kcal",
  weight: "kg",
  vo2_max: "ml/kg/min",
  respiratory_rate: "breaths/min",
};

/**
 * The providers this vocabulary is scoped to today: the three named with a committed phase
 * in `docs/architecture/integrations.md`'s build order (`HealthConnectProvider` here in
 * Phase 6, `WhoopProvider` in Phase 7, `AppleHealthProvider` in Phase 11), plus `manual` for
 * a user-entered reading -- the fourth source `docs/architecture/system.md`'s own diagram
 * names alongside the provider adapters. Garmin/Oura/Fitbit are mentioned in
 * `integrations.md` as "and beyond" with no committed phase, so they are deliberately not
 * added here yet (YAGNI) -- widening this tuple when one of them actually gets built is a
 * tuple edit, not a migration, same as every other closed vocabulary in this package.
 *
 * Deliberately does not include `"inbody"`: that is `body-vocabulary.ts`'s `SCAN_SOURCES`,
 * naming the source of a `body_scans`/`body_measurements` row, a different table with its
 * own extraction pipeline (ADR-032). A future cross-table reconciliation of `weight` between
 * the two tables, if `health-data.md`'s own worked example is taken literally, is a decision
 * for whichever phase actually builds that read path -- not assumed here.
 */
export const HEALTH_SOURCES = ["health_connect", "apple_health", "whoop", "manual"] as const;
export type HealthSource = (typeof HEALTH_SOURCES)[number];

export const HEALTH_SOURCE_DISPLAY_NAMES: Record<HealthSource, string> = {
  health_connect: "Health Connect",
  apple_health: "Apple Health",
  whoop: "WHOOP",
  manual: "Manual entry",
};

/**
 * Canonical observation shape, verbatim from `docs/architecture/health-data.md`:
 * `id, user_id, metric_type, value, unit, start_time, end_time, source,
 * provider_record_id, device_id, quality, created_at`.
 *
 * `unit` is carried on every row (not implied from `metric_type` via
 * `HEALTH_METRIC_UNITS`) so a row is self-describing even if the canonical unit for a
 * metric type is ever revised -- the same reasoning `ExtractedMeasurement` in the InBody
 * pipeline already applies to per-field metadata.
 */
export interface HealthObservation {
  id: string;
  userId: string;
  metricType: HealthMetricType;
  value: number;
  unit: string;
  startTime: Date;
  /** Equal to `startTime` for an instantaneous reading (e.g. a single heart-rate sample). */
  endTime: Date;
  source: HealthSource;
  /**
   * The id the provider itself assigns to this record, used for sync dedup where the
   * provider supplies one. `null` when a provider has no stable per-record id (or for a
   * `manual` entry, which has none by definition).
   */
  providerRecordId: string | null;
  /** `null` when the provider does not report which physical device recorded the value. */
  deviceId: string | null;
  /**
   * Provider-reported confidence/quality of the reading, `0-1`, or `null` when the provider
   * does not report one. Distinct from a *duplicate* reading from a second provider
   * (`source` is what disambiguates those) -- this is one provider's own confidence in its
   * single reading.
   */
  quality: number | null;
  createdAt: Date;
}

/**
 * Per-metric source-priority policy, as data -- never hardcoded branching -- per
 * `health-data.md`'s explicit instruction to build this reconciliation layer "when the
 * first provider ships (Phase 6), even though there's nothing to reconcile yet," because
 * retrofitting it once WHOOP (Phase 7) arrives means backfilling. Each entry lists sources
 * in descending priority; a metric type not listed here has no declared preference yet and
 * `resolveByPriority` falls back to the most recent observation for it.
 *
 * Values are the doc's own worked examples (`HRV: 1. WHOOP 2. Apple Health / Health
 * Connect`, `Steps: 1. Health Connect 2. Apple Health`) plus the same ordering applied to
 * every other metric this phase introduces, on the same stated rationale: a dedicated
 * chest-strap/wearable reading (WHOOP) outranks a phone-and-watch aggregator (Health
 * Connect / Apple Health), which outranks nothing else being available.
 *
 * `weight` is deliberately absent, not merely low-priority: this vocabulary's own docblock
 * above notes that reconciling it against `body-vocabulary.ts`'s InBody-sourced weight
 * measurements (`health-data.md`'s worked example lists `Weight: 1. InBody 2. Apple Health /
 * Health Connect`) is a decision for whichever phase actually builds that cross-table read
 * path -- picking an ordering between just Health Connect and Apple Health now would
 * misrepresent that as settled.
 */
export const HEALTH_SOURCE_PRIORITY: Partial<Record<HealthMetricType, readonly HealthSource[]>> = {
  hrv: ["whoop", "health_connect", "apple_health"],
  resting_heart_rate: ["whoop", "health_connect", "apple_health"],
  heart_rate: ["whoop", "health_connect", "apple_health"],
  respiratory_rate: ["whoop", "health_connect", "apple_health"],
  sleep_duration: ["whoop", "health_connect", "apple_health"],
  sleep_light_duration: ["whoop", "health_connect", "apple_health"],
  sleep_deep_duration: ["whoop", "health_connect", "apple_health"],
  sleep_rem_duration: ["whoop", "health_connect", "apple_health"],
  sleep_awake_duration: ["whoop", "health_connect", "apple_health"],
  steps: ["health_connect", "apple_health"],
  active_energy: ["health_connect", "apple_health"],
  vo2_max: ["health_connect", "apple_health"],
};

/**
 * Picks the observation to show for one metric type, at one point in time, from a set of
 * same-window candidates already narrowed to non-`manual`-overridden duplicates -- the read
 * side of `health-data.md`'s "source is preserved, never overwritten" rule. A `manual` entry
 * always wins over every provider (the athlete typing in a number is a deliberate
 * correction, never a lower-priority duplicate to be reconciled away); otherwise the first
 * candidate whose source appears in `HEALTH_SOURCE_PRIORITY[metricType]` wins, and a metric
 * type with no declared policy (or no candidate matching any listed source) falls back to
 * the most recently created candidate, so an unlisted metric still degrades gracefully
 * instead of silently returning nothing.
 */
export function resolveByPriority(
  metricType: HealthMetricType,
  candidates: readonly HealthObservation[],
): HealthObservation | null {
  if (candidates.length === 0) return null;

  const manual = candidates.find((c) => c.source === "manual");
  if (manual) return manual;

  const priority = HEALTH_SOURCE_PRIORITY[metricType];
  if (priority) {
    for (const source of priority) {
      const match = candidates.find((c) => c.source === source);
      if (match) return match;
    }
  }

  return [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}
