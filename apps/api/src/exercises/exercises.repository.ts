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
import { and, eq, inArray, isNull, SQL, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

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
 * The last row of the previous page, as the full sort key. Both halves are needed: `name`
 * alone is not unique, and `id` alone does not match the ordering.
 */
export interface ExerciseCursor {
  name: string;
  id: string;
}

export interface ListExercisesFilter {
  /** Whose list this is -- decides both visibility and whose favourites are reported. */
  userId: string;
  q?: string;
  category?: ExerciseCategory;
  muscle?: MuscleGroup;
  equipment?: Equipment;
  favouriteOnly?: boolean;
  after?: ExerciseCursor;
  limit: number;
}

/**
 * `isFavourite` rides along with the row rather than being fetched per exercise afterwards.
 * The obvious alternative -- list the ids, then ask `isFavourite` for each -- is an N+1 that
 * would issue 51 queries for a 50-row page.
 */
export interface ExerciseWithFavourite {
  exercise: Exercise;
  isFavourite: boolean;
}

export interface ExercisePage {
  rows: ExerciseWithFavourite[];
  /** True when at least one further row matched, so the caller can mint a cursor. */
  hasMore: boolean;
}

/**
 * Catalogue rows (no owner) plus this user's own. Never anybody else's custom exercise --
 * the single place that rule is expressed, so both the list and the detail read inherit it.
 */
function visibleTo(userId: string): SQL {
  return sql`(${exercises.ownerUserId} is null or ${exercises.ownerUserId} = ${userId}::uuid)`;
}

/**
 * A correlated EXISTS rather than a LEFT JOIN. A join against `exercise_favourites` would
 * duplicate the exercise row per matching favourite -- harmless while the join is on
 * `(user_id, exercise_id)` and that pair is unique, but only by coincidence, and a
 * `hasMore`/`limit` computed over duplicated rows would page wrongly the day that stopped
 * being true. EXISTS answers the boolean question directly and cannot change the row count.
 */
function favouriteExists(userId: string): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${exerciseFavourites}
    where ${exerciseFavourites.exerciseId} = ${exercises.id}
      and ${exerciseFavourites.userId} = ${userId}::uuid
  )`;
}

/**
 * Full-text search OR a trigram substring match, both over `name`.
 *
 * Each covers what the other cannot. `search_vector` (migration 0006, GIN-indexed) matches
 * whole lexemes with stemming, so "squats" finds "Squat" -- but it cannot match "bulgar",
 * because a partial word is not a lexeme. The `ILIKE %term%` arm is the one that answers
 * while the user is still typing, and the `gin_trgm_ops` index on `name` is what keeps it
 * from being a sequential scan of the catalogue.
 *
 * **The term is bound, never interpolated,** and the LIKE metacharacters are escaped before
 * binding. Without the escape a search for `%` is not an injection but is still a bug: it
 * would match every exercise in the database and quietly return the whole catalogue as if it
 * were a search result.
 */
function searchCondition(term: string): SQL {
  const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

  // `search_vector` is deliberately absent from `exercises.schema.ts` -- modelling a generated
  // column there would make a future `db:generate` try to re-create what migration 0006 already
  // did by hand. That schema file's docblock says to reach it through a raw template, which is
  // what this is; the table reference is still the schema object, so a rename stays honest.
  return sql`(
    ${exercises}.search_vector @@ plainto_tsquery('english', ${term})
    or ${exercises.name} ilike ${pattern}
  )`;
}

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

  /**
   * The read used by `GET /exercises/:id`.
   *
   * Takes the caller's id rather than leaving visibility to the service, because "which rows
   * exist for this user" is a property of the query: a service-side check would have to fetch
   * a row it is not allowed to see in order to decide it may not see it. Returns `null` for
   * missing, deleted and not-yours alike -- see the class docblock.
   */
  async findByIdForUser(id: string, userId: string): Promise<ExerciseWithFavourite | null> {
    const [row] = await this.db
      .select({ exercise: exercises, isFavourite: favouriteExists(userId) })
      .from(exercises)
      .where(and(eq(exercises.id, id), isNull(exercises.deletedAt), visibleTo(userId)));

    return row ? { exercise: this.toExercise(row.exercise), isFavourite: row.isFavourite } : null;
  }

  /**
   * The read behind `GET /exercises` -- browse, search, filter and paginate in one query.
   *
   * **Keyset, not offset.** `after` names the last row of the previous page as the tuple
   * `(name, id)`, and the next page is everything sorting strictly after it. Offset would
   * re-scan the skipped rows on every page and, worse, shift its window whenever a row was
   * added or removed mid-scroll -- the reader silently sees a duplicate or misses an entry,
   * and neither shows up as an error. Custom exercises are created and deleted by the same
   * user who is scrolling, so that is not a hypothetical here.
   *
   * **The sort key must be total.** Two exercises can genuinely share a name, so `name` alone
   * leaves their relative order undefined and a cursor at one of them would skip or repeat
   * the other. `(name, id)` breaks every tie, and Postgres compares the row constructor with
   * the same collation the ORDER BY uses, so the comparison and the ordering cannot disagree.
   *
   * **`hasMore` costs nothing.** One extra row is requested and discarded, rather than a
   * second `count(*)` over the whole match set for a number that is stale on arrival.
   */
  async listExercises(filter: ListExercisesFilter): Promise<ExercisePage> {
    const conditions: SQL[] = [isNull(exercises.deletedAt), visibleTo(filter.userId)];

    if (filter.category) {
      conditions.push(eq(exercises.category, filter.category));
    }
    // `= ANY(column)` rather than an `@>` array containment: the filter is a single value, and
    // ANY reads as the question actually being asked ("is this muscle among the primary ones").
    if (filter.muscle) {
      conditions.push(sql`${filter.muscle} = any(${exercises.primaryMuscles})`);
    }
    if (filter.equipment) {
      conditions.push(sql`${filter.equipment} = any(${exercises.equipment})`);
    }
    if (filter.q) {
      conditions.push(searchCondition(filter.q));
    }
    if (filter.favouriteOnly) {
      conditions.push(favouriteExists(filter.userId));
    }
    if (filter.after) {
      conditions.push(
        sql`(${exercises.name}, ${exercises.id}) > (${filter.after.name}, ${filter.after.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select({ exercise: exercises, isFavourite: favouriteExists(filter.userId) })
      .from(exercises)
      .where(and(...conditions))
      .orderBy(exercises.name, exercises.id)
      .limit(filter.limit + 1);

    const page = rows.slice(0, filter.limit);

    return {
      rows: page.map((row) => ({
        exercise: this.toExercise(row.exercise),
        isFavourite: row.isFavourite,
      })),
      hasMore: rows.length > filter.limit,
    };
  }

  /**
   * Which of the given ids are visible to this user (catalogue or their own custom
   * exercise), not soft-deleted -- the check `WorkoutsRepository` runs against every
   * `exerciseId` a template references, so a caller cannot forge someone else's private
   * custom exercise into their own template by guessing its UUID. One query for the whole
   * set rather than `findByIdForUser` per id, which would be an N+1 for a multi-block
   * template with several exercises each.
   */
  async findVisibleIds(ids: string[], userId: string): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const rows = await this.db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(inArray(exercises.id, ids), isNull(exercises.deletedAt), visibleTo(userId)));

    return new Set(rows.map((row) => row.id));
  }

  /**
   * Full `Exercise` records for the visible subset of the given ids, keyed by id -- what
   * `WorkoutSessionsService` needs to snapshot each session exercise's `measure` at upload
   * time from the exercise the server looked up, never from a client-declared copy of a fact
   * the server already owns. One bulk query for the whole set, same reasoning as
   * `findVisibleIds`.
   */
  async findManyVisibleForUser(ids: string[], userId: string): Promise<Map<string, Exercise>> {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select()
      .from(exercises)
      .where(and(inArray(exercises.id, ids), isNull(exercises.deletedAt), visibleTo(userId)));

    return new Map(rows.map((row) => [row.id, this.toExercise(row)]));
  }

  /**
   * The read behind `GET /exercises/catalogue` (Phase H) -- the whole visible set in one
   * unpaginated query, for the on-device store to mirror. Deliberately not `listExercises`
   * with `limit: Infinity`: that method's contract is a page plus a lookahead row, and this
   * one's is "give me everything so I can walk offline," a different enough shape that
   * forcing them through one method would mean an unused `hasMore` here or an unused
   * unpaginated mode there.
   *
   * **`(name, id)` order, always** -- not for pagination (there is none), but so
   * `ExercisesService`'s version hash sees a stable row order across two calls with an
   * identical underlying set. An unordered `SELECT` would let Postgres return the same rows
   * in a different sequence between two otherwise-identical queries, which would change the
   * hash and force a pointless re-sync.
   */
  async listForSync(userId: string): Promise<ExerciseWithFavourite[]> {
    const rows = await this.db
      .select({ exercise: exercises, isFavourite: favouriteExists(userId) })
      .from(exercises)
      .where(and(isNull(exercises.deletedAt), visibleTo(userId)))
      .orderBy(exercises.name, exercises.id);

    return rows.map((row) => ({
      exercise: this.toExercise(row.exercise),
      isFavourite: row.isFavourite,
    }));
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
    // `PgUpdateSetSource`, not `Partial<$inferInsert>`. The latter accepts only real column
    // values, so smuggling a `SQL` fragment through it needs an `as unknown as Date` -- a
    // total type-check bypass, which would just as happily hide a fragment that genuinely did
    // not match its column. Drizzle already publishes the type that allows a value *or* a SQL
    // expression per column, which is exactly what an update set is.
    const set: PgUpdateSetSource<typeof exercises> = { updatedAt: sql`now()` };
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
      .set({ deletedAt: sql`now()` })
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
