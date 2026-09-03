import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { Database } from "../database/database.module";
import { exercises } from "../database/schema/exercises.schema";
import {
  programWorkouts,
  programs,
  workoutBlocks,
  workoutExercises,
  workoutTemplates,
} from "../database/schema/workouts.schema";
import { PRESET_SET_COUNT, SeedProgram } from "./seed/program-catalogue";

export interface SeedProgramResult {
  slug: string;
  programId: string;
  /** Templates created for the first time by this run. */
  created: number;
  /** Templates that already existed and were rewritten in place. */
  updated: number;
  /** Join rows whose workout the seed file no longer names -- unlinked and soft-deleted. */
  pruned: number;
}

/**
 * Thrown, never logged-and-skipped. A program missing a lift is worse than a seed that refuses to
 * run: the athlete would see a workout the design says has four exercises with three in it, and
 * nothing anywhere would be red.
 */
export class UnresolvedExerciseError extends Error {
  constructor(readonly slugs: readonly string[]) {
    super(
      `Cannot seed programs: ${slugs.length} exercise slug(s) are not in the catalogue -- ` +
        `${slugs.join(", ")}. Run \`pnpm --filter @forjd/api exercises:load\` first, and if a ` +
        `slug has been renamed upstream, correct EXERCISE_SLUG_BY_NAME rather than letting the ` +
        `seed skip it.`,
    );
    this.name = "UnresolvedExerciseError";
  }
}

/**
 * Writes the nine preset programs and their catalogue workout templates.
 *
 * **Separate from `WorkoutsRepository` on purpose.** That class is the request path, and every
 * method on it is owner-scoped -- `createTemplate` takes a non-null `ownerUserId` and
 * `updateTemplate` matches on it, which is exactly what keeps one athlete out of another's
 * templates. Catalogue rows have a *null* owner, so seeding through it would mean relaxing those
 * signatures to accept null and trusting every future caller to pass the right thing. A separate
 * class used only by a CLI script keeps the null-owner write path out of the request path.
 *
 * **Idempotent, because it runs on every deploy** (alongside `exercises:load` in
 * `deploy-api.yml`). A program is keyed by its slug -- backed by the `programs_preset_slug_key`
 * partial unique index -- and its templates are found again through the `program_workouts` join
 * rows already pointing at them, matched by the workout’s name. That is why no `slug` column was
 * added to `workout_templates`: the join row is already the authoritative link, and a second key
 * would be a second thing that can disagree with it. See `seedProgram` for why the match is by
 * name rather than by position.
 *
 * Re-running against an unchanged catalogue rewrites the same values and creates nothing. Ids
 * stay stable across runs, which matters because `workout_sessions.template_id` references them:
 * a seed that recreated its templates would orphan every session performed against a preset.
 */
export class ProgramsSeedRepository {
  constructor(private readonly db: Database) {}

  /**
   * Resolves catalogue slugs to ids in one query, and throws naming *every* missing slug rather
   * than the first -- one run, one complete list to fix.
   */
  async resolveExerciseIds(slugs: readonly string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(slugs)];
    if (wanted.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select({ id: exercises.id, slug: exercises.slug })
      .from(exercises)
      .where(
        and(
          inArray(exercises.slug, wanted),
          isNull(exercises.ownerUserId),
          isNull(exercises.deletedAt),
        ),
      );

    const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
    const missing = wanted.filter((slug) => !bySlug.has(slug));
    if (missing.length > 0) {
      throw new UnresolvedExerciseError(missing);
    }

    return bySlug;
  }

