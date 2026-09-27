import { Inject, Injectable } from '@nestjs/common';
import { ACTIVITY_SESSION_CAP_SECONDS, ForgeLadder } from '@forjd/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { Database, DRIZZLE } from '../database/database.module';
import { executeValidated } from '../database/db-utils';

/** One Forge week in an athlete's zone: its Saturday label and the instants it spans. */
export interface ForgeWeekWindow {
  /** The Saturday that starts the week, `YYYY-MM-DD`. */
  weekStart: string;
  /** Saturday 00:00 local, as an instant. */
  start: Date;
  /** The next Saturday 00:00 local, as an instant: the close. */
  end: Date;
}

export type ForgeWeeklyTotals = Record<ForgeLadder, number>;

export const forgeTotalsRowSchema = z.object({
  consistency: z.coerce.number(),
  volume: z.coerce.number(),
  distance: z.coerce.number(),
  minutes: z.coerce.number(),
  nourish: z.coerce.number(),
});

/**
 * What one Forge week adds up to on every ladder, from data the app already logs (ADR-057
 * decision 9). One bounded query per athlete and week, using `workout_sessions_user_started_idx`
 * and `nutrition_log_entries_user_date_idx`.
 *
 * **The lock** (ADR-057 decision 2): a row counts only if the server had it at `lockAt` -- a
 * session's `created_at` is when it reached the server, so a workout synced after the close does
 * not count -- and a session deleted after `lockAt` still counts. The evaluation job passes the
 * week's close; a live read of the current week passes now.
 *
 * - **Consistency:** completed, not-deleted sessions of any activity.
 * - **Volume:** weight x reps over completed sets, warm-ups included (the rest of the app counts
 *   them too).
 * - **Distance:** kilometres from the completed sets of `running` sessions only ("km run").
 * - **Active minutes:** working time, each session capped at `ACTIVITY_SESSION_CAP_SECONDS` as the
 *   leaderboard does (ADR-046), so a session left running all night counts two hours.
 * - **Nourish:** distinct days in the week with at least one meal logged. `logged_date` is already
 *   the athlete's own calendar day.
 */
@Injectable()
export class ForgeTotalsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async weeklyTotals(userId: string, week: ForgeWeekWindow, lockAt: Date): Promise<ForgeWeeklyTotals> {
    const lock = lockAt.toISOString();
    const rows = await executeValidated(
      this.db,
      sql`
      with sessions as (
        select ws.id, ws.activity, least(ws.duration_seconds, ${ACTIVITY_SESSION_CAP_SECONDS}) as capped_seconds
        from workout_sessions ws
        where ws.user_id = ${userId}
          and ws.status = 'completed'
          and ws.started_at >= ${week.start.toISOString()}::timestamptz
          and ws.started_at < ${week.end.toISOString()}::timestamptz
          and ws.created_at <= ${lock}::timestamptz
          and (ws.deleted_at is null or ws.deleted_at > ${lock}::timestamptz)
      ), sets as (
        select
          s.activity,
          coalesce(sum(case when wset.weight_kg is not null and wset.reps is not null then wset.weight_kg * wset.reps end), 0) as volume_kg,
          coalesce(sum(wset.distance_meters), 0) as distance_m
        from sessions s
        join workout_session_exercises wse on wse.session_id = s.id
        join workout_sets wset on wset.session_exercise_id = wse.id and wset.is_completed = true
        group by s.id, s.activity
      )
      select
        (select count(*) from sessions)::int as consistency,
        (select coalesce(sum(volume_kg), 0) from sets)::float8 as volume,
        (select coalesce(sum(distance_m), 0) / 1000 from sets where activity = 'running')::float8 as distance,
        (select coalesce(sum(capped_seconds), 0) / 60.0 from sessions)::float8 as minutes,
        (
          select count(distinct nle.logged_date)
          from nutrition_log_entries nle
          where nle.user_id = ${userId}
            and nle.logged_date >= ${week.weekStart}::date
            and nle.logged_date < ${week.weekStart}::date + 7
            and nle.created_at <= ${lock}::timestamptz
        )::int as nourish
      `,
      forgeTotalsRowSchema,
      'ForgeTotalsRepository.weeklyTotals',
    );

    // An aggregate with no `group by` always returns exactly one row.
    return rows[0] as ForgeWeeklyTotals;
  }
}
