import { ConflictException, Injectable, Inject } from "@nestjs/common";
import {
  ACTIVITIES,
  Activity,
  EXERCISE_MEASURES,
  ExerciseMeasure,
  PERCEIVED_EFFORTS,
  PerceivedEffort,
  WORKOUT_SESSION_STATUSES,
  WORKOUT_SET_TYPES,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionStatus,
  WorkoutSet,
  WorkoutSetType,
  estimateOneRepMaxKg,
} from "@forjd/domain";
import { and, desc, eq, inArray, isNull, SQL, sql } from "drizzle-orm";

import { Database, DRIZZLE } from "../database/database.module";
// Read-only, and only to name the exercise behind a personal record -- exercises themselves
// stay `ExercisesRepository`'s aggregate.
import { exercises } from "../database/schema/exercises.schema";
import {
  WorkoutSessionExerciseRow,
  WorkoutSessionRow,
  WorkoutSetRow,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
} from "../database/schema/workouts.schema";
import { civilDateMs, countWeekStreak, localCalendarDate, weekStartOf } from "./calendar-utils";
import { keepKnownNullable, keepKnownOrFallback } from "./workout-templates.repository";

export interface CreateWorkoutSetInput {
  type: WorkoutSetType;
  isCompleted: boolean;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  restSeconds: number | null;
  completedAt: Date | null;
}

/**
 * `measure` is here, not optional -- but it is the service's job to have already looked it up
 * from the referenced exercise before calling `upsertSession`, never a value read from the
 * client's own request body. See `workoutSessionExerciseInputSchema`'s own docblock in
 * `@forjd/contracts`.
 */
export interface CreateWorkoutSessionExerciseInput {
  exerciseId: string;
  measure: ExerciseMeasure;
  notes: string | null;
  sets: CreateWorkoutSetInput[];
}

export interface CreateWorkoutSessionInput {
  /** Client-generated at session start; also the sync idempotency key. */
  id: string;
  userId: string;
  templateId: string | null;
  name: string;
  activity: Activity;
  status: WorkoutSessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  perceivedEffort: PerceivedEffort | null;
  notes: string | null;
  city: string | null;
  citySlug: string | null;
  isLiveTracked: boolean;
  exercises: CreateWorkoutSessionExerciseInput[];
}

/** The last row of the previous page -- ordered by `startedAt` descending, not `name`. */
export interface WorkoutSessionCursor {
  startedAt: string;
  id: string;
}

export interface ListWorkoutSessionsFilter {
  userId: string;
  after?: WorkoutSessionCursor;
  limit: number;
}

/** Lean list row -- matches `workoutSessionSummarySchema` exactly, no exercises/sets. */
export interface WorkoutSessionSummaryRow {
  id: string;
  name: string;
  activity: Activity;
  status: WorkoutSessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  perceivedEffort: PerceivedEffort | null;
}

export interface WorkoutSessionPage {
  rows: WorkoutSessionSummaryRow[];
  hasMore: boolean;
}

/**
 * The athlete's current best lift and when they first reached it (Phase 3J-c).
 *
 * `weightKg` is a bare number, not the `numeric` string Postgres hands back.
 */
export interface WorkoutPersonalRecordRow {
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  /** Never null: the query excludes weighted sets with no rep count. */
  reps: number;
  achievedAt: Date;
}

/** One session's top set for a single exercise -- a row of the exercise-detail History list. */
export interface WorkoutExerciseSessionRow {
  sessionId: string;
  sessionName: string;
  performedAt: Date;
  weightKg: number | null;
  reps: number | null;
}

/** Everything the exercise-detail screen's tiles, trend and History list need (Phase 3J-d). */
export interface WorkoutExerciseHistoryRow {
  bestSet: { weightKg: number; reps: number; achievedAt: Date } | null;
  estimatedOneRepMaxKg: number | null;
  /** Newest first, at most the requested limit. */
  sessions: WorkoutExerciseSessionRow[];
}

