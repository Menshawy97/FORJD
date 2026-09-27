import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ForgeRefoldRepository, ForgeRefoldSummary } from "../forge-refold.repository";

/**
 * `pnpm --filter @forjd/api forge:refold`
 *
 * Recomputes every athlete whose stored Weekly Forge weeks were judged under an older rules version
 * (ADR-058 decision 4). Runs in `deploy-api.yml` straight after `forge:seed`, which must go first so
 * `forge_tiers` already matches the table the refold uses.
 *
 * Safe on every deploy: with nothing stale it reads one query and writes nothing, and each athlete
 * is refolded in a transaction of its own, so a failure leaves that athlete as it was and the next
 * deploy picks them up again.
 */

/** The slice of the repository this function uses, named structurally so tests can pass a fake. */
export interface ForgeRefoldTarget {
  staleUserIds(): Promise<string[]>;
  refoldUser(userId: string): Promise<ForgeRefoldSummary>;
}

export async function refoldForge(target: ForgeRefoldTarget): Promise<{ athletes: number; weeks: number }> {
  const userIds = await target.staleUserIds();
  let weeks = 0;
  // One at a time: each holds the athlete's row lock, and a deploy is no place for a burst of them.
  for (const userId of userIds) {
    weeks += (await target.refoldUser(userId)).weeks;
  }
  return { athletes: userIds.length, weeks };
}

/** The CLI half: everything that touches a connection lives here. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString });
  try {
    const summary = await refoldForge(new ForgeRefoldRepository(drizzle(pool)));
    process.stdout.write(`refolded ${summary.weeks} Forge weeks for ${summary.athletes} athletes\n`);
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
