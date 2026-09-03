import { ConflictException, Injectable, Inject } from "@nestjs/common";
import {
  ACTIVITIES,
  Activity,
  EXERCISE_MEASURES,
  ExerciseMeasure,
  PERCEIVED_EFFORTS,
  PerceivedEffort,
  WORKOUT_BLOCK_TYPES,
  WORKOUT_SESSION_STATUSES,
  WORKOUT_SET_TYPES,
  WorkoutBlock,
  WorkoutBlockType,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionStatus,
  WorkoutSet,
  WorkoutSetType,
  WorkoutTemplate,
} from "@forjd/domain";
import { and, desc, eq, inArray, isNull, SQL, sql } from "drizzle-orm";

import { Database, DRIZZLE } from "../database/database.module";
// Read-only, and only to name the exercise behind a personal record -- exercises themselves
// stay `ExercisesRepository`'s aggregate.
import { exercises } from "../database/schema/exercises.schema";
import {
  WorkoutBlockRow,
  WorkoutExerciseRow,
  WorkoutSessionExerciseRow,
  WorkoutSessionRow,
  WorkoutSetRow,
  WorkoutTemplateRow,
  workoutBlocks,
  workoutExercises,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
  workoutTemplates,
} from "../database/schema/workouts.schema";

/**
 * Narrows a `text` column back to the known vocabulary, falling back to a default rather than
 * dropping the row -- unlike `exercises.repository.ts`'s nullable variant, `activity` and
 * `type` are `NOT NULL` columns here, so there is no `null` to preserve if a value has left
 * the known set; a fallback keeps the row shape valid instead.
 */
