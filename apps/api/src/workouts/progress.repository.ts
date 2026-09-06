import { Inject, Injectable } from "@nestjs/common";
import {
  distributeSetVolume,
  estimateOneRepMaxKg,
  muscleSplitBucketFor,
  toPercentages,
  MuscleGroup,
  MuscleSplitBucket,
  MuscleSplitRow,
} from "@forjd/domain";
import { sql } from "drizzle-orm";

import { Database, DRIZZLE } from "../database/database.module";
import {
  civilDateMs,
  civilDateString,
  localCalendarDate,
  weekStartOf,
} from "./workouts.repository";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = MS_PER_DAY * 7;
/** The design draws eight points on the "Estimated 1RM — 8 weeks" sparkline. */
const ONE_REP_MAX_TREND_WEEKS = 8;

export interface ProgressPersonalRecordRow {
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  achievedAt: Date;
  deltaKgSinceLastMonth: number | null;
}

export interface OneRepMaxTrendPointRow {
  weekStart: string;
  estimatedOneRepMaxKg: number;
}

export interface WeeklyVolumeDayRow {
  /**
   * 1-7, Monday-first -- see `weeklyVolumeDaySchema`'s own docblock for why this
   * deliberately differs from `Date#getDay()`'s Sunday-first indexing that `statsForUser`
   * uses for `thisWeek.trainedWeekdays`.
   */
  dayOfWeek: number;
  volumeKg: number;
}

export interface TrainingCalendarDayRow {
  date: string;
  activity: "strength" | "run";
}

export interface ReadyToProgressRow {
  exerciseId: string;
  exerciseName: string;
}

export interface ProgressStrengthRow {
  personalRecords: ProgressPersonalRecordRow[];
  oneRepMaxTrend: OneRepMaxTrendPointRow[];
  weeklyVolumeKg: WeeklyVolumeDayRow[];
  trainingCalendar: { month: string; days: TrainingCalendarDayRow[]; daysTrained: number };
  muscleSplit: MuscleSplitRow[];
  readyToProgress: ReadyToProgressRow | null;
  volumeKgThisWeek: number;
  volumeKgLastWeek: number;
  sessionsThisWeek: number;
  weeksOfHistory: number;
}

/**
 * Everything the Progress tab's Strength view needs for one athlete (Phase 4).
 *
 * **Computed on read, no rollup table, no scheduled job** (ADR-029) -- a deliberate departure
 * from `docs/architecture/analytics.md`'s "aggregation jobs are scheduled, not computed on
 * read" default, justified there and revisited once Phase 6 lands health-observation volumes
 * that actually strain a per-request scan.
 *
 * A separate repository from `WorkoutsRepository`, sharing its connection and its calendar
 * helpers (`localCalendarDate`, `weekStartOf`, `civilDateMs`, `civilDateString`), rather than
 * one more method bolted onto an already-1200-line file -- `WorkoutsRepository`'s own
 * docblock already draws the templates/sessions split on exactly this reasoning.
 */
