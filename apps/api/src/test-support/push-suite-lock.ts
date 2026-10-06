import type { Pool } from 'pg';

/**
 * The push specs that claim and send rows work on the whole outbox table (a dispatcher claims every due row, whoever it
 * belongs to), so two of them running in parallel workers would claim each other's rows. This takes a Postgres advisory
 * lock for the length of a spec file and returns the function that gives it back, so those files run one after another.
 */
const PUSH_SUITE_LOCK_KEY = 7_706_001;

export async function acquirePushSuiteLock(pool: Pool): Promise<() => Promise<void>> {
  const client = await pool.connect();
  await client.query('select pg_advisory_lock($1)', [PUSH_SUITE_LOCK_KEY]);
  return async () => {
    try {
      await client.query('select pg_advisory_unlock($1)', [PUSH_SUITE_LOCK_KEY]);
    } finally {
      client.release();
    }
  };
}
