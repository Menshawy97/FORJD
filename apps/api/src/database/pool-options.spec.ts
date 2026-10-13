import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  API_DATABASE_CONNECTION_BUDGET,
  POOL_CONNECT_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  POOL_MAX_CONNECTIONS,
  poolOptions,
} from './pool-options';

// docs/product/checklist-cleanup-oct-plan.md, F3. DATABASE_URL is Supabase's session pooler, where
// every open client connection holds a database connection, so the API's share is its pool size
// times the number of Cloud Run instances. Both halves are pinned here so neither can grow alone.
describe('poolOptions', () => {
  it('keeps the connection string and sets every limit explicitly', () => {
    expect(poolOptions('postgres://example')).toEqual({
      connectionString: 'postgres://example',
      max: POOL_MAX_CONNECTIONS,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
    });
  });

  it('gives up on a connection after a bounded wait instead of the pg default of forever', () => {
    expect(POOL_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(POOL_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it('closes idle connections so a quiet instance does not hold the pooler', () => {
    expect(POOL_IDLE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(POOL_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('caps Cloud Run instances so pool size times instances stays inside the budget', () => {
    const workflow = readFileSync(join(__dirname, '../../../../.github/workflows/deploy-api.yml'), 'utf8');
    // The flag itself, at the start of a line: the comment above it also mentions it.
    const match = /^\s*--max-instances[ =](\d+)/m.exec(workflow);
    expect(match).not.toBeNull();
    const maxInstances = Number(match?.[1]);
    expect(maxInstances).toBeGreaterThanOrEqual(1);
    expect(POOL_MAX_CONNECTIONS * maxInstances).toBeLessThanOrEqual(API_DATABASE_CONNECTION_BUDGET);
  });
});
