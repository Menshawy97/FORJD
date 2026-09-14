import { HEALTH_METRIC_TYPES, HEALTH_SOURCES } from '@forjd/domain';
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Health (Phase 6). @forjd/domain's HEALTH_METRIC_TYPES / HEALTH_SOURCES tuples are the source
// of truth for the closed sets; this file only needs a z.enum(...) here to stay in sync, same
// pattern as Body/Workouts above.
// ---------------------------------------------------------------------------------------------

export const healthMetricTypeSchema = z.enum(HEALTH_METRIC_TYPES);
export const healthSourceSchema = z.enum(HEALTH_SOURCES);

/**
 * R10 (medium finding): `value: z.number()` with no bounds fed `Math.log(0) = -Infinity`
 * into `packages/domain/src/readiness.ts` and let a corrupt reading into every downstream
 * aggregate unnoticed. `[min, max]` per metric, generous enough to cover real extremes
 * (elite athletes, medical outliers) without accepting obvious corruption. Sourced from
 * standard physiological reference ranges (AHA heart-rate guidance; rMSSD HRV ranges as
 * used in Plews et al. 2013, already cited in readiness.ts; normal adult respiratory rate
 * 12-20/min widened to 4-60 to cover measured extremes during/after exercise; sleep-stage
 * minutes bounded by one calendar day; elite-endurance VO2max tops out around 90-95
 * ml/kg/min). `hrv`'s lower bound is 1, not 0 -- see readiness.ts's own `Math.log` guard for
 * why zero specifically must never reach that calculation.
 */
const HEALTH_METRIC_VALUE_BOUNDS: Partial<Record<(typeof HEALTH_METRIC_TYPES)[number], [number, number]>> = {
  heart_rate: [20, 300],
  walking_heart_rate: [20, 300],
  resting_heart_rate: [20, 200],
  hrv: [1, 300],
  respiratory_rate: [4, 60],
  sleep_duration: [0, 1440],
  sleep_light_duration: [0, 1440],
  sleep_deep_duration: [0, 1440],
  sleep_rem_duration: [0, 1440],
  sleep_awake_duration: [0, 1440],
  steps: [0, 200_000],
  active_energy: [0, 20_000],
  weight: [20, 500],
  vo2_max: [10, 95],
};

/**
 * One observation to ingest, sent to `POST /health-data/observations`. Deliberately does
 * NOT accept `id`, `userId`, or `createdAt` -- the server owns all three (the athlete
 * authenticated by JWT is always the owner, and a client-supplied id/createdAt would be a
 * forgeable claim about who recorded the reading and when), the same division
 * `createExerciseRequestSchema` draws around fields the server already owns elsewhere in
 * this file. `value`/`unit` arrive already normalized to @forjd/domain's canonical unit --
 * that conversion is the provider adapter's job (ADR-003/ADR-004), not this contract's.
 */
