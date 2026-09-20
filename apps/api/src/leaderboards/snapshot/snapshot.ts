import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadCitySnapshotFromDisk } from "../../cities/city-snapshot";
import { CityResolverService } from "../../cities/city-resolver.service";
import { Database } from "../../database/database.module";
import { LeaderboardSnapshotRepository } from "../leaderboard-snapshot.repository";
import { LeaderboardSnapshotService, SnapshotSummary } from "../leaderboard-snapshot.service";
import { LeaderboardsRepository } from "../leaderboards.repository";

/**
 * `pnpm --filter @forjd/api leaderboard:snapshot`
 *
 * Records where everyone stands at the start of the week, so the leaderboard can show movement
 * (Phase 10J, ADR-047). Run weekly by `.github/workflows/leaderboard-snapshot.yml`, and safe to
 * run again: a week's rows are replaced, never added to.
 *
 * **A script and not `@nestjs/schedule`**: Cloud Run scales to zero, so an in-process timer would
 * never fire, and with several instances it would fire once per instance.
 */

/** One line for the run log, and one per failed city. */
export function formatSummary(summary: SnapshotSummary): string {
  const head = `captured ${summary.cities} cities (${summary.rows} rows)`;
  if (summary.failures.length === 0) return `${head}\n`;
  const failed = summary.failures.map((f) => `  ${f.citySlug}: ${f.message}`).join("\n");
  return `${head}, ${summary.failures.length} failed:\n${failed}\n`;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool) as unknown as Database;
    const service = new LeaderboardSnapshotService(
      new LeaderboardsRepository(db),
      new LeaderboardSnapshotRepository(db),
      new CityResolverService(loadCitySnapshotFromDisk),
    );
    const summary = await service.captureAll(new Date());

    process.stdout.write(formatSummary(summary));
    // Healthy cities are already written; a failed one turns the workflow run red.
    if (summary.failures.length > 0) process.exitCode = 1;
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
