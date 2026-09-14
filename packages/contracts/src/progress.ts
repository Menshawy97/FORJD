import { MUSCLE_SPLIT_BUCKETS } from '@forjd/domain';
import { z } from 'zod';

/**
 * `GET /workouts/progress/strength` — the Progress tab's Strength view (Phase 4).
 *
 * Everything is computed on read (ADR-029): no rollup table, no scheduled job, no migration.
 * `timeZone` is required for the same reason `workoutStatsQuerySchema` requires it — the
 * training calendar and weekly volume both bucket by *local* calendar day, and the server has
 * no other way to know which day a late-evening session belongs to.
 */
export const progressStrengthQuerySchema = z.object({
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
export type ProgressStrengthQuery = z.infer<typeof progressStrengthQuerySchema>;

/**
 * One of the design's two PR tiles. Unlike `workoutPersonalRecordSchema` (Home's single most
 * recent record), this schema also carries `deltaKgSinceLastMonth` — the tile's own "+5 kg this
 * month" line — and the response returns **the athlete's two most recently achieved records**,
 * not a fixed Bench/Squat pair the design's literal labels show. Each tile is headed with the
 * exercise's own name, since a lifter who trains neither would otherwise see two empty tiles.
 */
export const progressPersonalRecordSchema = z.object({
  exerciseId: z.string().uuid(),
  exerciseName: z.string(),
  weightKg: z.number(),
  reps: z.number().int(),
  achievedAt: z.string().datetime(),
  /** `null` when there is no earlier value this month to compare against. */
  deltaKgSinceLastMonth: z.number().nullable(),
});
export type ProgressPersonalRecord = z.infer<typeof progressPersonalRecordSchema>;

/** One weekly point of the "Estimated 1RM — 8 weeks" sparkline, oldest first. */
export const oneRepMaxTrendPointSchema = z.object({
  /** The Monday that starts the week this point summarises, `YYYY-MM-DD`. */
  weekStart: z.string(),
  estimatedOneRepMaxKg: z.number(),
});
export type OneRepMaxTrendPoint = z.infer<typeof oneRepMaxTrendPointSchema>;

/**
 * One bar of "Weekly volume (kg)". `dayOfWeek` is **1-7, Monday-first** — matching the
 * calendar and legend below it, and deliberately not `Date#getDay()`'s 0-6 Sunday-first
 * indexing that `workoutStatsResponseSchema.thisWeek.trainedWeekdays` uses. The two schemas
 * answer different questions (this one draws a Monday-first bar chart; that one compares
 * against the device's own `Date#getDay()`) and mixing their indexing would be the more
 * dangerous bug of the two, so they are kept visibly different rather than accidentally alike.
 */
export const weeklyVolumeDaySchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  volumeKg: z.number().min(0),
});
export type WeeklyVolumeDay = z.infer<typeof weeklyVolumeDaySchema>;

/**
 * The training-calendar's three-state legend. `running` maps to `run`; every other trained
 * `Activity` maps to `strength`, so the legend reads "trained, not a run" rather than
 * inventing colours the design does not define. A day with no session is simply absent from
 * `days`, not sent as an explicit `rest` entry — the client already draws every day of the
 * month and treats an absence as rest.
 */
export const TRAINING_CALENDAR_ACTIVITIES = ['strength', 'run'] as const;
export const trainingCalendarDaySchema = z.object({
  date: z.string(),
  activity: z.enum(TRAINING_CALENDAR_ACTIVITIES),
});
export type TrainingCalendarDay = z.infer<typeof trainingCalendarDaySchema>;

export const trainingCalendarSchema = z.object({
  /** The month these days belong to, `YYYY-MM`, in the caller's own time zone. */
  month: z.string(),
  days: z.array(trainingCalendarDaySchema),
  daysTrained: z.number().int().min(0),
});
export type TrainingCalendar = z.infer<typeof trainingCalendarSchema>;

/**
 * One row of "Muscle group split". Percentages across the returned array always sum to 100
 * (`toPercentages` in `@forjd/domain` guarantees it with largest-remainder rounding) — a
 * bucket with no volume this month is omitted rather than sent at 0%.
 */
export const progressMuscleSplitRowSchema = z.object({
  bucket: z.enum(MUSCLE_SPLIT_BUCKETS),
  percent: z.number().int().min(0).max(100),
});
export type ProgressMuscleSplitRow = z.infer<typeof progressMuscleSplitRowSchema>;

/**
 * FORJD Insight's rendered sentence — **not** AI output (ADR-030). `evaluateInsight` in
 * `@forjd/domain` is the single source of what this can ever say; this schema only carries its
 * result over the wire.
 */
export const progressInsightSchema = z.object({
  headline: z.string(),
  body: z.string(),
});
export type ProgressInsight = z.infer<typeof progressInsightSchema>;

/**
 * Response for `GET /workouts/progress/strength`.
 *
 * **Two PR tiles, never more.** The design draws exactly two side by side; a third would have
 * nowhere to go.
 *
 * **`insight` is nullable** — the honest empty state for an account with too little history to
 * say anything true yet, exactly as `recentPersonalRecord` is nullable on `workoutStatsResponseSchema`.
 */
export const progressStrengthResponseSchema = z.object({
  personalRecords: z.array(progressPersonalRecordSchema).max(2),
  oneRepMaxTrend: z.array(oneRepMaxTrendPointSchema),
  weeklyVolumeKg: z.array(weeklyVolumeDaySchema),
  trainingCalendar: trainingCalendarSchema,
  muscleSplit: z.array(progressMuscleSplitRowSchema),
  insight: progressInsightSchema.nullable(),
});
export type ProgressStrengthResponse = z.infer<typeof progressStrengthResponseSchema>;
