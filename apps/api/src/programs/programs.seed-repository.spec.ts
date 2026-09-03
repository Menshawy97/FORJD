import { readFileSync } from "fs";

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Pool } from "pg";

import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import {
  programEnrollments,
  programWorkouts,
  programs,
  workoutBlocks,
  workoutExercises,
  workoutTemplates,
} from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { SNAPSHOT_PATH, parseSnapshot } from "../exercises/ingest/load";
import { ProgramsSeedRepository, UnresolvedExerciseError } from "./programs.seed-repository";
import { CURATED_EXERCISES } from "./seed/curated-exercises";
import { EXERCISE_SLUG_BY_NAME, SEED_PROGRAMS, SeedProgram } from "./seed/program-catalogue";
import { seedPrograms } from "./seed/seed";

/**
 * Exercised against real Postgres, not a mock.
 *
 * Everything worth testing here *is* the SQL: an upsert that has to name a partial unique index
 * by its `WHERE` clause, a join row reused across runs so template ids stay stable, and a
 * `restrict` foreign key that must be respected when pruning. A fake would only prove the test
 * author's assumptions about all three. Same rationale as `ExercisesRepository.spec.ts` and
 * `workouts.schema.spec.ts`.
 *
 * The catalogue rows it seeds against come from the same committed snapshot `exercises:load`
 * reads, inserted only where they are missing and removed again afterwards -- see
 * `ensureMappedExercisesExist` for why this suite provisions its own narrow set rather than
 * requiring, or performing, a full catalogue load.
 */
