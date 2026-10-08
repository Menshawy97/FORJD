import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Database } from '../database/database.module';
import { createExpoPushProvider } from '../integrations/push/expo-push-provider';
import { describeFailure } from './failure-description';
import { createPushNotificationService } from './push-service-factory';
import type { PushNotificationService } from './push-notification.service';

/**
 * `pnpm --filter @forjd/api push:drain`
 *
 * Sends the pushes that are due, reads the receipts of earlier ones (removing phones the push service says are gone) and
 * tidies old rows (Phase 12F, ADR-065). Run every 15 minutes by `.github/workflows/push-drain.yml`, and safe to run at any
 * time or twice at once: a dispatcher claims each row with `FOR UPDATE SKIP LOCKED`, so no push goes out twice because two
 * drains overlapped. **A script and not `@nestjs/schedule`**: Cloud Run scales to zero, so an in-process timer would never fire.
 */
export function formatDrainSummary(summary: Awaited<ReturnType<PushNotificationService['drain']>>): string {
  const { dispatched: d, receipts: r } = summary;
  return (
    `push drain: ${d.claimed} claimed (${d.sent} sent, ${d.dropped} dropped, ${d.held} held, ${d.retried} retried, ${d.failed} failed), ` +
    `${r.checked} receipts checked (${r.removedTokens} dead phones removed, ${r.expired} expired), ${summary.purged} old rows purged` +
    (summary.failedSteps.length > 0 ? `, FAILED: ${summary.failedSteps.join(', ')}` : '') +
    '\n'
  );
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool) as unknown as Database;
    const provider = createExpoPushProvider({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
    const summary = await createPushNotificationService(db, provider).drain(new Date());
    process.stdout.write(formatDrainSummary(summary));
    // A step that failed turns the run red (the other steps still ran), so a broken sender cannot look healthy.
    if (summary.failedSteps.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Importing this file (the spec does) must never open a connection or send anything.
if (require.main === module) {
  main().catch((error: unknown) => {
    // Only the error's name and codes: a database error's message can carry a connection string or a push token.
    process.stderr.write(`push drain failed: ${describeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