@Injectable()
export class ProgressRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async progressStrengthForUser(
    userId: string,
    timeZone: string,
    now: Date,
  ): Promise<ProgressStrengthRow> {
    const today = localCalendarDate(now, timeZone);
    const currentWeekStart = weekStartOf(today);
    const currentMonthPrefix = today.slice(0, 7);
    const lastWeekStart = civilDateString(civilDateMs(currentWeekStart) - MS_PER_WEEK);
    const trendWindowStart = civilDateString(
      civilDateMs(currentWeekStart) - (ONE_REP_MAX_TREND_WEEKS - 1) * MS_PER_WEEK,
    );

    const [
      personalRecords,
      oneRepMaxTrend,
      weekRows,
      calendarRows,
      muscleRows,
      readyToProgress,
      firstSessionRow,
    ] = await Promise.all([
      this.recentPersonalRecords(userId, 2, currentMonthPrefix),
      this.oneRepMaxTrend(userId, timeZone, trendWindowStart),
      this.dailyVolume(userId, timeZone, lastWeekStart),
      this.trainingCalendarDays(userId, timeZone, currentMonthPrefix),
      this.muscleSplit(userId, timeZone, currentMonthPrefix),
      this.readyToProgress(userId),
      this.firstCompletedSessionLocalDate(userId, timeZone),
    ]);

    const weeklyVolumeKg: WeeklyVolumeDayRow[] = [];
    let volumeKgThisWeek = 0;
    let volumeKgLastWeek = 0;
    let sessionsThisWeek = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = civilDateString(civilDateMs(currentWeekStart) + offset * MS_PER_DAY);
      const row = weekRows.get(date);
      const volumeKg = row?.volumeKg ?? 0;
      weeklyVolumeKg.push({ dayOfWeek: offset + 1, volumeKg });
      volumeKgThisWeek += volumeKg;
      sessionsThisWeek += row?.sessionCount ?? 0;
    }
    for (let offset = 0; offset < 7; offset += 1) {
      const date = civilDateString(civilDateMs(lastWeekStart) + offset * MS_PER_DAY);
      volumeKgLastWeek += weekRows.get(date)?.volumeKg ?? 0;
    }

    const weeksOfHistory =
      firstSessionRow === null
        ? 0
        : Math.floor(
            (civilDateMs(currentWeekStart) - civilDateMs(weekStartOf(firstSessionRow))) / MS_PER_WEEK,
          ) + 1;

    return {
      personalRecords,
      oneRepMaxTrend,
      weeklyVolumeKg,
      trainingCalendar: {
        month: currentMonthPrefix,
        days: calendarRows,
        daysTrained: calendarRows.length,
      },
      muscleSplit: muscleRows,
      readyToProgress,
      volumeKgThisWeek,
      volumeKgLastWeek,
      sessionsThisWeek,
      weeksOfHistory,
    };
  }

  /**
   * The athlete's two most recently *achieved* records -- the design's two PR tiles, headed
   * with the exercise's own name rather than a fixed Bench/Squat pair a runner or
   * machine-only lifter would never fill. Reuses the same "best weight, dated to the first
   * time it was reached" definition `WorkoutsRepository.recentPersonalRecordForUser` uses for
   * Home, generalised from `limit 1` to a caller-supplied limit.
   *
   * `deltaKgSinceLastMonth` compares each record's weight against the athlete's best for that
   * exercise strictly before the current local month began -- `null` when there is no earlier
   * best to compare against, which the card renders without a delta line rather than "+0 kg".
   */
  private async recentPersonalRecords(
    userId: string,
    limit: number,
    currentMonthPrefix: string,
  ): Promise<ProgressPersonalRecordRow[]> {
    const result = await this.db.execute<{
      exercise_id: string;
      exercise_name: string;
      weight_kg: string;
      reps: number;
      achieved_at: Date;
      prior_best_weight_kg: string | null;
    }>(sql`
      with completed_sets as (
        select
          wse.exercise_id,
          wset.weight_kg,
          wset.reps,
          coalesce(wset.completed_at, ws.started_at) as achieved_at
        from workout_sets wset
        join workout_session_exercises wse on wse.id = wset.session_exercise_id
        join workout_sessions ws on ws.id = wse.session_id
        where ws.user_id = ${userId}::uuid
          and ws.deleted_at is null
          and ws.status = 'completed'
          and wset.is_completed = true
          and wset.weight_kg is not null
          and wset.reps is not null
      ),
      ranked as (
        select cs.*, max(cs.weight_kg) over (partition by cs.exercise_id) as best_weight
        from completed_sets cs
      ),
      records as (
        select distinct on (r.exercise_id) r.exercise_id, r.weight_kg, r.reps, r.achieved_at
        from ranked r
        where r.weight_kg = r.best_weight
        order by r.exercise_id, r.achieved_at asc
      ),
      prior_best as (
        select exercise_id, max(weight_kg) as prior_best_weight_kg
        from completed_sets
        where achieved_at < (${currentMonthPrefix} || '-01')::date
        group by exercise_id
      )
      select
        rec.exercise_id,
        e.name as exercise_name,
        rec.weight_kg,
        rec.reps,
        rec.achieved_at,
        pb.prior_best_weight_kg
      from records rec
      join exercises e on e.id = rec.exercise_id
      left join prior_best pb on pb.exercise_id = rec.exercise_id
      order by rec.achieved_at desc
      limit ${limit}
    `);

    return result.rows.map((row) => ({
      exerciseId: row.exercise_id,
      exerciseName: row.exercise_name,
      weightKg: Number(row.weight_kg),
      reps: Number(row.reps),
      achievedAt: new Date(row.achieved_at),
      deltaKgSinceLastMonth:
        row.prior_best_weight_kg === null
          ? null
          : Math.round((Number(row.weight_kg) - Number(row.prior_best_weight_kg)) * 10) / 10,
    }));
  }

  /**
   * One point per week, oldest first, over the trailing eight weeks. "Best" is the highest
   * *estimated one-rep max* among that week's completed weighted sets, not simply the
   * heaviest weight lifted -- a 90kg triple estimates higher than a 95kg single, and the
   * sparkline should reflect that. Weeks with no honestly-estimable set (every set outside
   * `estimateOneRepMaxKg`'s supported rep range, or no training at all) are omitted rather
   * than drawn as a zero, which would read as a lost lift rather than an absent one.
   */
  private async oneRepMaxTrend(
    userId: string,
    timeZone: string,
    windowStart: string,
  ): Promise<OneRepMaxTrendPointRow[]> {
    const result = await this.db.execute<{ local_date: string; weight_kg: string; reps: number }>(
      sql`
      select
        to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as local_date,
        wset.weight_kg,
        wset.reps
      from workout_sets wset
      join workout_session_exercises wse on wse.id = wset.session_exercise_id
      join workout_sessions ws on ws.id = wse.session_id
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
        and wset.is_completed = true
        and wset.weight_kg is not null
        and wset.reps is not null
        and (ws.started_at at time zone ${timeZone})::date >= ${windowStart}::date
    `,
    );

    const bestByWeek = new Map<string, number>();
    for (const row of result.rows) {
      const estimate = estimateOneRepMaxKg(Number(row.weight_kg), Number(row.reps));
      if (estimate === null) continue;
      const week = weekStartOf(row.local_date);
      const current = bestByWeek.get(week);
      if (current === undefined || estimate > current) bestByWeek.set(week, estimate);
    }

    return [...bestByWeek.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([weekStart, estimatedOneRepMaxKg]) => ({ weekStart, estimatedOneRepMaxKg }));
  }

  /**
   * Per local day, this week and last week: total volume (`sets x reps x load`, R6) and how
   * many completed sessions started that day.
   */
  private async dailyVolume(
    userId: string,
    timeZone: string,
    windowStart: string,
  ): Promise<Map<string, { volumeKg: number; sessionCount: number }>> {
    const result = await this.db.execute<{ local_date: string; volume_kg: string; sessions: number }>(
      sql`
      select
        to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as local_date,
        coalesce(sum(wset.weight_kg * wset.reps), 0) as volume_kg,
        count(distinct ws.id)::int as sessions
      from workout_sessions ws
      left join workout_session_exercises wse on wse.session_id = ws.id
      left join workout_sets wset
        on wset.session_exercise_id = wse.id
        and wset.is_completed = true
        and wset.weight_kg is not null
        and wset.reps is not null
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
        and (ws.started_at at time zone ${timeZone})::date >= ${windowStart}::date
      group by 1
    `,
    );

    const byDate = new Map<string, { volumeKg: number; sessionCount: number }>();
    for (const row of result.rows) {
      byDate.set(row.local_date, {
        volumeKg: Number(row.volume_kg),
        sessionCount: Number(row.sessions),
      });
    }
    return byDate;
  }

  /**
   * Which days of the current local month had a completed session, and whether that day
   * reads as `run` or `strength` in the design's two-colour legend. `running` maps to `run`;
   * every other trained `Activity` maps to `strength`, so a day mixing a lift and a run is
   * drawn as `strength` -- the lift is treated as the more informative fact about the day.
   */
  private async trainingCalendarDays(
    userId: string,
    timeZone: string,
    monthPrefix: string,
  ): Promise<TrainingCalendarDayRow[]> {
    const result = await this.db.execute<{ local_date: string; activities: string[] }>(sql`
      select
        to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as local_date,
        array_agg(distinct ws.activity) as activities
      from workout_sessions ws
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
        and to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM') = ${monthPrefix}
      group by 1
    `);

    return result.rows
      .map((row) => ({
        date: row.local_date,
        activity: (row.activities.every((activity) => activity === "running")
          ? "run"
          : "strength") as "run" | "strength",
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /**
   * This month's trained volume, split across the design's six muscle-group bars.
   *
   * A set's volume is divided equally among its exercise's primary muscles, mapped into the
   * six-bucket vocabulary via `muscleSplitBucketFor` (`@forjd/domain`) -- equal division, not
   * full credit to each, is what makes the returned percentages sum to 100 rather than to
   * whatever the athlete's own primary-muscle counts happen to add up to.
   */
  private async muscleSplit(
    userId: string,
    timeZone: string,
    monthPrefix: string,
  ): Promise<MuscleSplitRow[]> {
    const result = await this.db.execute<{
      weight_kg: string;
      reps: number;
      primary_muscles: string[];
    }>(sql`
      select wset.weight_kg, wset.reps, e.primary_muscles
      from workout_sets wset
      join workout_session_exercises wse on wse.id = wset.session_exercise_id
      join workout_sessions ws on ws.id = wse.session_id
      join exercises e on e.id = wse.exercise_id
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
        and wset.is_completed = true
        and wset.weight_kg is not null
        and wset.reps is not null
        and to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM') = ${monthPrefix}
    `);

    const totals: Partial<Record<MuscleSplitBucket, number>> = {};
    for (const row of result.rows) {
      const volumeKg = Number(row.weight_kg) * Number(row.reps);
      const buckets = row.primary_muscles
        .map((muscle) => muscleSplitBucketFor(muscle as MuscleGroup))
        .filter((bucket): bucket is MuscleSplitBucket => bucket !== null);
      const distributed = distributeSetVolume(volumeKg, buckets);
      for (const [bucket, share] of Object.entries(distributed) as [MuscleSplitBucket, number][]) {
        totals[bucket] = (totals[bucket] ?? 0) + share;
      }
    }

    return toPercentages(totals);
  }

  /**
   * A lift whose most recent two sessions against a template both exceeded that exercise's
   * prescribed rep ceiling -- the R2 trigger for FORJD Insight's one instruction (ADR-030).
   * "Two consecutive sessions" is ACSM's own condition, not a rounding of it: a single good
   * set is not evidence of a pattern.
   *
   * Only sessions performed against a template carry a prescription to exceed, so an
   * athlete training entirely from memory or an unplanned session never triggers this --
   * there is nothing honest to compare their reps against.
   */
  private async readyToProgress(userId: string): Promise<ReadyToProgressRow | null> {
    const result = await this.db.execute<{ exercise_id: string; exercise_name: string }>(sql`
      with sessions_with_template as (
        select ws.id as session_id, ws.started_at, ws.template_id
        from workout_sessions ws
        where ws.user_id = ${userId}::uuid
          and ws.deleted_at is null
          and ws.status = 'completed'
          and ws.template_id is not null
      ),
      top_set as (
        select
          swt.session_id, swt.started_at, wse.exercise_id,
          max(wset.reps) as top_reps
        from sessions_with_template swt
        join workout_session_exercises wse on wse.session_id = swt.session_id
        join workout_sets wset
          on wset.session_exercise_id = wse.id
          and wset.is_completed = true
          and wset.reps is not null
        group by swt.session_id, swt.started_at, wse.exercise_id
      ),
      target as (
        select wt.id as template_id, we.exercise_id, coalesce(we.target_reps_max, we.target_reps) as target_reps
        from workout_templates wt
        join workout_blocks wb on wb.template_id = wt.id
        join workout_exercises we on we.block_id = wb.id
      ),
      compared as (
        select
          ts.session_id, ts.started_at, ts.exercise_id, ts.top_reps, tg.target_reps,
          row_number() over (partition by ts.exercise_id order by ts.started_at desc) as rn
        from top_set ts
        join sessions_with_template swt on swt.session_id = ts.session_id
        join target tg on tg.template_id = swt.template_id and tg.exercise_id = ts.exercise_id
        where tg.target_reps is not null
      )
      select c1.exercise_id, e.name as exercise_name
      from compared c1
      join compared c2 on c2.exercise_id = c1.exercise_id and c2.rn = c1.rn + 1
      join exercises e on e.id = c1.exercise_id
      where c1.rn = 1
        and c1.top_reps >= c1.target_reps + 1
        and c2.top_reps >= c2.target_reps + 1
      order by c1.started_at desc
      limit 1
    `);

    const row = result.rows[0];
    if (!row) return null;
    return { exerciseId: row.exercise_id, exerciseName: row.exercise_name };
  }

  /** The local calendar date of the athlete's very first completed session, or `null`. */
  private async firstCompletedSessionLocalDate(
    userId: string,
    timeZone: string,
  ): Promise<string | null> {
    const result = await this.db.execute<{ local_date: string | null }>(sql`
      select min(to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM-DD')) as local_date
      from workout_sessions ws
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
    `);
    return result.rows[0]?.local_date ?? null;
  }
}
