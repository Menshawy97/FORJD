import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { Database, DRIZZLE } from '../database/database.module';
import { executeValidated } from '../database/db-utils';
import { countWeekStreak, localCalendarDate, weekStartOf } from '../workouts/calendar-utils';

const recordRowSchema = z.object({
  exercise_name: z.string(),
  weight_kg: z.number(),
});

const sessionRowSchema = z.object({
  name: z.string(),
  started_at: z.coerce.date(),
  duration_seconds: z.number().nullable(),
  volume_kg: z.number(),
});

const trainedDayRowSchema = z.object({ local_date: z.string() });

export interface AthleteRecordRow {
  exerciseName: string;
  weightKg: number;
}

export interface AthleteSessionRow {
  name: string;
  startedAt: Date;
  /** Weight x reps over completed sets, in kilograms; 0 for a session with none, such as a run. */
  volumeKg: number;
  durationSeconds: number | null;
}

/**
 * The reads behind another athlete's public profile (Phase 10N): their heaviest lifts, their last
 * few sessions and their weekly streak.
 *
 * Every query is scoped to the one `userId` it is given and reads nothing but the athlete's own
 * completed, undeleted workouts. Who may see the result is decided by `AthletesService`, never
 * here (CLAUDE.md rule 12).
 */
@Injectable()
export class AthleteStatsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The best completed weighted set of each exercise, heaviest first, at most `limit` of them. */
  async personalRecords(userId: string, limit: number): Promise<AthleteRecordRow[]> {
    const rows = await executeValidated(
      this.db,
      sql`
      select e.name as exercise_name, max(wset.weight_kg)::float8 as weight_kg
      from workout_sets wset
      join workout_session_exercises wse on wse.id = wset.session_exercise_id
      join workout_sessions ws on ws.id = wse.session_id
      join exercises e on e.id = wse.exercise_id
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
        and wset.is_completed = true
        and wset.weight_kg is not null
        and wset.weight_kg > 0
      group by e.id, e.name
      order by weight_kg desc, e.name asc
      limit ${limit}
      `,
      recordRowSchema,
      'AthleteStatsRepository.personalRecords',
    );
    return rows.map((row) => ({ exerciseName: row.exercise_name, weightKg: row.weight_kg }));
  }

  /** The newest completed sessions, with the kilograms each one lifted. */
  async recentSessions(userId: string, limit: number): Promise<AthleteSessionRow[]> {
    const rows = await executeValidated(
      this.db,
      sql`
      select
        ws.name,
        ws.started_at,
        ws.duration_seconds::float8 as duration_seconds,
        coalesce(sum(case when wset.is_completed = true and wset.weight_kg is not null and wset.reps is not null then wset.weight_kg * wset.reps end), 0)::float8 as volume_kg
      from workout_sessions ws
      left join workout_session_exercises wse on wse.session_id = ws.id
      left join workout_sets wset on wset.session_exercise_id = wse.id
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
      group by ws.id
      order by ws.started_at desc, ws.id desc
      limit ${limit}
      `,
      sessionRowSchema,
      'AthleteStatsRepository.recentSessions',
    );
    return rows.map((row) => ({
      name: row.name,
      startedAt: row.started_at,
      volumeKg: row.volume_kg,
      durationSeconds: row.duration_seconds,
    }));
  }

  /**
   * Consecutive weeks with a completed workout, ending this week or last. Days are in the
   * athlete's own calendar (`timeZone`), because "which week" is a local idea.
   */
  async weekStreak(userId: string, timeZone: string, now: Date): Promise<number> {
    const rows = await executeValidated(
      this.db,
      sql`
      select distinct to_char((ws.started_at at time zone ${timeZone})::date, 'YYYY-MM-DD') as local_date
      from workout_sessions ws
      where ws.user_id = ${userId}::uuid
        and ws.deleted_at is null
        and ws.status = 'completed'
      `,
      trainedDayRowSchema,
      'AthleteStatsRepository.weekStreak',
    );
    const weeks = new Set(rows.map((row) => weekStartOf(row.local_date)));
    return countWeekStreak(weeks, weekStartOf(localCalendarDate(now, timeZone)));
  }
}
