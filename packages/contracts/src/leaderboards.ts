import {
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  LEADERBOARD_STATUSES,
  MIN_COHORT_SIZE,
} from '@forjd/domain';
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// City leaderboards (Phase 10, ADR-046). @forjd/domain's tuples are the source of truth for the
// closed sets; this file builds z.enum(...) from them, same pattern as health.ts.
// ---------------------------------------------------------------------------------------------

export const leaderboardMetricSchema = z.enum(LEADERBOARD_METRICS);
export const leaderboardPeriodSchema = z.enum(LEADERBOARD_PERIODS);
export const leaderboardStatusSchema = z.enum(LEADERBOARD_STATUSES);

/**
 * `GET /api/v1/leaderboards`. There is no cursor and no page number on purpose: the design shows
 * ranks 44-50 with the caller at 47, so the contract is "a window around me". `window` is the
 * number of rows above and below the caller (3 gives the design's seven rows). A query-string
 * value arrives as text, hence the coercion.
 */
export const leaderboardQuerySchema = z.object({
  metric: leaderboardMetricSchema.default('activity'),
  period: leaderboardPeriodSchema.default('month'),
  // Digits only. `z.coerce.number()` would read `?window=` or `?window=%20` as 0 and `?window[]=3`
  // as 3, quietly turning a malformed request into a valid one instead of a 400.
  window: z
    .string()
    .regex(/^\d{1,2}$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(10))
    .or(z.number().int().min(0).max(10))
    .default(3),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardQueryInput = z.input<typeof leaderboardQuerySchema>;

/**
 * One row. `displayName` and `username` are always present: joining a leaderboard means being
 * shown on it, and a private profile only affects whether the row can be opened
 * (`isPublicProfile`), not whether it is named. `delta` is places gained this week: positive is
 * up, negative down, null when no earlier weekly snapshot exists to compare against.
 */
export const leaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string().uuid(),
  displayName: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  score: z.number().min(0).max(100),
  delta: z.number().int().nullable(),
  isSelf: z.boolean(),
  isPublicProfile: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardMeSchema = z.object({
  rank: z.number().int().positive(),
  score: z.number().min(0).max(100),
  /** "Top 8%". Never below 1. */
  topPercent: z.number().int().min(1).max(100),
  delta: z.number().int().nullable(),
});
export type LeaderboardMe = z.infer<typeof leaderboardMeSchema>;

export const leaderboardCitySchema = z.object({
  name: z.string(),
  slug: z.string(),
});

/**
 * The response is a discriminated shape, not a bag of optionals. Only `ranked` may carry rows or
 * `me`; every other status is a real, designed state of the screen with none, so a number can
 * never ride along with `coming_soon`, `cohort_too_small` and the rest. A `ranked` board also
 * needs a city and a cohort at least `MIN_COHORT_SIZE` strong, the same floor the server
 * withholds below.
 */
export const leaderboardResponseSchema = z
  .object({
    status: leaderboardStatusSchema,
    metric: leaderboardMetricSchema,
    period: leaderboardPeriodSchema,
    city: leaderboardCitySchema.nullable(),
    /** "Sep 2026" or "all time", rendered server-side so the heading cannot drift from the window. */
    periodLabel: z.string(),
    cohortSize: z.number().int().nonnegative(),
    minCohortSize: z.literal(MIN_COHORT_SIZE),
    me: leaderboardMeSchema.nullable(),
    rows: z.array(leaderboardRowSchema),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'ranked') {
      if (value.rows.length > 0) {
        ctx.addIssue({ code: 'custom', path: ['rows'], message: `${value.status} must not carry rows` });
      }
      if (value.me !== null) {
        ctx.addIssue({ code: 'custom', path: ['me'], message: `${value.status} must not carry me` });
      }
      if (value.status === 'cohort_too_small') {
        if (value.city === null) {
          ctx.addIssue({ code: 'custom', path: ['city'], message: 'cohort_too_small names its city' });
        }
        if (value.cohortSize >= MIN_COHORT_SIZE) {
          ctx.addIssue({
            code: 'custom',
            path: ['cohortSize'],
            message: `cohort_too_small needs fewer than ${MIN_COHORT_SIZE} athletes`,
          });
        }
      }
      return;
    }
    if (value.rows.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'a ranked board needs rows' });
    }
    if (value.me === null) {
      ctx.addIssue({ code: 'custom', path: ['me'], message: 'a ranked board needs me' });
    }
    if (value.city === null) {
      ctx.addIssue({ code: 'custom', path: ['city'], message: 'a ranked board needs a city' });
    }
    if (value.cohortSize < MIN_COHORT_SIZE) {
      ctx.addIssue({
        code: 'custom',
        path: ['cohortSize'],
        message: `a ranked board needs at least ${MIN_COHORT_SIZE} athletes`,
      });
    }
    if (value.me !== null && value.me.rank > value.cohortSize) {
      ctx.addIssue({ code: 'custom', path: ['me', 'rank'], message: 'rank is beyond the cohort' });
    }
    // Rows are a window around the caller: strictly ascending and contiguous, with exactly one
    // self row that says the same thing `me` does. The screen renders whatever arrives, so this
    // contract is the last line of defence, and it can only be tightened before it ships.
    const selves = value.rows.filter((row) => row.isSelf);
    if (selves.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'exactly one row must be the caller' });
    } else if (value.me !== null && (selves[0]?.rank !== value.me.rank || selves[0]?.score !== value.me.score)) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'the caller row must match me' });
    }
    const first = value.rows[0]?.rank ?? 0;
    if (value.rows.some((row, index) => row.rank !== first + index)) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'rows must be contiguous and ascending' });
    }
  });
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
