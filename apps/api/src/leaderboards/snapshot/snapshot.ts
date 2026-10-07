import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadCitySnapshotFromDisk } from "../../cities/city-snapshot";
import { CityResolverService } from "../../cities/city-resolver.service";
import { Database } from "../../database/database.module";
import type { NotificationProvider } from "../../integrations/push/notification-provider";
import { createPushNotificationService } from "../../notifications/push-service-factory";
import { RankPushSender } from "../../notifications/rank-push-sender";
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
  let head = `captured ${summary.cities} cities (${summary.rows} rows)`;
  if (summary.moves > 0 || summary.moveFailures > 0) head += `, ${summary.moves} rank pushes queued`;
  if (summary.moveFailures > 0) head += `, ${summary.moveFailures} could not be queued`;
  if (summary.failures.length === 0) return `${head}\n`;
  const failed = summary.failures.map((f) => `  ${f.citySlug}: ${f.message}`).join("\n");
  return `${head}, ${summary.failures.length} failed:\n${failed}\n`;
}

/**
 * The whole error chain for the run log. Drizzle's "Failed query" error keeps the Postgres
 * error on `cause`, and `error.stack` never prints it, so without this a failed run shows the
 * SQL text but not why it failed. From each cause only `message`, Postgres `code` and `detail`
 * are read, never anything else the driver attaches. The outer drizzle message itself still
 * carries the query's params, as it always did. `detail` is driver text and can echo a key's
 * value (here only user ids and city slugs), so keep that in mind before reusing this elsewhere.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const lines = [error.stack ?? error.message];
  const seen = new Set<unknown>([error]);
  let cause = error.cause;
  while (cause !== undefined && !seen.has(cause)) {
    seen.add(cause);
    lines.push(`caused by: ${describeCause(cause)}`);
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join("\n");
}

function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const { code, detail } = cause as { code?: unknown; detail?: unknown };
  const parts = [cause.message];
  if (typeof code === "string") parts.push(`(code ${code})`);
  if (typeof detail === "string") parts.push(detail);
  return parts.join(" ");
}

/** The snapshot only queues pushes (`enqueue`), so it has no push service to talk to and must not be able to send one. */
const neverSends: NotificationProvider = {
  send: () => Promise.reject(new Error("The snapshot does not send pushes.")),
  receipts: () => Promise.reject(new Error("The snapshot does not read receipts.")),
};

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
      // Rank moves are only queued here; the drain workflow sends them, so this provider is never used.
      new RankPushSender(createPushNotificationService(db, neverSends)),
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
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = 1;
  });
}