export const ingestHealthObservationSchema = z
  .object({
    metricType: healthMetricTypeSchema,
    value: z.number(),
    unit: z.string().min(1),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    source: healthSourceSchema,
    providerRecordId: z.string().nullable().optional(),
    deviceId: z.string().nullable().optional(),
    quality: z.number().min(0).max(1).nullable().optional(),
  })
  .superRefine((observation, ctx) => {
    const bounds = HEALTH_METRIC_VALUE_BOUNDS[observation.metricType];
    if (!bounds) return;
    const [min, max] = bounds;
    if (observation.value < min || observation.value > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${observation.metricType} must be between ${min} and ${max}`,
      });
    }
  });
export type IngestHealthObservation = z.infer<typeof ingestHealthObservationSchema>;

/** Request body for `POST /health-data/observations` -- one sync batch from a provider
 *  adapter. A batch, not one-observation-per-request, because a single Health Connect sync
 *  call routinely returns many readings and per-observation round trips would not scale.
 *  `.max(1000)`: an explicit cap rather than relying solely on the framework's ~100kb body
 *  default (R10) -- generous for a real incremental sync, far short of a request built to
 *  exhaust memory or DB time on this endpoint. */
export const batchIngestHealthObservationsRequestSchema = z.object({
  observations: z.array(ingestHealthObservationSchema).min(1).max(1000),
});
export type BatchIngestHealthObservationsRequest = z.infer<typeof batchIngestHealthObservationsRequestSchema>;

/** One observation as returned to a client -- the source-priority-resolved winner for its
 *  metric type and time window, per health-data.md's read-time reconciliation policy.
 *  Internal bookkeeping fields (providerRecordId, deviceId, quality, the row's own id) are
 *  deliberately omitted; nothing in the mobile UI needs them today (YAGNI), and omitting
 *  them keeps this response shape independent of exactly which provider won. */
export const healthObservationResponseSchema = z.object({
  metricType: healthMetricTypeSchema,
  value: z.number(),
  unit: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  source: healthSourceSchema,
});
export type HealthObservationResponse = z.infer<typeof healthObservationResponseSchema>;

export const healthMetricSeriesPointSchema = z.object({
  startTime: z.string().datetime(),
  value: z.number(),
});
export const healthMetricSeriesSchema = z.object({
  metricType: healthMetricTypeSchema,
  unit: z.string(),
  points: z.array(healthMetricSeriesPointSchema),
});
export type HealthMetricSeries = z.infer<typeof healthMetricSeriesSchema>;

/** Response for `GET /health-data/observations/series`. One entry per metric type that has
 *  at least one observation in range -- an unmeasured metric is simply absent, not an empty
 *  array, mirroring `bodyScanSeriesResponseSchema`'s "never measured" vs "measured but
 *  flat" distinction. */
export const healthObservationSeriesResponseSchema = z.object({
  series: z.array(healthMetricSeriesSchema),
});
export type HealthObservationSeriesResponse = z.infer<typeof healthObservationSeriesResponseSchema>;

/**
 * Query params for `GET /health-data/observations/series` -- R8 (audit finding H4): the old
 * handler read a user's *entire* observation history into memory with no metric, time, or row
 * bound. Every field here is optional (absence means "no filter" for `metricTypes`/`since`,
 * matching `exerciseListQuerySchema`'s "no all sentinel" convention), except `limit`, which
 * `.default(...)` always supplies -- so even a client that sends nothing still gets a bounded
 * read, matching the repository's own `ObservationsWindow`, whose fields are all mandatory.
 *
 * `metricTypes` arrives as a single repeated query key (`?metricTypes=hrv&metricTypes=steps`),
 * which Express/Nest already parses into an array; the `z.preprocess` below only normalizes
 * the single-value case (`?metricTypes=hrv`), which arrives as a bare string instead.
 */
export const healthObservationSeriesQuerySchema = z.object({
  metricTypes: z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(healthMetricTypeSchema).min(1).optional(),
  ),
  since: z.string().datetime().optional(),
  /** Bounded at 5000 and rejected rather than clamped, same reasoning as
   *  `exerciseListQuerySchema.limit`. */
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});
export type HealthObservationSeriesQuery = z.infer<typeof healthObservationSeriesQuerySchema>;

/** One provider connection's state, as returned by `GET /health-data/connections`. */
export const healthConnectionResponseSchema = z.object({
  source: healthSourceSchema,
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
});
export type HealthConnectionResponse = z.infer<typeof healthConnectionResponseSchema>;

export const healthConnectionListResponseSchema = z.object({
  connections: z.array(healthConnectionResponseSchema),
});
export type HealthConnectionListResponse = z.infer<typeof healthConnectionListResponseSchema>;

/**
 * `GET /health-data/readiness` -- ADR-031's accepted methodology
 * (`@forjd/domain`'s `computeReadiness`), computed server-side since it needs up to ~67 days
 * of history per component, far more than a single series fetch is meant to carry. Mirrors
 * `computeReadiness`'s own `ReadinessResult`/`ReadinessComponentResult` shapes field-for-field
 * -- this is a read model, not a second definition of the algorithm's output.
 */
export const readinessComponentKeySchema = z.enum(["hrv", "resting_heart_rate", "sleep_duration", "respiratory_rate"]);
export const readinessComponentLabelSchema = z.enum(["low", "normal", "elevated"]);
export const readinessZoneSchema = z.enum(["red", "yellow", "green"]);

export const readinessComponentResponseSchema = z.object({
  key: readinessComponentKeySchema,
  score: z.number().min(0).max(100).nullable(),
  label: readinessComponentLabelSchema.nullable(),
  recentValue: z.number().nullable(),
  baselineDayCount: z.number().int().min(0),
});

export const readinessResponseSchema = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  zone: readinessZoneSchema.nullable(),
  components: z.array(readinessComponentResponseSchema),
  withheldReason: z.string().nullable(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/** `timeZone` is required for the same reason `workoutStatsQuerySchema`/
 *  `progressStrengthQuerySchema` require it -- readiness buckets observations by *local*
 *  calendar day (ADR-031's daily readings), and the server has no other way to know which
 *  day a late-evening reading belongs to. */
export const readinessQuerySchema = z.object({
  timeZone: z
    .string()
    .min(1)
    .max(64)
    .refine(
      (zone) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Unknown IANA time zone' },
    )
    .default('UTC'),
});
export type ReadinessQuery = z.infer<typeof readinessQuerySchema>;