describe("ProgramsSeedRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ProgramsSeedRepository;
  let exercisesRepository: ExercisesRepository;

  const seededSlugs = SEED_PROGRAMS.map((program) => program.slug);
  const allMappedSlugs = Object.values(EXERCISE_SLUG_BY_NAME);

  /** Every template this suite created, reached through the join rows before they are removed. */
  const templateIdsOfSeededPrograms = async (): Promise<string[]> => {
    const rows = await db
      .select({ templateId: programWorkouts.templateId })
      .from(programWorkouts)
      .innerJoin(programs, eq(programs.id, programWorkouts.programId))
      .where(inArray(programs.slug, seededSlugs));
    return rows.map((row) => row.templateId);
  };

  const readProgram = async (slug: string) => {
    const [row] = await db
      .select()
      .from(programs)
      .where(and(eq(programs.slug, slug), isNull(programs.ownerUserId)));
    return row;
  };

  const readWorkouts = async (programId: string) =>
    db
      .select({ join: programWorkouts, template: workoutTemplates })
      .from(programWorkouts)
      .innerJoin(workoutTemplates, eq(workoutTemplates.id, programWorkouts.templateId))
      .where(eq(programWorkouts.programId, programId))
      .orderBy(asc(programWorkouts.orderIndex));

  const readExerciseIds = async (templateId: string): Promise<string[]> => {
    const rows = await db
      .select({ exerciseId: workoutExercises.exerciseId })
      .from(workoutExercises)
      .innerJoin(workoutBlocks, eq(workoutBlocks.id, workoutExercises.blockId))
      .where(eq(workoutBlocks.templateId, templateId))
      .orderBy(asc(workoutExercises.orderIndex));
    return rows.map((row) => row.exerciseId);
  };

  const reseed = async (program: SeedProgram) =>
    repository.seedProgram(
      program,
      await repository.resolveExerciseIds(allMappedSlugs),
      EXERCISE_SLUG_BY_NAME,
    );

  /**
   * Catalogue rows this suite inserted itself, and must therefore remove again.
   *
   * **It seeds the exercises it needs rather than requiring `exercises:load` to have run.**
   * Loading all 873 was tried and rejected: the catalogue is visible to every user, so it made
   * `GET /exercises/catalogue` serialize 873 full detail rows, which widened a latent race in
   * `exercises.e2e-spec.ts` (two catalogue reads either side of a favourite toggle) from
   * invisible to reliably red. A suite should not reshape the database every other suite runs
   * against.
   *
   * Nothing is weakened by the narrower set: the rows still come from the *committed snapshot*,
   * looked up by the exact slug `EXERCISE_SLUG_BY_NAME` names, so a slug that stopped existing
   * upstream still cannot be seeded here. Proving the map resolves against the snapshot is
   * `program-catalogue.spec.ts`'s job, and it does it with no database at all; this suite's job
   * is the SQL.
   */
  const insertedExerciseSlugs: string[] = [];

  const ensureMappedExercisesExist = async (): Promise<void> => {
    const snapshot = parseSnapshot(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown);
    const bySlug = new Map(snapshot.map((exercise) => [exercise.slug, exercise]));

    const present = await db
      .select({ slug: exercises.slug })
      .from(exercises)
      .where(and(inArray(exercises.slug, allMappedSlugs), isNull(exercises.ownerUserId)));
    const alreadyThere = new Set(present.map((row) => row.slug));

    for (const slug of new Set(allMappedSlugs)) {
      // A developer database usually has the whole catalogue loaded already; leaving those rows
      // alone is what keeps this suite's teardown from deleting real ones.
      if (alreadyThere.has(slug)) continue;

      const fromSnapshot = bySlug.get(slug);
      // The four curated additions are deliberately absent from the snapshot -- `seedPrograms`
      // upserts them itself, and the teardown removes them by their own slugs.
      if (!fromSnapshot) continue;

      await exercisesRepository.upsertCatalogueExercise(fromSnapshot);
      insertedExerciseSlugs.push(slug);
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool);
    repository = new ProgramsSeedRepository(db);
    exercisesRepository = new ExercisesRepository(db);
    await ensureMappedExercisesExist();
  });

  afterAll(async () => {
    // Unlink before deleting templates: `program_workouts.template_id` is `restrict`, which is
    // the point of that FK and which this teardown must respect like any other caller.
    const templateIds = await templateIdsOfSeededPrograms();
    await db.delete(programs).where(inArray(programs.slug, seededSlugs));
    if (templateIds.length > 0) {
      await db.delete(workoutTemplates).where(inArray(workoutTemplates.id, templateIds));
    }
    // Only what this suite put there: the curated additions the seed creates, plus any mapped
    // catalogue row that was missing before it started. A developer database's own 873 rows are
    // left untouched.
    const toRemove = [
      ...CURATED_EXERCISES.map((exercise) => exercise.slug),
      ...insertedExerciseSlugs,
    ];
    if (toRemove.length > 0) {
      await db.delete(exercises).where(inArray(exercises.slug, toRemove));
    }
    await pool.end();
  });

  describe("a first run", () => {
    let firstRunTemplateIds: string[];

    beforeAll(async () => {
      await seedPrograms(exercisesRepository, repository);
      firstRunTemplateIds = await templateIdsOfSeededPrograms();
    });

    it("seeds all nine programs with their design metadata", async () => {
      for (const program of SEED_PROGRAMS) {
        const row = await readProgram(program.slug);
        expect(row).toBeDefined();
        expect(row?.name).toBe(program.name);
        expect(row?.category).toBe(program.category);
        expect(row?.level).toBe(program.level);
        expect(row?.daysPerWeek).toBe(program.daysPerWeek);
        expect(row?.durationWeeks).toBe(program.durationWeeks);
        expect(row?.description).toBe(program.description);
        expect(row?.version).toBe(program.version);
        expect(row?.ownerUserId).toBeNull();
        expect(row?.deletedAt).toBeNull();
      }
    });

    it("adds the four curated exercises the ingested catalogue cannot supply", async () => {
      const rows = await db
        .select()
        .from(exercises)
        .where(
          inArray(
            exercises.slug,
            CURATED_EXERCISES.map((exercise) => exercise.slug),
          ),
        );

      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.ownerUserId).toBeNull();
        expect(row.source).toBe("forjd-curated");
      }
      expect(rows.find((row) => row.slug === "5k-run")?.measure).toBe("distance");
      // The correction this phase exists for: the fan bike, not free-exercise-db's bicycle crunch.
      expect(rows.find((row) => row.slug === "assault-bike")?.category).toBe("cross_training");
    });

    it("gives each program a catalogue template per workout, in the design's order", async () => {
      for (const program of SEED_PROGRAMS) {
        const row = await readProgram(program.slug);
        const workouts = await readWorkouts(row!.id);

        expect(workouts.map((entry) => entry.template.name)).toEqual(
          program.workouts.map((workout) => workout.name),
        );
        expect(workouts.map((entry) => entry.template.activity)).toEqual(
          program.workouts.map((workout) => workout.activity),
        );
        expect(workouts.map((entry) => entry.join.orderIndex)).toEqual(
          program.workouts.map((_workout, index) => index),
        );

        for (const entry of workouts) {
          // Null for a preset: it prescribes a set of workouts, not a calendar.
          expect(entry.join.dayOfWeek).toBeNull();
          // Catalogue rows, visible to every athlete through the existing `visibleTo` predicate.
          expect(entry.template.ownerUserId).toBeNull();
        }
      }
    });

    it("resolves each exercise to the canonical movement, never a near miss", async () => {
      const row = await readProgram("531-progression");
      const workouts = await readWorkouts(row!.id);
      const benchDay = workouts.find((entry) => entry.template.name === "Bench Day");

      const exerciseIds = await readExerciseIds(benchDay!.template.id);
      const rows = await db.select().from(exercises).where(inArray(exercises.id, exerciseIds));
      const slugById = new Map(rows.map((entry) => [entry.id, entry.slug]));

      // In the design's order, and each the canonical movement -- a barbell bench, not the
      // machine press a shortest-substring match resolves `Bench Press` to.
      expect(exerciseIds.map((id) => slugById.get(id))).toEqual([
        "barbell-bench-press-medium-grip",
        "incline-dumbbell-press",
        "triceps-pushdown",
      ]);
    });

    it("prescribes three sets and no rep target, exactly as the design does", async () => {
      const row = await readProgram("upper-lower");
      const workouts = await readWorkouts(row!.id);

      const rows = await db
        .select()
        .from(workoutExercises)
        .innerJoin(workoutBlocks, eq(workoutBlocks.id, workoutExercises.blockId))
        .where(eq(workoutBlocks.templateId, workouts[0]!.template.id));

      expect(rows.length).toBeGreaterThan(0);
      for (const entry of rows) {
        expect(entry.workout_exercises.setCount).toBe(3);
        expect(entry.workout_exercises.targetReps).toBeNull();
        expect(entry.workout_exercises.targetWeightKg).toBeNull();
        expect(entry.workout_blocks.type).toBe("straight_sets");
      }
    });

    describe("a second, unchanged run", () => {
      let secondRun: Awaited<ReturnType<typeof seedPrograms>>;

      beforeAll(async () => {
        secondRun = await seedPrograms(exercisesRepository, repository);
      });

      it("reports nothing created and every workout rewritten in place", () => {
        // Pinned as numbers, not only as observable end state: a regression that recreated a
        // template on a no-op re-run would still leave nine correct programs behind, and the id
        // check below would be the only thing to notice. This makes the deploy-time claim -- "a
        // second run creates nothing" -- a machine-checked one.
        const total = (key: "created" | "updated" | "pruned"): number =>
          secondRun.results.reduce((sum, result) => sum + result[key], 0);

        expect(total("created")).toBe(0);
        expect(total("pruned")).toBe(0);
        expect(total("updated")).toBe(
          SEED_PROGRAMS.reduce((sum, program) => sum + program.workouts.length, 0),
        );
      });

      it("creates nothing and keeps template ids stable", async () => {
        // Ids must survive, because `workout_sessions.template_id` references them: a seed that
        // recreated its templates would orphan every session performed against a preset.
        expect((await templateIdsOfSeededPrograms()).sort()).toEqual(
          [...firstRunTemplateIds].sort(),
        );
      });

      it("leaves exactly nine programs rather than duplicating them", async () => {
        const rows = await db.select().from(programs).where(inArray(programs.slug, seededSlugs));
        expect(rows).toHaveLength(9);
      });

      it("does not duplicate a program's exercises by re-appending them", async () => {
        const row = await readProgram("couch-to-5k");
        const workouts = await readWorkouts(row!.id);
        // "Walk-Run A" is one exercise in the design. Re-running must not make it two.
        expect(await readExerciseIds(workouts[0]!.template.id)).toHaveLength(1);
      });
    });

    /**
     * The failure a positional match would cause, and the reason `seedProgram` matches by name.
     * Reordering workouts in the seed file must move the rows, not repoint the templates: a
     * session already logged against "Push A" must not quietly become a session against "Pull A".
     */
    describe("when a program's workouts are reordered", () => {
      it("moves each existing template to its new position instead of rewriting it in place", async () => {
        const original = SEED_PROGRAMS.find((program) => program.slug === "push-pull-legs")!;
        const programRow = await readProgram(original.slug);
        const before = await readWorkouts(programRow!.id);
        const idByName = new Map(before.map((entry) => [entry.template.name, entry.template.id]));

        const swapped = [...original.workouts];
        [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];

        const result = await reseed({ ...original, workouts: swapped });
        expect(result.created).toBe(0);
        expect(result.pruned).toBe(0);

        const after = await readWorkouts(programRow!.id);
        expect(after.map((entry) => entry.template.name)).toEqual(
          swapped.map((workout) => workout.name),
        );
        // Same templates, new order -- every id preserved and still attached to its own name.
        for (const entry of after) {
          expect(entry.template.id).toBe(idByName.get(entry.template.name));
        }

        await reseed(original);
        expect((await readWorkouts(programRow!.id)).map((entry) => entry.template.name)).toEqual(
          original.workouts.map((workout) => workout.name),
        );
      });
    });

    /**
     * The prune path, which no deploy exercises today but which must be right the first time it
     * matters -- and which must respect the `restrict` FK rather than trying to delete a linked
     * template.
     */
    describe("when a program's content shrinks", () => {
      it("unlinks the extra workout and soft-deletes its template instead of removing it", async () => {
        const full = SEED_PROGRAMS.find((program) => program.slug === "upper-lower")!;
        const programRow = await readProgram(full.slug);
        const before = await readWorkouts(programRow!.id);
        const droppedTemplateId = before[before.length - 1]!.template.id;

        const result = await reseed({
          ...full,
          workouts: full.workouts.slice(0, full.workouts.length - 1),
        });
        expect(result.pruned).toBe(1);

        const after = await readWorkouts(programRow!.id);
        expect(after).toHaveLength(full.workouts.length - 1);
        expect(after.map((entry) => entry.template.id)).not.toContain(droppedTemplateId);

        const [dropped] = await db
          .select()
          .from(workoutTemplates)
          .where(eq(workoutTemplates.id, droppedTemplateId));
        expect(dropped).toBeDefined();
        expect(dropped?.deletedAt).not.toBeNull();

        // Restore, so this describe cannot leave the catalogue short for anything after it.
        await reseed(full);
        expect(await readWorkouts(programRow!.id)).toHaveLength(full.workouts.length);

        // The shrink orphaned that template; it is unlinked now, so a hard delete is legal.
        await db.delete(workoutTemplates).where(eq(workoutTemplates.id, droppedTemplateId));
      });
    });

    /**
     * What `program_version` actually buys. Editing a program bumps its version; an enrolment
     * already recorded keeps the version it began under. Serving that enrollee the *older
     * content* is out of scope for Phase K and recorded as a known gap -- this pins the half that
     * does work, so a later change cannot quietly break it.
     */
    describe("versioning", () => {
      it("bumps the program's version without rewriting what an existing enrolment recorded", async () => {
        const [user] = await db
          .insert(users)
          .values({
            email: `programseed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
          })
          .returning();

        try {
          const original = SEED_PROGRAMS.find((program) => program.slug === "couch-to-5k")!;
          const programRow = await readProgram(original.slug);

          await db.insert(programEnrollments).values({
            userId: user!.id,
            programId: programRow!.id,
            programVersion: programRow!.version,
          });

          await reseed({ ...original, version: original.version + 1 });
          expect((await readProgram(original.slug))?.version).toBe(original.version + 1);

          const [enrolment] = await db
            .select()
            .from(programEnrollments)
            .where(eq(programEnrollments.userId, user!.id));
          expect(enrolment?.programVersion).toBe(original.version);

          // Put the catalogue back to the version the seed file declares.
          await reseed(original);
        } finally {
          // Cascades the enrolment away with the user.
          await db.delete(users).where(eq(users.id, user!.id));
        }
      });
    });
  });

  describe("resolveExerciseIds", () => {
    it("throws naming every missing slug rather than seeding a program without a lift", async () => {
      const missing = ["barbell-squat", "not-a-real-slug", "also-missing"];

      await expect(repository.resolveExerciseIds(missing)).rejects.toThrow(UnresolvedExerciseError);
      await expect(repository.resolveExerciseIds(missing)).rejects.toThrow(
        /not-a-real-slug, also-missing/,
      );
    });

    it("resolves every slug the nine programs actually use", async () => {
      const resolved = await repository.resolveExerciseIds(allMappedSlugs);
      expect(resolved.size).toBe(new Set(allMappedSlugs).size);
    });
  });
});
