import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { waitlistSignups } from '../database/schema/waitlist.schema';
import { WaitlistRepository } from './waitlist.repository';

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is the unique
 * constraint on `email` and what happens when it is violated, which only a real database can
 * prove (same rationale as `body.repository.spec.ts`).
 */
describe('WaitlistRepository', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: WaitlistRepository;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string): string =>
    `waitlistrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new WaitlistRepository(db);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(waitlistSignups).where(inArray(waitlistSignups.email, createdEmails));
    }
    await pool.end();
  });

  it('stores a new address with the default source', async () => {
    const email = uniqueEmail('new');
    createdEmails.push(email);

    await repository.signUp(email);

    const [row] = await db.select().from(waitlistSignups).where(eq(waitlistSignups.email, email));
    expect(row?.email).toBe(email);
    expect(row?.source).toBe('website');
  });

  it('does nothing, and does not throw, for an address already on the list', async () => {
    const email = uniqueEmail('dup');
    createdEmails.push(email);

    await repository.signUp(email);
    await expect(repository.signUp(email)).resolves.toBeUndefined();

    const rows = await db.select().from(waitlistSignups).where(eq(waitlistSignups.email, email));
    expect(rows).toHaveLength(1);
  });
});
