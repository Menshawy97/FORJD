import type { PoolConfig } from 'pg';

/**
 * Connection limits for the API's `pg` pool (docs/product/checklist-cleanup-oct-plan.md, F3).
 *
 * `DATABASE_URL` is Supabase's session pooler (production-setup.md step 2). In session mode every
 * open client connection holds one database connection, so the API's share of the database is
 * this pool size times the number of Cloud Run instances. `deploy-api.yml` caps the instances, and
 * `pool-options.spec.ts` checks the product stays inside {@link API_DATABASE_CONNECTION_BUDGET}.
 */

/** Per instance. pg's default is 10, which across several instances could fill the pooler. */
export const POOL_MAX_CONNECTIONS = 5;

/** A connection unused this long is closed, so an idle instance gives its share back. */
export const POOL_IDLE_TIMEOUT_MS = 10_000;

/**
 * How long a request waits for a connection before failing. pg's default is no limit, so a full
 * pooler would leave requests hanging until Cloud Run's own timeout instead of failing clearly.
 */
export const POOL_CONNECT_TIMEOUT_MS = 10_000;

/**
 * The most connections all API instances together may hold. The free plan's database allows 60
 * (Supabase compute-and-disk docs, Nano); Supabase's own services (Auth, Storage, the REST API, the
 * health checker) and the scheduled jobs (leaderboard snapshot, Weekly Forge, push drain) use the
 * same total, so the API keeps to a quarter of it.
 */
export const API_DATABASE_CONNECTION_BUDGET = 15;

export function poolOptions(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
  };
}
