import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  EQUIPMENT,
  Equipment,
  EXERCISE_CATEGORIES,
  Exercise,
  EXERCISE_GOALS,
  ExerciseCategory,
  ExerciseGoal,
  EXERCISE_MEASURES,
  ExerciseMeasure,
  FORCES,
  Force,
  LEVELS,
  Level,
  MECHANICS,
  Mechanic,
  MUSCLE_GROUPS,
  MuscleGroup,
} from "@forjd/domain";
import { and, eq, isNull, sql } from "drizzle-orm";

import { Database, DRIZZLE } from "../database/database.module";
import { exerciseFavourites, ExerciseRow, exercises } from "../database/schema/exercises.schema";

/**
 * Postgres unique_violation. Checks both the top-level `code` (a raw pg error) and
 * `cause.code` (drizzle-orm's node-postgres driver wraps every query failure in a
 * `DrizzleQueryError` with the real pg error attached as `.cause`, confirmed by reading
 * `drizzle-orm/errors.cjs` -- `UsersRepository`'s equivalent helper only checks the former
 * and is worth revisiting, see the follow-up flagged alongside this phase).
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/** Narrows a `text[]` column back to the known vocabulary -- see users.repository.ts for why. */
function keepKnown<T extends string>(values: string[], known: readonly T[]): T[] {
  return values.filter((value): value is T => (known as readonly string[]).includes(value));
}

/** Narrows a nullable `text` column, dropping a value that has left the known set. */
function keepKnownNullable<T extends string>(
  value: string | null,
  known: readonly T[],
): T | null {
  if (value === null) return null;
  return (known as readonly string[]).includes(value) ? (value as T) : null;
}

export interface UpsertCatalogueExerciseInput {
  source: string;
  sourceId: string;
  name: string;
  slug: string;
  category: ExerciseCategory;
  goal: ExerciseGoal;
  measure: ExerciseMeasure;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  force: Force | null;
  level: Level | null;
  mechanic: Mechanic | null;
  instructions: string[];
  imageKeys: string[];
  description: string | null;
}

export interface CreateCustomExerciseInput {
  name: string;
  category: ExerciseCategory;
  goal: ExerciseGoal;
  measure: ExerciseMeasure;
  primaryMuscles: MuscleGroup[];
  equipment: Equipment[];
  description: string | null;
}

/** Only the fields `s_newExercise`'s edit mode can change -- name, category, goal, measure, muscles, equipment, description. */
export type UpdateCustomExerciseInput = Partial<CreateCustomExerciseInput>;

/**
 * Data access for both the ingested catalogue and user-authored custom exercises (ADR-017).
 * Never throws NotFoundException and never distinguishes "no such row" from "not yours" --
 * both return `null`/`false`, and turning that into a 404 (never a 403) is the service's job,
 * same division of responsibility as AthletesService over UsersRepository.
 */
@Injectable()
export class ExercisesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async upsertCatalogueExercise(input: UpsertCatalogueExerciseInput): Promise<Exercise> {
    const [row] = await this.db
      .insert(exercises)
      .values({
        ownerUserId: null,
        name: input.name,
        slug: input.slug,
        category: input.category,
        goal: input.goal,
        measure: input.measure,
        primaryMuscles: input.primaryMuscles,
        secondaryMuscles: input.secondaryMuscles,
        equipment: input.equipment,
        force: input.force,
        level: input.level,
        mechanic: input.mechanic,
        instructions: input.instructions,
        imageKeys: input.imageKeys,
        description: input.description,
        source: input.source,
        sourceId: input.sourceId,
      })
      .onConflictDoUpdate({
        // Matches the partial unique index `exercises_source_unique` -- Postgres requires the
        // ON CONFLICT target to name the exact index, not just the columns, when the index is
        // partial (`WHERE owner_user_id IS NULL`).
        target: [exercises.source, exercises.sourceId],
        targetWhere: isNull(exercises.ownerUserId),
        set: {
          name: input.name,
          slug: input.slug,
          category: input.category,
          goal: input.goal,
          measure: input.measure,
          primaryMuscles: input.primaryMuscles,
          secondaryMuscles: input.secondaryMuscles,
          equipment: input.equipment,
          force: input.force,
          level: input.level,
          mechanic: input.mechanic,
          instructions: input.instructions,
          imageKeys: input.imageKeys,
          description: input.description,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (!row) {
      throw new Error("upsertCatalogueExercise: insert returned no row");
    }
    return this.toExercise(row);
  }

  async findById(id: string): Promise<Exercise | null> {
    const [row] = await this.db
      .select()
      .from(exercises)
      .where(and(eq(exercises.id, id), isNull(exercises.deletedAt)));
    return row ? this.toExercise(row) : null;
  }

  async createCustomExercise(
    ownerUserId: string,
    input: CreateCustomExerciseInput,
  ): Promise<Exercise> {
    try {
      const [row] = await this.db
        .insert(exercises)
        .values({
          ownerUserId,
          name: input.name,
          slug: slugify(input.name),
          category: input.category,
          goal: input.goal,
          measure: input.measure,
          primaryMuscles: input.primaryMuscles,
          secondaryMuscles: [],
          equipment: input.equipment,
          force: null,
          level: null,
          mechanic: null,
          instructions: [],
          imageKeys: [],
          description: input.description,
          source: null,
          sourceId: null,
        })
        .returning();

      if (!row) {
        throw new Error("createCustomExercise: insert returned no row");
      }
      return this.toExercise(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("An exercise with that name already exists");
      }
      throw error;
    }
  }

  /** Returns `null` for a missing, deleted, or not-owned exercise -- see the class docblock. */
  async updateCustomExercise(
    id: string,
    ownerUserId: string,
    patch: UpdateCustomExerciseInput,
  ): Promise<Exercise | null> {
    const set: Partial<typeof exercises.$inferInsert> = { updatedAt: sql`now()` as unknown as Date };
    if (patch.name !== undefined) {
      set.name = patch.name;
      set.slug = slugify(patch.name);
    }
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.goal !== undefined) set.goal = patch.goal;
    if (patch.measure !== undefined) set.measure = patch.measure;
    if (patch.primaryMuscles !== undefined) set.primaryMuscles = patch.primaryMuscles;
    if (patch.equipment !== undefined) set.equipment = patch.equipment;
    if (patch.description !== undefined) set.description = patch.description;

    try {
      const [row] = await this.db
        .update(exercises)
        .set(set)
        .where(
          and(
            eq(exercises.id, id),
            eq(exercises.ownerUserId, ownerUserId),
            isNull(exercises.deletedAt),
          ),
        )
        .returning();
      return row ? this.toExercise(row) : null;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("An exercise with that name already exists");
      }
      throw error;
    }
  }