  /**
   * One transaction per program, not one for all nine. A failure part-way through leaves the
   * programs already written intact and consistent, and the next run completes the rest -- the
   * same per-record choice `loadCatalogue` documents. What must be atomic is a single program and
   * its workouts, because a program visible without its workouts is the hollowed-out state this
   * phase exists to prevent.
   */
  async seedProgram(
    program: SeedProgram,
    exerciseIdBySlug: ReadonlyMap<string, string>,
    slugForName: Readonly<Record<string, string>>,
  ): Promise<SeedProgramResult> {
    return this.db.transaction(async (tx) => {
      const [programRow] = await tx
        .insert(programs)
        .values({
          ownerUserId: null,
          name: program.name,
          slug: program.slug,
          category: program.category,
          level: program.level,
          daysPerWeek: program.daysPerWeek,
          durationWeeks: program.durationWeeks,
          description: program.description,
          version: program.version,
        })
        .onConflictDoUpdate({
          // Names the partial index exactly: Postgres requires the `WHERE` on the ON CONFLICT
          // target when the unique index is partial, the same way `exercises_source_unique` does.
          target: programs.slug,
          targetWhere: isNull(programs.ownerUserId),
          set: {
            name: program.name,
            category: program.category,
            level: program.level,
            daysPerWeek: program.daysPerWeek,
            durationWeeks: program.durationWeeks,
            description: program.description,
            version: program.version,
            // A preset soft-deleted by hand comes back on the next seed rather than staying
            // half-present -- the seed file is the source of truth for what the catalogue holds.
            deletedAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning();

      if (!programRow) {
        throw new Error(`seedProgram(${program.slug}): upsert returned no row`);
      }

      const existing = await tx
        .select({ join: programWorkouts, template: workoutTemplates })
        .from(programWorkouts)
        .innerJoin(workoutTemplates, eq(workoutTemplates.id, programWorkouts.templateId))
        .where(eq(programWorkouts.programId, programRow.id))
        .orderBy(asc(programWorkouts.orderIndex));

      /**
       * Matched **by workout name, not by position**.
       *
       * Position is the obvious key and the wrong one. Reordering a program's workouts in
       * `program-catalogue.ts` -- swapping "Push A" and "Pull A", say -- would leave each join row
       * where it was and rewrite the template sitting there with whatever workout now occupies
       * that index. The end content would be right, but the template that *was* "Push A" would
       * silently become "Pull A" while keeping its id, and every session already performed
       * against it (`workout_sessions.template_id`) would start pointing at a different workout.
       *
       * The name is the workout's real identity here -- it is what the overview list shows and
       * what `program-catalogue.spec.ts` already forbids duplicating within a program. Renaming a
       * workout therefore retires the old template (soft-deleted below) and creates a new one,
       * which is the honest outcome: a session logged against "Push A" should keep saying so.
       */
      const existingByName = new Map(existing.map((row) => [row.template.name, row]));
      const seededNames = new Set(program.workouts.map((workout) => workout.name));

      let created = 0;
      let updated = 0;

      for (const [orderIndex, workout] of program.workouts.entries()) {
        const match = existingByName.get(workout.name);
        let templateId: string;

        if (match) {
          templateId = match.template.id;
          await tx
            .update(workoutTemplates)
            .set({ activity: workout.activity, deletedAt: null, updatedAt: sql`now()` })
            .where(eq(workoutTemplates.id, templateId));
          // Repositioned rather than left where it was, so a reorder in the seed file is reflected
          // in the overview's order without any template changing what it means.
          if (match.join.orderIndex !== orderIndex) {
            await tx
              .update(programWorkouts)
              .set({ orderIndex })
              .where(eq(programWorkouts.id, match.join.id));
          }
          // The whole block tree is replaced rather than diffed, matching how
          // `WorkoutsRepository.updateTemplate` treats a re-saved workout: the seed rewrites a
          // whole workout at a time, so diffing would be machinery for an edit that never happens.
          await tx.delete(workoutBlocks).where(eq(workoutBlocks.templateId, templateId));
          updated += 1;
        } else {
          const [templateRow] = await tx
            .insert(workoutTemplates)
            .values({ ownerUserId: null, name: workout.name, activity: workout.activity })
            .returning();
          if (!templateRow) {
            throw new Error(`seedProgram(${program.slug}): template insert returned no row`);
          }
          templateId = templateRow.id;

          await tx.insert(programWorkouts).values({
            programId: programRow.id,
            templateId,
            orderIndex,
            // Null for a preset: it prescribes a set of workouts, not a calendar. Only the
            // builder's custom programs pin a workout to a weekday.
            dayOfWeek: null,
          });
          created += 1;
        }

        await this.insertPresetBlock(
          tx,
          templateId,
          workout.exercises,
          exerciseIdBySlug,
          slugForName,
        );
      }

      // Whatever the seed file no longer names -- a removed workout or the old side of a rename.
      const extras = existing.filter((row) => !seededNames.has(row.template.name));
      if (extras.length > 0) {
        await tx.delete(programWorkouts).where(
          inArray(
            programWorkouts.id,
            extras.map((row) => row.join.id),
          ),
        );
        // Soft delete, never hard: a session may already reference this template, and
        // `program_workouts.template_id` is `restrict` precisely so a still-linked template
        // cannot vanish. Unlinking first and marking deleted second keeps history readable.
        await tx
          .update(workoutTemplates)
          .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
          .where(
            inArray(
              workoutTemplates.id,
              extras.map((row) => row.template.id),
            ),
          );
      }

      return {
        slug: program.slug,
        programId: programRow.id,
        created,
        updated,
        pruned: extras.length,
      };
    });
  }

  /**
   * One `straight_sets` block holding the workout's exercises in order.
   *
   * The design's preset workouts have no block structure to preserve -- `workoutsForProgram`
   * gives a flat list of names -- so inventing supersets or intervals here would be authoring
   * training structure the design never specifies. `setCount` is 3 and every target is null for
   * the same reason: that is what `s_programOverview` renders and what `buildSession` starts.
   */
  private async insertPresetBlock(
    tx: Database,
    templateId: string,
    exerciseNames: readonly string[],
    exerciseIdBySlug: ReadonlyMap<string, string>,
    slugForName: Readonly<Record<string, string>>,
  ): Promise<void> {
    const [blockRow] = await tx
      .insert(workoutBlocks)
      .values({ templateId, type: "straight_sets", orderIndex: 0, name: null })
      .returning();
    if (!blockRow) {
      throw new Error(`insertPresetBlock(${templateId}): block insert returned no row`);
    }

    const values = exerciseNames.map((name, orderIndex) => {
      const slug = slugForName[name];
      const exerciseId = slug === undefined ? undefined : exerciseIdBySlug.get(slug);
      if (exerciseId === undefined) {
        // Unreachable when the caller resolved the whole map up front, which `seedPrograms` does.
        // Kept because "silently seed a workout with fewer exercises than the design specifies" is
        // precisely the failure this phase refuses, and an unreachable throw is cheaper than
        // finding out from a user.
        throw new UnresolvedExerciseError([slug ?? name]);
      }
      return { blockId: blockRow.id, exerciseId, orderIndex, setCount: PRESET_SET_COUNT };
    });

    if (values.length > 0) {
      await tx.insert(workoutExercises).values(values);
    }
  }
}
