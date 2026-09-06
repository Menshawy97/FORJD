import { Inject, Injectable } from "@nestjs/common";
import { SQL, and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Activity, ProgramCategory, ProgramLevel } from "@forjd/domain";
import type { ProgramScope } from "@forjd/contracts";

import { DRIZZLE, Database } from "../database/database.module";
import { exercises } from "../database/schema/exercises.schema";
import {
  programEnrollments,
  programWorkouts,
  programs,
  workoutBlocks,
  workoutExercises,
  workoutTemplates,
} from "../database/schema/workouts.schema";

/**
 * A custom program's category and level. The builder screen (`s_programBuilder()`) never asks
 * for either -- it only collects a name, a week count and a weekday assignment -- so there is no
 * athlete choice to store here. `strength` and `beginner` are placeholders a custom program's own
 * screens never read: the overview shows the level pill, but only the catalogue's nine presets
 * are ever reached by a category filter, and "My programs" renders neither.
 */
const CUSTOM_PROGRAM_CATEGORY: ProgramCategory = "strength";
const CUSTOM_PROGRAM_LEVEL: ProgramLevel = "beginner";

/**
 * Not `slugify` from `exercises/ingest/mappings.ts` -- that module's uniqueness disclaimer is the
 * point: two different names can collapse to the same slug, which is exactly why
 * `programs_preset_slug_key` is a *partial* unique index that excludes every owned program. A
 * collision here costs nothing.
 */
function slugifyProgramName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "program";
}

export interface ProgramSummaryRow {
  id: string;
  slug: string;
  name: string;
  category: ProgramCategory;
  level: ProgramLevel;
  daysPerWeek: number;
  durationWeeks: number;
  description: string | null;
  version: number;
  isOwn: boolean;
  workoutCount: number;
}

export interface ProgramWorkoutRow {
  templateId: string;
  name: string;
  activity: Activity;
  orderIndex: number;
  dayOfWeek: number | null;
  exerciseNames: string[];
}

export interface ProgramWithWorkouts extends ProgramSummaryRow {
  workouts: ProgramWorkoutRow[];
}

export interface ListProgramsFilter {
  userId: string;
  category?: ProgramCategory;
  scope: ProgramScope;
}

export interface CreateProgramWorkoutInput {
  templateId: string;
  dayOfWeek: number;
}

export interface CreateProgramInput {
  name: string;
  durationWeeks: number;
  workouts: CreateProgramWorkoutInput[];
}

export interface ProgramEnrollmentRow {
  id: string;
  programId: string;
  programSlug: string;
  programName: string;
  programVersion: number;
  startedAt: Date;
}

/**
 * Catalogue presets (no owner) plus this user's own -- the same shape and reasoning as
 * `exercises.repository.ts`'s and `workouts.repository.ts`'s own `visibleTo`.
 */
function visibleTo(userId: string): SQL {
  return sql`(${programs.ownerUserId} is null or ${programs.ownerUserId} = ${userId}::uuid)`;
}

/**
 * Narrows `visibleTo` to the list the caller actually asked for.
 *
 * The design draws two program lists that must not bleed into each other: the catalogue shows
 * only the nine presets, and Train's "My programs" shows only the athlete's own. `all` exists
 * for a caller that genuinely wants both, and is never what a screen defaults to -- the default
 * lives in `programListQuerySchema`, so forgetting the parameter yields the catalogue rather
 * than a mixed list.
 */
function scopedTo(userId: string, scope: ProgramScope): SQL {
  if (scope === "preset") return sql`${programs.ownerUserId} is null`;
  if (scope === "mine") return sql`${programs.ownerUserId} = ${userId}::uuid`;
  return visibleTo(userId);
}

/**
 * Counts a program's workouts without joining to them.
 *
 * A join would multiply the program row once per workout, which a `GROUP BY` could untangle but
 * a plain `SELECT` cannot -- the same reason `workouts.repository.ts` reaches for a correlated
 * subquery to count a template's exercises.
 *
 * Deliberately **not** `days_per_week`. The two are equal for every seeded preset, and a custom
 * program that assigns rest days would separate them; a list reading the wrong one would be
 * right until the builder ships and quietly wrong afterwards.
 */