  /** Soft delete only -- Phase 3 session history references exercises by id (ADR-017). */
  async softDeleteCustomExercise(id: string, ownerUserId: string): Promise<boolean> {
    const rows = await this.db
      .update(exercises)
      .set({ deletedAt: sql`now()` as unknown as Date })
      .where(
        and(
          eq(exercises.id, id),
          eq(exercises.ownerUserId, ownerUserId),
          isNull(exercises.deletedAt),
        ),
      )
      .returning({ id: exercises.id });
    return rows.length > 0;
  }

  /** Idempotent -- starring an already-favourited exercise twice is not an error. */
  async addFavourite(userId: string, exerciseId: string): Promise<void> {
    await this.db
      .insert(exerciseFavourites)
      .values({ userId, exerciseId })
      .onConflictDoNothing({
        target: [exerciseFavourites.userId, exerciseFavourites.exerciseId],
      });
  }

  async removeFavourite(userId: string, exerciseId: string): Promise<void> {
    await this.db
      .delete(exerciseFavourites)
      .where(
        and(
          eq(exerciseFavourites.userId, userId),
          eq(exerciseFavourites.exerciseId, exerciseId),
        ),
      );
  }

  async isFavourite(userId: string, exerciseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ exerciseId: exerciseFavourites.exerciseId })
      .from(exerciseFavourites)
      .where(
        and(
          eq(exerciseFavourites.userId, userId),
          eq(exerciseFavourites.exerciseId, exerciseId),
        ),
      );
    return row !== undefined;
  }

  /**
   * Maps a raw row to the canonical `Exercise` (@forjd/domain) -- repositories never return
   * rows, per the house convention every other repository in this codebase follows. The
   * vocabulary columns are `text`/`text[]`, not Postgres enums, so a value that has since
   * left the known set is filtered here rather than reaching a response that would fail its
   * own schema (same reasoning as `keepKnown` in users.repository.ts).
   */
  private toExercise(row: ExerciseRow): Exercise {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      name: row.name,
      slug: row.slug,
      category: keepKnownNullable(row.category, EXERCISE_CATEGORIES) ?? "strength",
      goal: keepKnownNullable(row.goal, EXERCISE_GOALS) ?? "strength",
      measure: keepKnownNullable(row.measure, EXERCISE_MEASURES) ?? "weight",
      primaryMuscles: keepKnown(row.primaryMuscles, MUSCLE_GROUPS),
      secondaryMuscles: keepKnown(row.secondaryMuscles, MUSCLE_GROUPS),
      equipment: keepKnown(row.equipment, EQUIPMENT),
      force: keepKnownNullable(row.force, FORCES),
      level: keepKnownNullable(row.level, LEVELS),
      mechanic: keepKnownNullable(row.mechanic, MECHANICS),
      instructions: row.instructions,
      imageKeys: row.imageKeys,
      description: row.description,
      source: row.source,
      sourceId: row.sourceId,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Simple, stable, ASCII-safe slug. Not unique-constrained on purpose: the exercise *name* is
 * (per owner), so two names can legitimately collapse to the same slug -- the slug is a
 * display/URL convenience, not an identifier.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
