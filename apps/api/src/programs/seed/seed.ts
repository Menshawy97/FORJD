import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ExercisesRepository } from "../../exercises/exercises.repository";
import { ProgramsSeedRepository, SeedProgramResult } from "../programs.seed-repository";
import { CURATED_EXERCISES } from "./curated-exercises";
import { EXERCISE_SLUG_BY_NAME, SEED_PROGRAMS, SeedProgram } from "./program-catalogue";

/**
 * `pnpm --filter @forjd/api programs:seed`
 *
 * Upserts the four curated exercises and then the nine preset programs. Runs in
 * `deploy-api.yml` immediately after `exercises:load`, and depends on it: 24 of the 28 exercise
 * names the programs use resolve to ingested catalogue rows, so seeding before the catalogue
 * exists fails loudly with the missing slugs rather than seeding a hollow program.
 *
 * **A script, not a migration**, for the same reason `exercises:load` is one: this is content,
 * not schema. It changes when the design's programs change or a mapping is corrected, on a
 * cadence unrelated to the shape of the tables, and putting it in a migration would mean a new
 * migration file every time a workout was renamed, with no way to correct one except a second
 * migration undoing the first. That is only safe because it is idempotent -- see
 * `ProgramsSeedRepository`.
 */

/** The slice of each repository this function uses, named structurally so tests can pass fakes. */
export interface CuratedExerciseTarget {
  upsertCatalogueExercise(input: (typeof CURATED_EXERCISES)[number]): Promise<unknown>;
}

export interface ProgramSeedTarget {
  resolveExerciseIds(slugs: readonly string[]): Promise<Map<string, string>>;
  seedProgram(
    program: SeedProgram,
    exerciseIdBySlug: ReadonlyMap<string, string>,
    slugForName: Readonly<Record<string, string>>,
  ): Promise<SeedProgramResult>;
}

export interface SeedSummary {
  curatedExercises: number;
  results: SeedProgramResult[];
}

/**
 * Curated exercises first, then one resolve for every slug the nine programs reference, then the
 * programs themselves.
 *
 * **The resolve happens once, before any program is written.** Resolving per program would let
 * the first four seed successfully and the fifth fail on a missing slug, leaving the catalogue
 * half-populated and the error pointing at whichever program happened to be unlucky in the
 * ordering rather than at the missing exercise.
 */
export async function seedPrograms(
  exerciseTarget: CuratedExerciseTarget,
  programTarget: ProgramSeedTarget,
  programs: readonly SeedProgram[] = SEED_PROGRAMS,
  slugForName: Readonly<Record<string, string>> = EXERCISE_SLUG_BY_NAME,
): Promise<SeedSummary> {
  for (const exercise of CURATED_EXERCISES) {
    await exerciseTarget.upsertCatalogueExercise(exercise);
  }

  const slugsUsed = programs.flatMap((program) =>
    program.workouts.flatMap((workout) =>
      workout.exercises.map((name) => {
        const slug = slugForName[name];
        if (slug === undefined) {
          throw new Error(
            `Cannot seed programs: "${name}" (in ${program.slug}) has no entry in ` +
              `EXERCISE_SLUG_BY_NAME. Add a mapping -- there is deliberately no fuzzy fallback.`,
          );
        }
        return slug;
      }),
    ),
  );

  const exerciseIdBySlug = await programTarget.resolveExerciseIds(slugsUsed);

  const results: SeedProgramResult[] = [];
  for (const program of programs) {
    results.push(await programTarget.seedProgram(program, exerciseIdBySlug, slugForName));
  }

  return { curatedExercises: CURATED_EXERCISES.length, results };
}

/** The CLI half: everything that touches a connection lives here. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool);
    const summary = await seedPrograms(new ExercisesRepository(db), new ProgramsSeedRepository(db));

    const total = (key: "created" | "updated" | "pruned"): number =>
      summary.results.reduce((sum, result) => sum + result[key], 0);

    process.stdout.write(
      `seeded ${summary.results.length} programs ` +
        `(${total("created")} workouts created, ${total("updated")} rewritten, ` +
        `${total("pruned")} pruned) and ${summary.curatedExercises} curated exercises\n`,
    );
  } finally {
    await pool.end();
  }
}

// Importing this file (the spec does) must never open a connection or write to the database.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
