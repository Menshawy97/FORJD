import { readFileSync } from "fs";
import { join } from "path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ExercisesRepository, UpsertCatalogueExerciseInput } from "../exercises.repository";
import { NormalizedExercise } from "./exercise-source-adapter.interface";

/**
 * `pnpm --filter @forjd/api exercises:load`
 *
 * Upserts the committed normalized catalogue into the database. Runs in `deploy-api.yml`
 * immediately after `db:migrate`.
 *
 * **A script, not a migration.** 873 content rows are not schema: they change when the
 * dataset is re-vendored or a mapping is corrected, on a cadence that has nothing to do with
 * the shape of the table. Putting them in a migration would mean a new migration file every
 * time an exercise name changed, and no way to correct one without a second migration undoing
 * the first. Being a script is only safe because it is idempotent, which is the property the
 * `(source, source_id)` partial unique index enforces in the database rather than here.
 *
 * **It reads the snapshot, never the raw dataset.** Normalization already happened in Phase D
 * and its result is committed and reviewable; a loader that re-derived the mapping would be a
 * second, untested implementation of the same decisions, free to disagree with the one the
 * golden fixtures cover. `scripts/ci/check-architecture-conformance.sh` enforces this rather
 * than trusting the comment.
 */

export const SNAPSHOT_PATH = join(__dirname, "data", "normalized-exercises.json");

/**
 * The slice of `ExercisesRepository` the loader uses, named structurally so the pure function
 * below can be tested against a fake without a database, and so this file states exactly what
 * it needs rather than depending on the whole class.
 */
export interface CatalogueTarget {
  upsertCatalogueExercise(input: UpsertCatalogueExerciseInput): Promise<unknown>;
}

interface SnapshotShape {
  count: number;
  exercises: NormalizedExercise[];
}

/**
 * Validates the snapshot's self-description before a single row is written.
 *
 * The file is produced by our own script and committed, so this is not defending against a
 * hostile input -- it is defending against a *truncated* one. A partial checkout or a
 * mis-resolved merge conflict still yields valid JSON, and without the count check the loader
 * would upsert whatever survived, exit zero, and leave a catalogue quietly missing rows that
 * nobody would notice until a user searched for one.
 */
export function parseSnapshot(raw: unknown): NormalizedExercise[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${SNAPSHOT_PATH}: expected a JSON object at the top level.`);
  }

  const { count, exercises } = raw as Partial<SnapshotShape>;

  if (!Array.isArray(exercises)) {
    throw new Error(`${SNAPSHOT_PATH}: "exercises" is not an array.`);
  }

  if (count !== exercises.length) {
    throw new Error(
      `${SNAPSHOT_PATH}: declares count ${String(count)} but carries ${exercises.length} ` +
        `exercises. The snapshot is truncated or was hand-edited -- regenerate it with ` +
        `\`pnpm --filter @forjd/api exercises:normalize\`.`,
    );
  }

  exercises.forEach((exercise, index) => {
    // Only the upsert key is checked. Everything else is the adapter's business and is
    // already covered by its golden fixtures; but a record missing either half of
    // `(source, source_id)` would not merely be wrong, it would defeat the partial unique
    // index (NULLs never conflict) and insert a fresh duplicate row on every deploy.
    if (!exercise.source) {
      throw new Error(`${SNAPSHOT_PATH}: exercise at index ${index} has no source.`);
    }
    if (!exercise.sourceId) {
      throw new Error(`${SNAPSHOT_PATH}: exercise at index ${index} has no sourceId.`);
    }
  });

  return exercises;
}

/**
 * Upserts every record, one at a time, and rejects on the first failure.
 *
 * Sequential rather than parallel on purpose: 873 upserts take a few seconds, this runs once
 * per deploy, and a burst of concurrent writes against the same partial unique index buys
 * nothing but lock contention and a harder failure to read. There is no transaction either --
 * each upsert is independently idempotent, so a run that dies halfway leaves a partially
 * updated catalogue that the next run completes, rather than an all-or-nothing rollback that
 * makes the same deploy fail the same way forever.
 */
export async function loadCatalogue(
  target: CatalogueTarget,
  exercises: NormalizedExercise[],
): Promise<{ loaded: number }> {
  let loaded = 0;

  for (const exercise of exercises) {
    await target.upsertCatalogueExercise(exercise);
    loaded += 1;
  }

  return { loaded };
}

/** The CLI half: everything that touches the filesystem or a connection lives here. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const exercises = parseSnapshot(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown);

  const pool = new Pool({ connectionString });
  try {
    const repository = new ExercisesRepository(drizzle(pool));
    const { loaded } = await loadCatalogue(repository, exercises);
    process.stdout.write(`loaded ${loaded} catalogue exercises\n`);
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