function workoutCountSubquery(): SQL<number> {
  // Every column reference is qualified with its table name explicitly, the same way
  // `workouts.repository.ts`'s own count subquery is. Interpolating the column objects
  // (`${programWorkouts.programId}`) renders their *bare* names, so the correlation becomes
  // `"program_id" = "id"` -- and inside this subquery `"id"` binds to `program_workouts.id`
  // rather than to the outer program. That is not an error Postgres can catch: it is a valid
  // comparison that simply is never true, so every program silently reports zero workouts.
  return sql<number>`(
    select count(*)::int from ${programWorkouts}
    where ${programWorkouts}."program_id" = ${programs}."id"
  )`;
}

/**
 * Reads for the program catalogue, the overview, and "what am I following".
 *
 * Separate from `ProgramsSeedRepository`, which is a CLI-only write path for null-owner
 * catalogue rows. This is the request path: every method takes the caller's id and answers
 * "which programs exist *for this user*", because that is a property of the query -- a check
 * performed afterwards would have to fetch a row it is not allowed to see in order to decide it
 * may not see it.
 */
@Injectable()
export class ProgramsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private summaryColumns(userId: string) {
    return {
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      category: programs.category,
      level: programs.level,
      daysPerWeek: programs.daysPerWeek,
      durationWeeks: programs.durationWeeks,
      description: programs.description,
      version: programs.version,
      isOwn: sql<boolean>`(${programs.ownerUserId} = ${userId}::uuid)`,
      workoutCount: workoutCountSubquery(),
    };
  }

  private toSummary(row: {
    id: string;
    slug: string;
    name: string;
    category: string;
    level: string;
    daysPerWeek: number;
    durationWeeks: number;
    description: string | null;
    version: number;
    isOwn: boolean | null;
    workoutCount: number;
  }): ProgramSummaryRow {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category as ProgramCategory,
      level: row.level as ProgramLevel,
      daysPerWeek: row.daysPerWeek,
      durationWeeks: row.durationWeeks,
      description: row.description,
      version: row.version,
      // For a preset the owner is NULL, so `owner = :user` is SQL NULL rather than false and
      // arrives here as `null`. Coerced here rather than in SQL, which keeps the predicate short.
      isOwn: row.isOwn === true,
      workoutCount: row.workoutCount,
    };
  }

  /**
   * The whole matching set, unpaginated. Nine presets plus however few programs an athlete
   * builds; a keyset cursor here would be machinery with no caller.
   *
   * Ordered by `(name, id)` -- the same total sort key the exercise list uses, so two programs
   * sharing a name still have a stable order rather than whatever the planner happens to return.
   */
  async listForUser(filter: ListProgramsFilter): Promise<ProgramSummaryRow[]> {
    const conditions = [isNull(programs.deletedAt), scopedTo(filter.userId, filter.scope)];
    if (filter.category) {
      conditions.push(eq(programs.category, filter.category));
    }

    const rows = await this.db
      .select(this.summaryColumns(filter.userId))
      .from(programs)
      .where(and(...conditions))
      .orderBy(asc(programs.name), asc(programs.id));

    return rows.map((row) => this.toSummary(row));
  }

  /**
   * Returns `null` for a missing, deleted and not-visible program alike -- the same refusal
   * `ExercisesRepository.findByIdForUser` makes, so a probe cannot distinguish "does not exist"
   * from "exists and belongs to someone else".
   *
   * Two queries rather than one: the workouts join down through blocks to exercises, and folding
   * that into the program row would multiply it once per exercise.
   */
  async findByIdForUser(id: string, userId: string): Promise<ProgramWithWorkouts | null> {
    const [row] = await this.db
      .select(this.summaryColumns(userId))
      .from(programs)
      .where(and(eq(programs.id, id), isNull(programs.deletedAt), visibleTo(userId)));

    if (!row) {
      return null;
    }

    return { ...this.toSummary(row), workouts: await this.workoutsOf(id) };
  }

  /**
   * A program's workouts with their exercise names, in the design's two orders at once: workouts
   * by the join row's `order_index`, and each workout's exercises by block then position.
   *
   * `array_agg` rather than a second round trip per workout: the overview draws every row's
   * `exs.join(' · ')` line immediately, so fetching them lazily would be an N+1 in service of a
   * screen that always needs all of it. The `ORDER BY` inside the aggregate is what keeps
   * "Bench Press · Barbell Row" from arriving reversed.
   */
  private async workoutsOf(programId: string): Promise<ProgramWorkoutRow[]> {
    const rows = await this.db
      .select({
        templateId: workoutTemplates.id,
        name: workoutTemplates.name,
        activity: workoutTemplates.activity,
        orderIndex: programWorkouts.orderIndex,
        dayOfWeek: programWorkouts.dayOfWeek,
        // Table-qualified throughout, for the reason `workoutCountSubquery` spells out: bare
        // column names bind inside this subquery, and three of the four tables joined here have
        // an `id`. Left unqualified, the correlation is at best ambiguous and at worst silently
        // compares the wrong pair.
        //
        // A soft-deleted exercise is excluded, the same way the outer query excludes a
        // soft-deleted template. Exercises are never hard-deleted while a prescription references
        // them (`workout_exercises.exercise_id` is `restrict`), so soft deletion is the only way
        // one leaves the catalogue -- and an overview row listing an exercise that no longer
        // exists would be quietly wrong rather than visibly broken.
        exerciseNames: sql<string[] | null>`(
          select array_agg(${exercises}."name" order by ${workoutBlocks}."order_index", ${workoutExercises}."order_index")
          from ${workoutExercises}
          join ${workoutBlocks} on ${workoutBlocks}."id" = ${workoutExercises}."block_id"
          join ${exercises} on ${exercises}."id" = ${workoutExercises}."exercise_id"
          where ${workoutBlocks}."template_id" = ${workoutTemplates}."id"
            and ${exercises}."deleted_at" is null
        )`,
      })
      .from(programWorkouts)
      .innerJoin(workoutTemplates, eq(workoutTemplates.id, programWorkouts.templateId))
      .where(and(eq(programWorkouts.programId, programId), isNull(workoutTemplates.deletedAt)))
      .orderBy(asc(programWorkouts.orderIndex));

    return rows.map((row) => ({
      templateId: row.templateId,
      name: row.name,
      activity: row.activity as Activity,
      orderIndex: row.orderIndex,
      dayOfWeek: row.dayOfWeek,
      // `array_agg` over no rows is NULL, not an empty array. An empty workout is legal in the
      // schema, so this is a real case rather than a defensive nicety.
      exerciseNames: row.exerciseNames ?? [],
    }));
  }

  /**
   * The caller's active enrolment, or `null`.
   *
   * "Active" is `ended_at is null`, which the `program_enrollments_one_active_key` partial unique
   * index already limits to one row per user. This read does not rely on that -- it takes the
   * most recently started of whatever it finds -- because a read that returns an arbitrary row
   * if the invariant ever slipped is worse than one that returns the newest.
   */
  async findActiveEnrollment(userId: string): Promise<ProgramEnrollmentRow | null> {
    const [row] = await this.db
      .select({
        id: programEnrollments.id,
        programId: programEnrollments.programId,
        programSlug: programs.slug,
        programName: programs.name,
        programVersion: programEnrollments.programVersion,
        startedAt: programEnrollments.startedAt,
      })
      .from(programEnrollments)
      .innerJoin(programs, eq(programs.id, programEnrollments.programId))
      .where(and(eq(programEnrollments.userId, userId), isNull(programEnrollments.endedAt)))
      .orderBy(sql`${programEnrollments.startedAt} desc`)
      .limit(1);

    return row ?? null;
  }

  /**
   * Starts following a program, ending whatever the athlete was following before.
   *
   * **One transaction, and the end comes first.** `program_enrollments_one_active_key` is a
   * partial unique index over `(user_id) where ended_at is null`, so inserting before ending would
   * violate it rather than replace anything. Doing both in one transaction is also what makes the
   * design's Start Following honest: at no point is the athlete following two programs, and at no
   * point are they following none.
   *
   * **Re-following the program you already follow is a no-op**, returning the existing enrolment
   * untouched. Ending and restarting would move `started_at`, and "Recommended next" (K4) is
   * derived from the sessions performed *since* enrolling -- so a second tap on Start Following
   * would silently erase the athlete's progress through the program. The prototype agrees: its
   * `progDone` is keyed by program and survives unfollowing entirely.
   *
   * Returns `null` when the program is not visible to this user, so the service can refuse it the
   * same way it refuses an unreadable one -- rather than enrolling someone in a program they are
   * not allowed to see.
   */
  async enrol(userId: string, programId: string): Promise<ProgramEnrollmentRow | null> {
    return this.db.transaction(async (tx) => {
      const [program] = await tx
        .select({ id: programs.id, slug: programs.slug, name: programs.name, version: programs.version })
        .from(programs)
        .where(
          and(eq(programs.id, programId), isNull(programs.deletedAt), visibleTo(userId)),
        );

      if (!program) {
        return null;
      }

      const [active] = await tx
        .select()
        .from(programEnrollments)
        .where(and(eq(programEnrollments.userId, userId), isNull(programEnrollments.endedAt)));

      if (active?.programId === programId) {
        return {
          id: active.id,
          programId: active.programId,
          programSlug: program.slug,
          programName: program.name,
          programVersion: active.programVersion,
          startedAt: active.startedAt,
        };
      }

      if (active) {
        await tx
          .update(programEnrollments)
          .set({ endedAt: sql`now()` })
          .where(eq(programEnrollments.id, active.id));
      }

      const [created] = await tx
        .insert(programEnrollments)
        .values({
          userId,
          programId,
          // Snapshotted from the program's *current* version, which is the whole point of the
          // column: what the athlete signed up to, not what it later became.
          programVersion: program.version,
        })
        .returning();

      if (!created) {
        throw new Error(`enrol(${programId}): insert returned no row`);
      }

      return {
        id: created.id,
        programId: created.programId,
        programSlug: program.slug,
        programName: program.name,
        programVersion: created.programVersion,
        startedAt: created.startedAt,
      };
    });
  }

  /**
   * Stops following, and reports whether anything was actually stopped.
   *
   * Ended, never deleted: "you followed this for six weeks last spring" is history worth keeping,
   * the same soft-history reasoning `workout_sessions.deleted_at` documents. The boolean is for
   * the service, which turns "nothing was active" into the same 204 as a successful stop -- a
   * second tap on Stop Following is not an error.
   */
  async endActiveEnrollment(userId: string): Promise<boolean> {
    const rows = await this.db
      .update(programEnrollments)
      .set({ endedAt: sql`now()` })
      .where(and(eq(programEnrollments.userId, userId), isNull(programEnrollments.endedAt)))
      .returning({ id: programEnrollments.id });

    return rows.length > 0;
  }

  /**
   * `s_programBuilder()`'s "Save Program" -- the design's only write into `programs` outside the
   * seed. One transaction: the program row, then its `program_workouts`, then a read back through
   * the same `findByIdForUser` the overview screen already uses, so the response the mobile app
   * gets is provably the same shape it would get by reopening the program a moment later.
   *
   * **Returns `null` when any referenced template is not visible to this user.** The builder's own
   * "pick" chips only ever offer `myWorkouts`, so a legitimate client never sends an id that fails
   * this -- but the service has no other way to stop a request naming somebody else's private
   * template, and a 404 here is the same refusal `enrol` and `getById` already give a stranger's
   * row.
   *
   * **`daysPerWeek` is the count of rows actually inserted**, not the request's `workouts.length`
   * restated: they are the same number today because the schema has no way to send a duplicate
   * weekday, but deriving it from what was actually written is the same discipline
   * `workoutCountSubquery` documents for reading it back.
   */
  async createCustom(userId: string, input: CreateProgramInput): Promise<ProgramWithWorkouts | null> {
    const createdId = await this.db.transaction(async (tx) => {
      const templateIds = [...new Set(input.workouts.map((workout) => workout.templateId))];
      const visible = await tx
        .select({ id: workoutTemplates.id })
        .from(workoutTemplates)
        .where(
          and(
            inArray(workoutTemplates.id, templateIds),
            isNull(workoutTemplates.deletedAt),
            sql`(${workoutTemplates.ownerUserId} is null or ${workoutTemplates.ownerUserId} = ${userId}::uuid)`,
          ),
        );

      if (visible.length !== templateIds.length) {
        return null;
      }

      const [created] = await tx
        .insert(programs)
        .values({
          ownerUserId: userId,
          name: input.name,
          slug: slugifyProgramName(input.name),
          category: CUSTOM_PROGRAM_CATEGORY,
          level: CUSTOM_PROGRAM_LEVEL,
          daysPerWeek: input.workouts.length,
          durationWeeks: input.durationWeeks,
        })
        .returning({ id: programs.id });

      if (!created) {
        throw new Error("createCustom: insert into programs returned no row");
      }

      await tx.insert(programWorkouts).values(
        input.workouts.map((workout, index) => ({
          programId: created.id,
          templateId: workout.templateId,
          orderIndex: index,
          dayOfWeek: workout.dayOfWeek,
        })),
      );

      return created.id;
    });

    if (!createdId) {
      return null;
    }

    return this.findByIdForUser(createdId, userId);
  }
}
