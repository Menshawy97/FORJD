import { BODY_METRICS, SCAN_SOURCES, SEGMENTAL_SITES } from '@forjd/domain';
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Body (Phase 5, InBody) -- built from body-vocabulary.ts's tuples, so a metric added there
// only needs a z.enum(...) here to stay in sync, same pattern as Workouts above.
// ---------------------------------------------------------------------------------------------

export const bodyMetricSchema = z.enum(BODY_METRICS);
export const segmentalSiteSchema = z.enum(SEGMENTAL_SITES);
export const scanSourceSchema = z.enum(SCAN_SOURCES);

/**
 * One field's reading from `POST /body-scans/extract`. `value` is nullable -- either the
 * sheet doesn't print this field, or the vision model could not read it -- and pre-filling
 * is a client-side decision (`shouldPrefill` in @forjd/domain), not something this schema
 * encodes as true/false, so a future change to the threshold needs no contract change.
 */
export const extractedMeasurementSchema = z.object({
  value: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  readingNote: z.string(),
});
export type ExtractedMeasurement = z.infer<typeof extractedMeasurementSchema>;

/**
 * Response for `POST /body-scans/extract`. Deliberately saves nothing -- see
 * `docs/architecture/health-data.md`'s "nothing saves unconfirmed" rule -- this response
 * only ever backs the confirm screen, never a stored record on its own.
 */
export const extractBodyScanResponseSchema = z.object({
  inbodyModel: z.string().nullable(),
  testDate: z.string().nullable(),
  fields: z.object(
    Object.fromEntries(BODY_METRICS.map((metric) => [metric, extractedMeasurementSchema])) as Record<
      (typeof BODY_METRICS)[number],
      typeof extractedMeasurementSchema
    >,
  ),
  /** The confirm screen's "Segmental lean analysis" section -- always kg, no confidence
   *  bar shown in the UI, but the extraction confidence still governs pre-fill. */
  segmental: z.object(
    Object.fromEntries(SEGMENTAL_SITES.map((site) => [site, extractedMeasurementSchema])) as Record<
      (typeof SEGMENTAL_SITES)[number],
      typeof extractedMeasurementSchema
    >,
  ),
  imageQualityNotes: z.string(),
});
export type ExtractBodyScanResponse = z.infer<typeof extractBodyScanResponseSchema>;

/** One field the user has confirmed, sent to `POST /body-scans`. `value` is required here
 *  (unlike `extractedMeasurementSchema`) -- a field the user left blank is simply absent
 *  from this array, never sent as a confirmed null. `metric` accepts either a BODY_METRICS
 *  entry or a segmental site -- both are stored the same way (`body_measurements.metric` is
 *  free text), so the wire shape does not need two parallel arrays. */
/**
 * R10: the audit's own example was a 5000 kg body scan, accepted with no bound and corrupting
 * every aggregate that read it back. `[min, max]` per metric/segmental site, generous enough
 * for real extremes without accepting obvious corruption -- an InBody device's own published
 * measurement ranges plus a wide margin.
 */
const BODY_MEASUREMENT_VALUE_BOUNDS: Partial<
  Record<(typeof BODY_METRICS)[number] | (typeof SEGMENTAL_SITES)[number], [number, number]>
> = {
  weight_kg: [20, 400],
  skeletal_muscle_mass_kg: [5, 100],
  body_fat_mass_kg: [1, 200],
  body_fat_percent: [2, 70],
  visceral_fat_level: [1, 30],
  total_body_water_l: [5, 100],
  bmi: [10, 80],
  basal_metabolic_rate_kcal: [500, 5000],
  inbody_score: [0, 100],
  right_arm: [0.5, 30],
  left_arm: [0.5, 30],
  trunk: [0.5, 30],
  right_leg: [0.5, 30],
  left_leg: [0.5, 30],
};

export const confirmedMeasurementSchema = z
  .object({
    metric: z.union([bodyMetricSchema, segmentalSiteSchema]),
    value: z.number(),
    unit: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((measurement, ctx) => {
    const bounds = BODY_MEASUREMENT_VALUE_BOUNDS[measurement.metric];
    if (!bounds) return;
    const [min, max] = bounds;
    if (measurement.value < min || measurement.value > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${measurement.metric} must be between ${min} and ${max}`,
      });
    }
  });
export type ConfirmedMeasurement = z.infer<typeof confirmedMeasurementSchema>;

/**
 * Request body for `POST /body-scans`, sent as a multipart `data` field (JSON string)
 * alongside the same photo re-sent as the `file` part -- the extract step stores nothing,
 * so there is no server-side reference to finalize; the confirm step's photo upload is a
 * second, independent write.
 */
export const confirmBodyScanRequestSchema = z.object({
  measuredAt: z.string().datetime(),
  // .max(): BODY_METRICS + SEGMENTAL_SITES together are 14 possible entries -- a real scan
  // never needs more, so an explicit cap (R10) closes the framework-body-size-default as the
  // only backstop.
  measurements: z.array(confirmedMeasurementSchema).min(1).max(20),
});
export type ConfirmBodyScanRequest = z.infer<typeof confirmBodyScanRequestSchema>;

export const bodyMeasurementResponseSchema = z.object({
  metric: z.union([bodyMetricSchema, segmentalSiteSchema]),
  value: z.number(),
  unit: z.string(),
  confidence: z.number(),
});
export type BodyMeasurementResponse = z.infer<typeof bodyMeasurementResponseSchema>;

/** A single confirmed scan, as returned by `POST /body-scans` and `GET /body-scans/:id`. */
export const bodyScanResponseSchema = z.object({
  id: z.string().uuid(),
  measuredAt: z.string().datetime(),
  source: scanSourceSchema,
  measurements: z.array(bodyMeasurementResponseSchema),
});
export type BodyScanResponse = z.infer<typeof bodyScanResponseSchema>;

/** One row of `GET /body-scans` -- the history list. Lighter than the full scan: a headline
 *  weight + body-fat pair, matching the design's scan-history row, not every measurement. */
export const bodyScanSummarySchema = z.object({
  id: z.string().uuid(),
  measuredAt: z.string().datetime(),
  weightKg: z.number().nullable(),
  bodyFatPercent: z.number().nullable(),
});
export type BodyScanSummary = z.infer<typeof bodyScanSummarySchema>;

export const bodyScanListResponseSchema = z.object({
  scans: z.array(bodyScanSummarySchema),
});
export type BodyScanListResponse = z.infer<typeof bodyScanListResponseSchema>;

/** One metric's time series for the Progress Body tab's sparkline cards. */
export const bodyMetricSeriesPointSchema = z.object({
  measuredAt: z.string().datetime(),
  value: z.number(),
});
export const bodyMetricSeriesSchema = z.object({
  metric: z.union([bodyMetricSchema, segmentalSiteSchema]),
  unit: z.string(),
  points: z.array(bodyMetricSeriesPointSchema),
});
export type BodyMetricSeries = z.infer<typeof bodyMetricSeriesSchema>;

/** Response for `GET /body-scans/series`. One entry per metric that has at least one
 *  confirmed reading -- a metric with zero history is simply absent, not an empty array,
 *  so the Body tab can distinguish "never measured" from "measured but flat". */
export const bodyScanSeriesResponseSchema = z.object({
  series: z.array(bodyMetricSeriesSchema),
});
export type BodyScanSeriesResponse = z.infer<typeof bodyScanSeriesResponseSchema>;