/** Everything Home's stat strip, "This week" and "Recent PR" need, in one read. */
export interface WorkoutStatsRow {
  totalSessions: number;
  sessionsThisMonth: number;
  weekStreak: number;
  thisWeek: {
    sessionCount: number;
    /** Ascending and distinct, indexed like `Date#getDay()` -- 0 Sunday through 6 Saturday. */
    trainedWeekdays: number[];
  };
  recentPersonalRecord: WorkoutPersonalRecordRow | null;
}

/**
 * Data access for workout sessions -- the "what the user actually did" half of the workout
 * engine (`docs/architecture/workout-engine.md`).
 *
 * Extracted from `workouts.repository.ts` (R23c), which now composes this class and
 * `WorkoutTemplatesRepository` behind an unchanged `WorkoutsRepository` facade -- see that
 * file's own docblock.
 */
@Injectable()
export class WorkoutSessionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** R4 -- every session id the caller owns, unbounded, for account export. */
  async listSessionIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.db.select({ id: workoutSessions.id }).from(workoutSessions).where(eq(workoutSessions.userId, userId));
    return rows.map((row) => row.id);
  }

  /**
   * Idempotent by `input.id` -- the client-generated key set at session start. A retried
   * upload after a dropped response is a second call with the same id: the row from the
   * *first* write is returned untouched, never re-described by the retry's own payload,
   * which is the whole point of an idempotency key (`phase-3-plan.md`'s locked decisions).
   *
   * A pre-existing row owned by a *different* user is a genuine id collision, not a retry --
   * `ConflictException`, mirroring `ExercisesRepository`'s own unique-violation handling,
   * rather than silently returning someone else's session or a 404 that would suggest the
   * caller's own upload never landed.
   */
  async upsertSession(input: CreateWorkoutSessionInput): Promise<WorkoutSession> {
    return this.db.transaction(async (tx) => {
      const [insertedSession] = await tx
        .insert(workoutSessions)
        .values({
          id: input.id,
          userId: input.userId,
          templateId: input.templateId,
          name: input.name,
          activity: input.activity,
          status: input.status,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationSeconds: input.durationSeconds,
          perceivedEffort: input.perceivedEffort,
          notes: input.notes,
          city: input.city,
          citySlug: input.citySlug,
          isLiveTracked: input.isLiveTracked,
        })
        .onConflictDoNothing({ target: workoutSessions.id })
        .returning();

      if (!insertedSession) {
        const [existingRow] = await tx
          .select()
          .from(workoutSessions)
          .where(and(eq(workoutSessions.id, input.id), isNull(workoutSessions.deletedAt)));

        if (!existingRow || existingRow.userId !== input.userId) {
          throw new ConflictException("A session with that id already exists");
        }

        const exercises = await this.readSessionExerciseTree(tx, existingRow.id);
        return { ...this.toSession(existingRow), exercises };
      }

      const exercises = await this.insertSessionExerciseTree(tx, insertedSession.id, input.exercises);
      return { ...this.toSession(insertedSession), exercises };
    });
  }

  /** The read behind `GET /workouts/sessions/:id`. Strict ownership -- a session has no curated/shared concept, unlike a template. */
  async findSessionByIdForUser(id: string, userId: string): Promise<WorkoutSession | null> {
    const [sessionRow] = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId), isNull(workoutSessions.deletedAt)),
      );

    if (!sessionRow) {
      return null;
    }

    const exercises = await this.readSessionExerciseTree(this.db, sessionRow.id);
    return { ...this.toSession(sessionRow), exercises };
  }

  /**
   * The read behind `GET /workouts/sessions` -- Home's stat strip and workout history read
   * this. Keyset pagination on `(startedAt, id)` **descending**, since a history reads
   * newest-first, unlike the templates list's alphabetical order.
   */
  async listSessionsForUser(filter: ListWorkoutSessionsFilter): Promise<WorkoutSessionPage> {
    const conditions: SQL[] = [
      eq(workoutSessions.userId, filter.userId),
      isNull(workoutSessions.deletedAt),
    ];

    if (filter.after) {
      conditions.push(
        sql`(${workoutSessions.startedAt}, ${workoutSessions.id}) < (${filter.after.startedAt}::timestamptz, ${filter.after.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(and(...conditions))
      .orderBy(desc(workoutSessions.startedAt), desc(workoutSessions.id))
      .limit(filter.limit + 1);

    const page = rows.slice(0, filter.limit);

    return {
      rows: page.map((row) => ({
        id: row.id,
        name: row.name,
        activity: keepKnownOrFallback(row.activity, ACTIVITIES, "strength"),
        status: keepKnownOrFallback(row.status, WORKOUT_SESSION_STATUSES, "completed"),
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        perceivedEffort: keepKnownNullable(row.perceivedEffort, PERCEIVED_EFFORTS),
      })),
      hasMore: rows.length > filter.limit,
    };
  }

  /**
   * Home's stat strip, "This week" and "Recent PR" (Phase 3J-c) -- every aggregate the athlete
   * sees on Home, in two reads.
   *
   * **Computed here rather than on the device** because all of it spans the whole history: the
   * session list is cursor-paginated and carries no totals, and a personal record needs every
   * *set*, not every session summary. Deriving these client-side would mean walking the entire
   * history on every Home render.
   *
   * `timeZone` is a parameter and not a constant because every figure here is a *local calendar*
   * concept. A session at 02:00 UTC on the first of the month happened last month in New York;
   * without the zone, "this month" silently means "this month in UTC" and is wrong for most of
   * the world for part of every day.
   *
   * `now` is injected rather than read from the clock so the calendar boundaries these
   * aggregates turn on are testable at all -- a test asserting "two sessions this week" that
   * reads the clock asserts something different next Monday.
   */
  async statsForUser(userId: string, timeZone: string, now: Date): Promise<WorkoutStatsRow> {
    const today = localCalendarDate(now, timeZone);
    const currentWeekStart = weekStartOf(today);
    const currentMonthPrefix = today.slice(0, 7);

    /*
     * Grouped by local training *day*, not returned row by row. One row per day the athlete
     * trained is bounded by how often they train rather than by how many sessions they have,
     * and it is exactly the grain the streak needs anyway -- so the counts, the week and the
     * streak all fall out of a single scan of the index this table already carries
     * (`workout_sessions_user_started_idx`).
     */
    const dayRows = await this.db.execute<{ local_date: string; sessions: number }>(sql`
      select
        to_char((${workoutSessions.startedAt} at time zone ${timeZone})::date, 'YYYY-MM-DD') as local_date,
        count(*)::int as sessions
      from ${workoutSessions}
      where ${workoutSessions.userId} = ${userId}::uuid
        and ${workoutSessions.deletedAt} is null
        and ${workoutSessions.status} = 'completed'
      group by 1
    `);

    let totalSessions = 0;
    let sessionsThisMonth = 0;
    let thisWeekSessions = 0;
    const trainedWeekStarts = new Set<string>();
    const trainedWeekdays = new Set<number>();

    for (const row of dayRows.rows) {
      const sessions = Number(row.sessions);
      totalSessions += sessions;

      if (row.local_date.startsWith(currentMonthPrefix)) {
        sessionsThisMonth += sessions;
      }

      const week = weekStartOf(row.local_date);
      trainedWeekStarts.add(week);

      if (week === currentWeekStart) {
        thisWeekSessions += sessions;
        // Two sessions on one day light one bar, which is why this is a Set.
        trainedWeekdays.add(new Date(civilDateMs(row.local_date)).getUTCDay());
      }
    }

    return {
      totalSessions,
      sessionsThisMonth,
      weekStreak: countWeekStreak(trainedWeekStarts, currentWeekStart),
      thisWeek: {
        sessionCount: thisWeekSessions,
        trainedWeekdays: [...trainedWeekdays].sort((a, b) => a - b),
      },
      recentPersonalRecord: await this.recentPersonalRecordForUser(userId),
    };
  }

  /**
   * One exercise's history for one athlete (Phase 3J-d) -- the exercise-detail screen's
   * "Best set" and "Est. 1RM" tiles, its top-set trend, and its History list.
   *
   * Two reads, for the same reason `statsForUser` needs two: the best set is over *all* history
   * while the list is the newest `limit` sessions, and folding them together would mean either
   * scanning everything to render eight rows or capping the record at those eight.
   *
   * `estimatedOneRepMaxKg` is derived here rather than on the device so one definition of the
   * formula serves every client. `estimateOneRepMaxKg` lives in `@forjd/domain` and answers
   * `null` for a set outside the rep range Epley can speak to, which the screen renders as its
   * em dash rather than an authoritative-looking wrong number.
   */
  async exerciseHistoryForUser(
    userId: string,
    exerciseId: string,
    limit: number,
  ): Promise<WorkoutExerciseHistoryRow> {
    const best = await this.db.execute<{
      weight_kg: string;
      reps: number;
      achieved_at: Date;
    }>(sql`
      select
        ${workoutSets.weightKg} as weight_kg,
        ${workoutSets.reps} as reps,
        coalesce(${workoutSets.completedAt}, ${workoutSessions.startedAt}) as achieved_at
      from ${workoutSets}
      join ${workoutSessionExercises}
        on ${workoutSessionExercises.id} = ${workoutSets.sessionExerciseId}
      join ${workoutSessions}
        on ${workoutSessions.id} = ${workoutSessionExercises.sessionId}
      where ${workoutSessions.userId} = ${userId}::uuid
        and ${workoutSessionExercises.exerciseId} = ${exerciseId}::uuid
        and ${workoutSessions.deletedAt} is null
        and ${workoutSessions.status} = 'completed'
        and ${workoutSets.isCompleted} = true
        and ${workoutSets.weightKg} is not null
        and ${workoutSets.reps} is not null
      -- Heaviest first; ties go to the earliest, because that is when the record was set.
      order by ${workoutSets.weightKg} desc, achieved_at asc
      limit 1
    `);

    /*
     * One row per session, carrying that session's own heaviest completed set of this exercise.
     * `distinct on` picks it inside the database rather than returning every set for the client
     * to reduce -- an athlete with twenty years of squatting has a great many sets and only
     * ever eight rows on screen.
     */
    const sessions = await this.db.execute<{
      session_id: string;
      session_name: string;
      performed_at: Date;
      weight_kg: string | null;
      reps: number | null;
    }>(sql`
      select distinct on (${workoutSessions.id})
        ${workoutSessions.id} as session_id,
        ${workoutSessions.name} as session_name,
        ${workoutSessions.startedAt} as performed_at,
        ${workoutSets.weightKg} as weight_kg,
        ${workoutSets.reps} as reps
      from ${workoutSessions}
      join ${workoutSessionExercises}
        on ${workoutSessionExercises.sessionId} = ${workoutSessions.id}
      join ${workoutSets}
        on ${workoutSets.sessionExerciseId} = ${workoutSessionExercises.id}
      where ${workoutSessions.userId} = ${userId}::uuid
        and ${workoutSessionExercises.exerciseId} = ${exerciseId}::uuid
        and ${workoutSessions.deletedAt} is null
        and ${workoutSessions.status} = 'completed'
        and ${workoutSets.isCompleted} = true
      order by ${workoutSessions.id}, ${workoutSets.weightKg} desc nulls last
    `);

    const bestRow = best.rows[0];
    const bestSet =
      bestRow === undefined
        ? null
        : {
            weightKg: Number(bestRow.weight_kg),
            reps: Number(bestRow.reps),
            achievedAt: new Date(bestRow.achieved_at),
          };

    return {
      bestSet,
      estimatedOneRepMaxKg:
        bestSet === null ? null : estimateOneRepMaxKg(bestSet.weightKg, bestSet.reps),
      // `distinct on` dictates its own ordering, so newest-first is applied here rather than in
      // SQL. The slice is what bounds the response; the query itself is already bounded to this
      // athlete's own sessions for this one exercise.
      sessions: sessions.rows
        .map((row) => ({
          sessionId: row.session_id,
          sessionName: row.session_name,
          performedAt: new Date(row.performed_at),
          weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
          reps: row.reps === null ? null : Number(row.reps),
        }))
        .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime())
        .slice(0, limit),
    };
  }

  /**
   * The record whose *achievement* is most recent -- not the heaviest lift ever.
   *
   * An athlete who set a squat PR last week should see that, not the heavier deadlift they
   * have held for a year. So: the best weight per exercise, dated to the **first** time they
   * reached it (repeating a lift does not re-set the record, and dating it to the latest
   * repeat would make the card change for no reason), then the most recent of those.
   *
   * Weight-measured sets only, and completed ones only. There is no honest way to rank a timed
   * hold against a lift, and an unticked set was never performed.
   */
  private async recentPersonalRecordForUser(
    userId: string,
  ): Promise<WorkoutPersonalRecordRow | null> {
    const result = await this.db.execute<{
      exercise_id: string;
      exercise_name: string;
      weight_kg: string;
      reps: number;
      achieved_at: Date;
    }>(sql`
      with completed_sets as (
        select
          ${workoutSessionExercises.exerciseId} as exercise_id,
          ${workoutSets.weightKg} as weight_kg,
          ${workoutSets.reps} as reps,
          -- A completed set should always carry completedAt, but a session recovered from the
          -- event log can be missing it; falling back to the session start keeps the record
          -- datable rather than dropping the athlete's best lift over a null.
          coalesce(${workoutSets.completedAt}, ${workoutSessions.startedAt}) as achieved_at
        from ${workoutSets}
        join ${workoutSessionExercises}
          on ${workoutSessionExercises.id} = ${workoutSets.sessionExerciseId}
        join ${workoutSessions}
          on ${workoutSessions.id} = ${workoutSessionExercises.sessionId}
        where ${workoutSessions.userId} = ${userId}::uuid
          and ${workoutSessions.deletedAt} is null
          and ${workoutSessions.status} = 'completed'
          and ${workoutSets.isCompleted} = true
          and ${workoutSets.weightKg} is not null
          -- A record is "100 kg × 5". A weighted set with no rep count is not a lift anyone can
          -- be said to hold a record at, and rendering "100 kg × —" would be worse than
          -- reporting the next-best set that does have both halves.
          and ${workoutSets.reps} is not null
      ),
      ranked as (
        select
          cs.*,
          max(cs.weight_kg) over (partition by cs.exercise_id) as best_weight
        from completed_sets cs
      ),
      records as (
        select distinct on (r.exercise_id)
          r.exercise_id, r.weight_kg, r.reps, r.achieved_at
        from ranked r
        where r.weight_kg = r.best_weight
        order by r.exercise_id, r.achieved_at asc
      )
      select
        rec.exercise_id,
        ${exercises.name} as exercise_name,
        rec.weight_kg,
        rec.reps,
        rec.achieved_at
      from records rec
      join ${exercises} on ${exercises.id} = rec.exercise_id
      order by rec.achieved_at desc
      limit 1
    `);

    const row = result.rows[0];
    if (!row) return null;

    return {
      exerciseId: row.exercise_id,
      exerciseName: row.exercise_name,
      weightKg: Number(row.weight_kg),
      reps: Number(row.reps),
      achievedAt: new Date(row.achieved_at),
    };
  }

  /** Reads an existing session's exercise/set tree, in order -- shared by `findSessionByIdForUser` and `upsertSession`'s replay path. */
  private async readSessionExerciseTree(
    tx: Database,
    sessionId: string,
  ): Promise<WorkoutSessionExercise[]> {
    const exerciseRows = await tx
      .select()
      .from(workoutSessionExercises)
      .where(eq(workoutSessionExercises.sessionId, sessionId))
      .orderBy(workoutSessionExercises.orderIndex);

    if (exerciseRows.length === 0) {
      return [];
    }

    const setRows = await tx
      .select()
      .from(workoutSets)
      .where(
        inArray(
          workoutSets.sessionExerciseId,
          exerciseRows.map((row) => row.id),
        ),
      )
      .orderBy(workoutSets.sessionExerciseId, workoutSets.setIndex);

    const setsByExerciseId = new Map<string, WorkoutSet[]>();
    for (const row of setRows) {
      const list = setsByExerciseId.get(row.sessionExerciseId) ?? [];
      list.push(this.toSet(row));
      setsByExerciseId.set(row.sessionExerciseId, list);
    }

    return exerciseRows.map((row) => ({
      ...this.toSessionExercise(row),
      sets: setsByExerciseId.get(row.id) ?? [],
    }));
  }

  /** Batch-inserts a fresh session exercise/set tree -- shared by `upsertSession`'s first-write path. */
  private async insertSessionExerciseTree(
    tx: Database,
    sessionId: string,
    exercises: CreateWorkoutSessionExerciseInput[],
  ): Promise<WorkoutSessionExercise[]> {
    if (exercises.length === 0) {
      return [];
    }

    const insertedExercises = await tx
      .insert(workoutSessionExercises)
      .values(
        exercises.map((exercise, orderIndex) => ({
          sessionId,
          exerciseId: exercise.exerciseId,
          orderIndex,
          measure: exercise.measure,
          notes: exercise.notes,
        })),
      )
      .returning();

    const exerciseIdByOrderIndex = new Map(insertedExercises.map((row) => [row.orderIndex, row.id]));

    const setValues = exercises.flatMap((exercise, exerciseOrderIndex) => {
      const sessionExerciseId = exerciseIdByOrderIndex.get(exerciseOrderIndex);
      if (!sessionExerciseId) {
        throw new Error("insertSessionExerciseTree: exercise insert missing for orderIndex");
      }
      return exercise.sets.map((set, setIndex) => ({
        sessionExerciseId,
        setIndex,
        type: set.type,
        isCompleted: set.isCompleted,
        weightKg: set.weightKg?.toString() ?? null,
        reps: set.reps,
        durationSeconds: set.durationSeconds,
        distanceMeters: set.distanceMeters?.toString() ?? null,
        restSeconds: set.restSeconds,
        completedAt: set.completedAt,
      }));
    });

    const insertedSets = setValues.length > 0 ? await tx.insert(workoutSets).values(setValues).returning() : [];

    const setsByExerciseId = new Map<string, WorkoutSet[]>();
    for (const row of insertedSets) {
      const list = setsByExerciseId.get(row.sessionExerciseId) ?? [];
      list.push(this.toSet(row));
      setsByExerciseId.set(row.sessionExerciseId, list);
    }

    return insertedExercises
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((row) => ({
        ...this.toSessionExercise(row),
        sets: (setsByExerciseId.get(row.id) ?? []).sort((a, b) => a.setIndex - b.setIndex),
      }));
  }

  private toSession(row: WorkoutSessionRow): Omit<WorkoutSession, "exercises"> {
    return {
      id: row.id,
      userId: row.userId,
      templateId: row.templateId,
      name: row.name,
      activity: keepKnownOrFallback(row.activity, ACTIVITIES, "strength"),
      status: keepKnownOrFallback(row.status, WORKOUT_SESSION_STATUSES, "completed"),
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationSeconds: row.durationSeconds,
      perceivedEffort: keepKnownNullable(row.perceivedEffort, PERCEIVED_EFFORTS),
      notes: row.notes,
      city: row.city,
      citySlug: row.citySlug,
      isLiveTracked: row.isLiveTracked,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toSessionExercise(row: WorkoutSessionExerciseRow): Omit<WorkoutSessionExercise, "sets"> {
    return {
      id: row.id,
      sessionId: row.sessionId,
      exerciseId: row.exerciseId,
      orderIndex: row.orderIndex,
      measure: keepKnownOrFallback(row.measure, EXERCISE_MEASURES, "weight"),
      notes: row.notes,
    };
  }

  private toSet(row: WorkoutSetRow): WorkoutSet {
    return {
      id: row.id,
      sessionExerciseId: row.sessionExerciseId,
      setIndex: row.setIndex,
      type: keepKnownOrFallback(row.type, WORKOUT_SET_TYPES, "working"),
      isCompleted: row.isCompleted,
      weightKg: row.weightKg === null ? null : Number(row.weightKg),
      reps: row.reps,
      durationSeconds: row.durationSeconds,
      distanceMeters: row.distanceMeters === null ? null : Number(row.distanceMeters),
      restSeconds: row.restSeconds,
      completedAt: row.completedAt,
    };
  }
}
