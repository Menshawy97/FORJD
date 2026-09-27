import {
  FORGE_LADDER_IS_PUBLIC,
  FORGE_LADDER_UNITS,
  FORGE_LADDERS,
  FORGE_TIERS,
  maxBandOf,
} from "@forjd/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ForgeSeedRepository, ForgeSeedRows, ForgeSeedSummary } from "../forge-seed.repository";

/**
 * `pnpm --filter @forjd/api forge:seed`
 *
 * Copies Weekly Forge's tier table from `@forjd/domain` (`FORGE_TIERS`, the single source) into
 * `forge_ladders` and `forge_tiers`. Runs in `deploy-api.yml` after `db:migrate`, alongside the other
 * reference-data loaders (ADR-057 decision 6).
 *
 * **A script, not a migration**, for the reason `programs:seed` gives: this is content, not schema.
 * A changed target is a data change on the next deploy, not a new migration file, and that is only
 * safe because it is idempotent -- see `ForgeSeedRepository`.
 */

/** The slice of the repository this function uses, named structurally so tests can pass a fake. */
export interface ForgeSeedTarget {
  replaceAll(rows: ForgeSeedRows): Promise<ForgeSeedSummary>;
}

export function forgeSeedRows(): ForgeSeedRows {
  return {
    ladders: FORGE_LADDERS.map((key, index) => ({
      key,
      unit: FORGE_LADDER_UNITS[key],
      maxBand: maxBandOf(key),
      isPublic: FORGE_LADDER_IS_PUBLIC[key],
      sortOrder: index,
    })),
    tiers: FORGE_LADDERS.flatMap((ladderKey) =>
      FORGE_TIERS[ladderKey].map((tier) => ({
        ladderKey,
        level: tier.level,
        band: tier.band,
        target: tier.target.toFixed(2),
      })),
    ),
  };
}

export async function seedForge(target: ForgeSeedTarget): Promise<ForgeSeedSummary> {
  return target.replaceAll(forgeSeedRows());
}

/** The CLI half: everything that touches a connection lives here. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString });
  try {
    const summary = await seedForge(new ForgeSeedRepository(drizzle(pool)));
    process.stdout.write(
      `seeded ${summary.ladders} Forge ladders and ${summary.tiers} tiers (${summary.pruned} pruned)\n`,
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
