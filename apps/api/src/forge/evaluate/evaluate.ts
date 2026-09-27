import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../../database/database.module";
import { FeatureFlagsRepository, WEEKLY_FORGE_FLAG } from "../../feature-flags/feature-flags.repository";
import { describeError } from "../../leaderboards/snapshot/snapshot";
import { ForgeEvaluationService } from "../forge-evaluation.service";
import { ForgeStateRepository } from "../forge-state.repository";
import { ForgeTotalsRepository } from "../forge-totals.repository";

/**
 * `pnpm --filter @forjd/api forge:evaluate`
 *
 * Evaluates every enrolled athlete's closed Weekly Forge weeks (ADR-057 decision 4). Run hourly on
 * Friday and Saturday UTC by `.github/workflows/forge-evaluate.yml`, which covers Saturday 00:00 in
 * every zone, and safe to run any number of times: `ForgeEvaluationService.evaluateDue` only ever
 * evaluates the week after each ladder's last one. `GET /forge` evaluates the caller on read too,
 * so a missed run delays nobody.
 *
 * **A script and not `@nestjs/schedule`**, for ADR-047's reason: Cloud Run scales to zero.
 */

/** The slices this function uses, named structurally so the spec can pass fakes. */
export interface ForgeJobDeps {
  flags: { isEnabled(key: string): Promise<boolean> };
  users: { enrolledUserIds(): Promise<string[]> };
  service: { evaluateDue(userId: string, now: Date): Promise<number> };
}

export interface ForgeJobSummary {
  /** True while `weekly_forge` is off: the job evaluates nothing, so the feature stays dark. */
  skipped: boolean;
  users: number;
  weeks: number;
  failures: Array<{ userId: string; message: string }>;
}

export async function runForgeEvaluation(deps: ForgeJobDeps, now: Date): Promise<ForgeJobSummary> {
  if (!(await deps.flags.isEnabled(WEEKLY_FORGE_FLAG))) {
    return { skipped: true, users: 0, weeks: 0, failures: [] };
  }

  const userIds = await deps.users.enrolledUserIds();
  let weeks = 0;
  const failures: ForgeJobSummary["failures"] = [];
  // One athlete at a time: each holds a row lock for the length of a week's write, and the job has
  // all hour. A failure is recorded and the rest carry on.
  for (const userId of userIds) {
    try {
      weeks += await deps.service.evaluateDue(userId, now);
    } catch (error) {
      failures.push({ userId, message: describeError(error) });
    }
  }
  return { skipped: false, users: userIds.length, weeks, failures };
}

export function formatForgeSummary(summary: ForgeJobSummary): string {
  if (summary.skipped) return `${WEEKLY_FORGE_FLAG} is off: nothing evaluated\n`;
  const head = `evaluated ${summary.weeks} weeks for ${summary.users} athletes`;
  if (summary.failures.length === 0) return `${head}\n`;
  const failed = summary.failures.map((f) => `  ${f.userId}: ${f.message}`).join("\n");
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
    const state = new ForgeStateRepository(db);
    const summary = await runForgeEvaluation(
      {
        flags: new FeatureFlagsRepository(db),
        users: state,
        service: new ForgeEvaluationService(state, new ForgeTotalsRepository(db)),
      },
      new Date(),
    );

    process.stdout.write(formatForgeSummary(summary));
    // Healthy athletes are already written; a failed one turns the workflow run red.
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
