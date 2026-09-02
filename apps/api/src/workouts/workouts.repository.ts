import { Injectable, Inject } from "@nestjs/common";
import {
  ACTIVITIES,
  Activity,
  WORKOUT_BLOCK_TYPES,
  WorkoutBlock,
  WorkoutBlockType,
  WorkoutExercise,
  WorkoutTemplate,
} from "@forjd/domain";
import { and, eq, inArray, isNull, SQL, sql } from "drizzle-orm";

import { Database, DRIZZLE } from "../database/database.module";
import {
  WorkoutBlockRow,
  WorkoutExerciseRow,
  WorkoutTemplateRow,
  workoutBlocks,
  workoutExercises,
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
 * `basedOnTemplateId` is deliberately absent -- Phase D's create endpoint always writes
 * `null`. The "customise this preset" flow that sets it belongs to Phase G's builder screen,
 * which does not exist yet; inventing the field here before there is a caller for it would
 * be exactly the "generality nobody asked for" YAGNI warns against.
 */
export interface CreateWorkoutTemplateInput {
  name: string;
  activity: Activity;
  notes: string | null;
  estimatedDurationMinutes: number | null;
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

/** A template list row plus the one derived field the list needs and nothing else. */
export interface WorkoutTemplateSummaryRow {
  id: string;
  ownerUserId: string | null;
  name: string;
  activity: Activity;
  estimatedDurationMinutes: number | null;
  exerciseCount: number;
}

export interface WorkoutTemplatePage {
  rows: WorkoutTemplateSummaryRow[];
  hasMore: boolean;
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
          basedOnTemplateId: null,
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
}