function keepKnownOrFallback<T extends string>(value: string, known: readonly T[], fallback: T): T {
  return (known as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Narrows a nullable `text` column, dropping (rather than falling back) a value that has left the known set -- `perceived_effort` is nullable, unlike `activity`/`status`/`type`. */
function keepKnownNullable<T extends string>(value: string | null, known: readonly T[]): T | null {
  if (value === null) return null;
  return (known as readonly string[]).includes(value) ? (value as T) : null;
}

export interface CreateWorkoutExerciseInput {
  exerciseId: string;
  setCount: number | null;
  targetReps: number | null;
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  targetSeconds: number | null;
  targetDistanceMeters: number | null;
  restSeconds: number | null;
  notes: string | null;
}

export interface CreateWorkoutBlockInput {
  type: WorkoutBlockType;
  name: string | null;
  rounds: number | null;
  workSeconds: number | null;
  restSeconds: number | null;
  capSeconds: number | null;
  exercises: CreateWorkoutExerciseInput[];
}

/**
 * `basedOnTemplateId` is set when a template is created via "customise this preset" --
 * client-supplied, validated by the service against `findByIdForUser` before it reaches
 * here (see `createWorkoutTemplateRequestSchema`'s own docblock in `@forjd/contracts` for
 * why this is a validated reference, not a derived value). `null` for a template built from
 * scratch.
 */
export interface CreateWorkoutTemplateInput {
  name: string;
  activity: Activity;
  notes: string | null;
  estimatedDurationMinutes: number | null;
  basedOnTemplateId: string | null;
  blocks: CreateWorkoutBlockInput[];
}

/**
 * Every field optional, matching `updateWorkoutTemplateRequestSchema`'s own partial shape.
 * When `blocks` is present, the whole tree is replaced -- see `updateTemplate`'s own
 * docblock for why that is a delete-then-recreate rather than a diff.
 */
export type UpdateWorkoutTemplateInput = Partial<CreateWorkoutTemplateInput>;

/** The last row of the previous page, as the full sort key -- same shape as `ExerciseCursor`. */
export interface WorkoutTemplateCursor {
  name: string;
  id: string;
}

export interface ListWorkoutTemplatesFilter {
  userId: string;
  after?: WorkoutTemplateCursor;
  limit: number;
}

/** A template list row plus the derived fields the list needs and nothing else. */
export interface WorkoutTemplateSummaryRow {
  id: string;
  ownerUserId: string | null;
  name: string;
  activity: Activity;
  estimatedDurationMinutes: number | null;
  exerciseCount: number;
  basedOnTemplateId: string | null;
}

export interface WorkoutTemplatePage {
  rows: WorkoutTemplateSummaryRow[];
  hasMore: boolean;
}

/* ------------------------------------------------------------------------------------------
 * Session half: what the user actually did.
 * ---------------------------------------------------------------------------------------- */

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

/** `YYYY-MM-DD` in the given zone. `en-CA` is the locale that formats exactly this shape. */
function localCalendarDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A `YYYY-MM-DD` civil date as milliseconds, read as though it were UTC midnight.
 *
 * Deliberately *not* the real instant that date began in the athlete's zone. Once a timestamp
 * has been resolved to a calendar day, everything built on it here -- which weekday, which
 * Monday, how many weeks back -- is calendar arithmetic, and doing that on a UTC ruler is what
 * stops a daylight-saving transition from making one week 167 hours long and shifting every
 * weekday index inside it by one.
 */
function civilDateMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function civilDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday of the week a civil date falls in -- the week the mobile app's own strip draws. */
function weekStartOf(date: string): string {
  const ms = civilDateMs(date);
  // getUTCDay() is Sunday-based; adding 6 and taking mod 7 rotates it so Monday is 0.
  const offset = (new Date(ms).getUTCDay() + 6) % 7;
  return civilDateString(ms - offset * MS_PER_DAY);
}

/**
 * Consecutive weeks, ending with the current one or the one immediately before it, that
 * contain at least one completed session.
 *
 * **The current week is allowed to be empty without breaking the streak.** Measured on a
 * Monday morning, a streak that required the current week would reset every week before the
 * athlete had any chance to train -- so a streak that reached last week is still alive, and
 * only falls to zero once the week before that is empty too.
 */
function countWeekStreak(trainedWeekStarts: Set<string>, currentWeekStart: string): number {
  let cursor = civilDateMs(currentWeekStart);
  if (!trainedWeekStarts.has(currentWeekStart)) {
    cursor -= 7 * MS_PER_DAY;
  }

  let streak = 0;
  while (trainedWeekStarts.has(civilDateString(cursor))) {
    streak += 1;
    cursor -= 7 * MS_PER_DAY;
  }
  return streak;
}

/**
 * Catalogue templates (no owner) plus this user's own -- same shape and reasoning as
 * `exercises.repository.ts`'s `visibleTo`.
 */
function visibleTo(userId: string): SQL {
  return sql`(${workoutTemplates.ownerUserId} is null or ${workoutTemplates.ownerUserId} = ${userId}::uuid)`;
}

/**
 * Counts `workout_exercises` rows across every block of a template, via a correlated
 * subquery rather than a join -- a join against two child tables would multiply the template
 * row per exercise, which a `count(*) over w/e` could untangle but a plain `SELECT` cannot.
 * This is what the design's "6 exercises · ~52 min" list line reads, computed rather than
 * stored so it can never drift from the blocks that actually exist.
 */
function exerciseCountSubquery(): SQL<number> {
  // Every column reference is qualified with its table name explicitly. Interpolating the
  // column objects directly (`${workoutBlocks.id}`) renders their bare, unqualified names,
  // which Postgres then rejects as an ambiguous "id" -- both joined tables have one.
  return sql<number>`(
    select count(*)::int from ${workoutExercises}
    inner join ${workoutBlocks} on ${workoutBlocks}."id" = ${workoutExercises}."block_id"
    where ${workoutBlocks}."template_id" = ${workoutTemplates}."id"
  )`;
}

/**
 * Data access for workout templates -- the "what the program tells the user to do" half of
 * the engine (`docs/architecture/workout-engine.md`). Mirrors `ExercisesRepository`'s own
 * contract exactly: never throws `NotFoundException`, never distinguishes "no such row" from
 * "not yours" (`null` covers both), turning that into a 404-never-403 is the service's job.
 *
 * A template's `blocks`/`exercises` are always written and read as one unit -- there is no
 * partial read or write of the tree, matching the domain's own `WorkoutTemplate` shape, which
 * nests `blocks: WorkoutBlock[]` and each block nests `exercises: WorkoutExercise[]`.
 */
@Injectable()
export class WorkoutsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The read behind `GET /workouts/templates/:id`. Takes the caller's id for the same reason
   * `ExercisesRepository.findByIdForUser` does: visibility is a property of the query, not a
   * check performed after fetching a row the caller may not see.
   */
  async findByIdForUser(id: string, userId: string): Promise<WorkoutTemplate | null> {
    const [templateRow] = await this.db
      .select()
      .from(workoutTemplates)
      .where(
        and(eq(workoutTemplates.id, id), isNull(workoutTemplates.deletedAt), visibleTo(userId)),
      );

    if (!templateRow) {
      return null;
    }

    const blockRows = await this.db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.templateId, id))
      .orderBy(workoutBlocks.orderIndex);

    if (blockRows.length === 0) {
      return { ...this.toTemplate(templateRow), blocks: [] };
    }

    const exerciseRows = await this.db
      .select()
      .from(workoutExercises)
      .where(
        inArray(
          workoutExercises.blockId,
          blockRows.map((block) => block.id),
        ),
      )
      .orderBy(workoutExercises.blockId, workoutExercises.orderIndex);

    const exercisesByBlockId = this.groupExercisesByBlockId(exerciseRows);

    const blocks: WorkoutBlock[] = blockRows.map((row) => ({
      ...this.toBlock(row),
      exercises: exercisesByBlockId.get(row.id) ?? [],
    }));

    return { ...this.toTemplate(templateRow), blocks };
  }

  /**
   * The read behind `GET /workouts/templates`. Keyset pagination on `(name, id)`, same
   * reasoning as `ExercisesRepository.listExercises` -- a stable, total sort key a cursor can
   * resume from exactly, and no `q`/filter columns yet because nothing in Phase 3's plan asks
   * for them; adding one later is additive to this method's filter object, not a rewrite.
   */
  async listForUser(filter: ListWorkoutTemplatesFilter): Promise<WorkoutTemplatePage> {
    const conditions: SQL[] = [isNull(workoutTemplates.deletedAt), visibleTo(filter.userId)];

    if (filter.after) {
      conditions.push(
        sql`(${workoutTemplates.name}, ${workoutTemplates.id}) > (${filter.after.name}, ${filter.after.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select({
        id: workoutTemplates.id,
        ownerUserId: workoutTemplates.ownerUserId,
        name: workoutTemplates.name,
        activity: workoutTemplates.activity,
        estimatedDurationMinutes: workoutTemplates.estimatedDurationMinutes,
        exerciseCount: exerciseCountSubquery(),
        basedOnTemplateId: workoutTemplates.basedOnTemplateId,
      })
      .from(workoutTemplates)
      .where(and(...conditions))
      .orderBy(workoutTemplates.name, workoutTemplates.id)
      .limit(filter.limit + 1);

    const page = rows.slice(0, filter.limit);

    return {
      rows: page.map((row) => ({
        id: row.id,
        ownerUserId: row.ownerUserId,
        name: row.name,
        activity: keepKnownOrFallback(row.activity, ACTIVITIES, "strength"),
        estimatedDurationMinutes: row.estimatedDurationMinutes,
        exerciseCount: row.exerciseCount,
        basedOnTemplateId: row.basedOnTemplateId,
      })),
      hasMore: rows.length > filter.limit,
    };
  }

  /**
   * Two batch inserts, not one insert per block and one per exercise -- a multi-block,
   * multi-exercise template would otherwise be an N+1 within its own transaction. Rows are
   * matched back to their input by `orderIndex` rather than assumed to come back from
   * `RETURNING` in insertion order, which Postgres does not document as guaranteed for an
   * arbitrary multi-row `INSERT ... VALUES`.
   */
  async createTemplate(ownerUserId: string, input: CreateWorkoutTemplateInput): Promise<WorkoutTemplate> {
    return this.db.transaction(async (tx) => {
      const [templateRow] = await tx
        .insert(workoutTemplates)
        .values({
          ownerUserId,
          name: input.name,
          activity: input.activity,
          basedOnTemplateId: input.basedOnTemplateId,
          notes: input.notes,
          estimatedDurationMinutes: input.estimatedDurationMinutes,
        })
        .returning();
      if (!templateRow) {
        throw new Error("createTemplate: insert returned no row");
      }

      const blocks = await this.insertBlockTree(tx, templateRow.id, input.blocks);

      return { ...this.toTemplate(templateRow), blocks };
    });
  }

  /**
   * Returns `null` for a missing, deleted, or not-owned template -- see the class docblock.
   * A curated template (`ownerUserId: null`) can never match `eq(ownerUserId, ownerUserId)`
   * here, so it is never directly editable, only copied (Phase G).
   *
   * When `patch.blocks` is present, every existing block (and, by cascade, every exercise
   * under it) is deleted and the new tree is inserted fresh, rather than diffed block by
   * block. The builder screen edits and re-saves the whole workout in one action
   * (`createWorkoutTemplateRequestSchema`'s own docblock); diffing would be machinery built
   * for an editing flow that does not exist.
   */
  async updateTemplate(
    id: string,
    ownerUserId: string,
    patch: UpdateWorkoutTemplateInput,
  ): Promise<WorkoutTemplate | null> {
    return this.db.transaction(async (tx) => {
      const set: Record<string, unknown> = { updatedAt: sql`now()` };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.activity !== undefined) set.activity = patch.activity;
      if (patch.notes !== undefined) set.notes = patch.notes;
      if (patch.estimatedDurationMinutes !== undefined) {
        set.estimatedDurationMinutes = patch.estimatedDurationMinutes;
      }

      const [templateRow] = await tx
        .update(workoutTemplates)
        .set(set)
        .where(
          and(
            eq(workoutTemplates.id, id),
            eq(workoutTemplates.ownerUserId, ownerUserId),
            isNull(workoutTemplates.deletedAt),
          ),
        )
        .returning();

      if (!templateRow) {
        return null;
      }

      if (patch.blocks === undefined) {
        const blocks = await this.readBlockTree(tx, id);
        return { ...this.toTemplate(templateRow), blocks };
      }

      // Cascade (workout_blocks -> workout_exercises) removes the old tree in one statement.
      await tx.delete(workoutBlocks).where(eq(workoutBlocks.templateId, id));

      const blocks = await this.insertBlockTree(tx, id, patch.blocks);

      return { ...this.toTemplate(templateRow), blocks };
    });
  }

  /** Soft delete, so a session that referenced this template is never orphaned. */
  async softDeleteTemplate(id: string, ownerUserId: string): Promise<boolean> {
    const rows = await this.db
      .update(workoutTemplates)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(workoutTemplates.id, id),
          eq(workoutTemplates.ownerUserId, ownerUserId),
          isNull(workoutTemplates.deletedAt),
        ),
      )
      .returning({ id: workoutTemplates.id });
    return rows.length > 0;
  }

  /** Reads an existing template's block/exercise tree, in order -- shared by `findByIdForUser` and `updateTemplate`'s no-op-on-blocks path. */
  private async readBlockTree(
    tx: Database,
    templateId: string,
  ): Promise<WorkoutBlock[]> {
    const blockRows = await tx
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.templateId, templateId))
      .orderBy(workoutBlocks.orderIndex);

    if (blockRows.length === 0) {
      return [];
    }

    const exerciseRows = await tx
      .select()
      .from(workoutExercises)
      .where(
        inArray(
          workoutExercises.blockId,
          blockRows.map((block) => block.id),
        ),
      )
      .orderBy(workoutExercises.blockId, workoutExercises.orderIndex);

    const exercisesByBlockId = this.groupExercisesByBlockId(exerciseRows);

    return blockRows.map((row) => ({
      ...this.toBlock(row),
      exercises: exercisesByBlockId.get(row.id) ?? [],
    }));
  }

  /** Batch-inserts a fresh block/exercise tree for a template -- shared by `createTemplate` and `updateTemplate`'s replace-blocks path. */
  private async insertBlockTree(
    tx: Database,
    templateId: string,
    blocks: CreateWorkoutBlockInput[],
  ): Promise<WorkoutBlock[]> {
    if (blocks.length === 0) {
      return [];
    }

    const insertedBlocks = await tx
      .insert(workoutBlocks)
      .values(
        blocks.map((block, orderIndex) => ({
          templateId,
          type: block.type,
          orderIndex,
          name: block.name,
          rounds: block.rounds,
          workSeconds: block.workSeconds,
          restSeconds: block.restSeconds,
          capSeconds: block.capSeconds,
        })),
      )
      .returning();

    const blockIdByOrderIndex = new Map(insertedBlocks.map((row) => [row.orderIndex, row.id]));

    const exerciseValues = blocks.flatMap((block, blockOrderIndex) => {
      const blockId = blockIdByOrderIndex.get(blockOrderIndex);
      if (!blockId) {
        throw new Error("insertBlockTree: block insert missing for orderIndex");
      }
      return block.exercises.map((exercise, orderIndex) => ({
        blockId,
        exerciseId: exercise.exerciseId,
        orderIndex,
        setCount: exercise.setCount,
        targetReps: exercise.targetReps,
        targetRepsMax: exercise.targetRepsMax,
        targetWeightKg: exercise.targetWeightKg?.toString() ?? null,
        targetSeconds: exercise.targetSeconds,
        targetDistanceMeters: exercise.targetDistanceMeters?.toString() ?? null,
        restSeconds: exercise.restSeconds,
        notes: exercise.notes,
      }));
    });

    const insertedExercises =
      exerciseValues.length > 0 ? await tx.insert(workoutExercises).values(exerciseValues).returning() : [];

    const exercisesByBlockId = this.groupExercisesByBlockId(insertedExercises);

    return insertedBlocks
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((row) => ({
        ...this.toBlock(row),
        exercises: (exercisesByBlockId.get(row.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex),
      }));
  }

  private groupExercisesByBlockId(rows: WorkoutExerciseRow[]): Map<string, WorkoutExercise[]> {
    const map = new Map<string, WorkoutExercise[]>();
    for (const row of rows) {
      const list = map.get(row.blockId) ?? [];
      list.push(this.toExercise(row));
      map.set(row.blockId, list);
    }
    return map;
  }

  private toTemplate(row: WorkoutTemplateRow): Omit<WorkoutTemplate, "blocks"> {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      name: row.name,
      activity: keepKnownOrFallback(row.activity, ACTIVITIES, "strength"),
      basedOnTemplateId: row.basedOnTemplateId,
      notes: row.notes,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toBlock(row: WorkoutBlockRow): Omit<WorkoutBlock, "exercises"> {
    return {
      id: row.id,
      templateId: row.templateId,
      type: keepKnownOrFallback(row.type, WORKOUT_BLOCK_TYPES, "straight_sets"),
      orderIndex: row.orderIndex,
      name: row.name,
      rounds: row.rounds,
      workSeconds: row.workSeconds,
      restSeconds: row.restSeconds,
      capSeconds: row.capSeconds,
    };
  }

  private toExercise(row: WorkoutExerciseRow): WorkoutExercise {
    return {
      id: row.id,
      blockId: row.blockId,
      exerciseId: row.exerciseId,
      orderIndex: row.orderIndex,
      setCount: row.setCount,
      targetReps: row.targetReps,
      targetRepsMax: row.targetRepsMax,
      targetWeightKg: row.targetWeightKg === null ? null : Number(row.targetWeightKg),
      targetSeconds: row.targetSeconds,
      targetDistanceMeters: row.targetDistanceMeters === null ? null : Number(row.targetDistanceMeters),
      restSeconds: row.restSeconds,
      notes: row.notes,
    };
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
