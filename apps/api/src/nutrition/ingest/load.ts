import { readFileSync } from "fs";
import { join } from "path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { CreateCatalogueFoodInput, NutritionRepository } from "../nutrition.repository";
import { NormalizedFood } from "./usda-food-source-adapter.interface";

/**
 * `pnpm --filter @forjd/api nutrition:load`
 *
 * Upserts the committed normalized food catalogue into the database, mirroring
 * `exercises/ingest/load.ts` exactly: a script, not a migration, because ~13,700 content rows
 * change on a re-vendor/re-mapping cadence that has nothing to do with the table's shape.
 * Idempotent via the `(source, sourceId)` partial unique index `createCatalogueFood` already
 * upserts against.
 *
 * Reads only the committed snapshot, never the raw vendored CSVs -- normalization already
 * happened in Phase D and its result is reviewable in a diff; a loader that re-derived the
 * mapping would be a second, untested implementation of the same decisions.
 */

export const SNAPSHOT_PATH = join(__dirname, "data", "normalized-foods.json");

/** The slice of `NutritionRepository` the loader uses, named structurally for testing against a fake without a database. */
export interface FoodCatalogueTarget {
  bulkUpsertCatalogueFoods(inputs: CreateCatalogueFoodInput[]): Promise<void>;
}

interface SnapshotShape {
  count: number;
  foods: NormalizedFood[];
}

/**
 * Validates the snapshot's self-description before a single row is written -- the same
 * truncated-file defence `exercises/ingest/load.ts`'s `parseSnapshot` applies, for the same
 * reason: a partial checkout or a mis-resolved merge still parses as valid JSON.
 */
export function parseSnapshot(raw: unknown): NormalizedFood[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${SNAPSHOT_PATH}: expected a JSON object at the top level.`);
  }

  const { count, foods } = raw as Partial<SnapshotShape>;

  if (!Array.isArray(foods)) {
    throw new Error(`${SNAPSHOT_PATH}: "foods" is not an array.`);
  }

  if (count !== foods.length) {
    throw new Error(
      `${SNAPSHOT_PATH}: declares count ${String(count)} but carries ${foods.length} foods. ` +
        `The snapshot is truncated or was hand-edited -- regenerate it with ` +
        `\`pnpm --filter @forjd/api nutrition:normalize\`.`,
    );
  }

  foods.forEach((food, index) => {
    if (!food.source) {
      throw new Error(`${SNAPSHOT_PATH}: food at index ${index} has no source.`);
    }
    if (!food.sourceId) {
      throw new Error(`${SNAPSHOT_PATH}: food at index ${index} has no sourceId.`);
    }
  });

  return foods;
}

/**
 * Bulk-upserts the whole catalogue in one call, delegating the chunking (and its idempotency)
 * to `NutritionRepository.bulkUpsertCatalogueFoods` -- see that method's own docblock for why
 * this replaced a one-row-at-a-time loop (measured at ~1h40m in CI against a hosted Postgres,
 * versus ~90 round trips for the chunked version).
 */
export async function loadCatalogue(
  target: FoodCatalogueTarget,
  foods: NormalizedFood[],
): Promise<{ loaded: number }> {
  await target.bulkUpsertCatalogueFoods(foods);
  return { loaded: foods.length };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const foods = parseSnapshot(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown);

  const pool = new Pool({ connectionString });
  try {
    const repository = new NutritionRepository(drizzle(pool));
    const { loaded } = await loadCatalogue(repository, foods);
    process.stdout.write(`loaded ${loaded} catalogue foods\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
