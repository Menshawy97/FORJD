import { ConflictException } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { users } from '../database/schema/users.schema';
import { UsersRepository } from './users.repository';

/**
 * Exercised against real Postgres rather than a mock. The behaviour under test is ON
 * CONFLICT resolution, which lives in the database — a mocked client would only prove the
 * test author's assumptions about what Postgres does.
 */
describe('UsersRepository', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: UsersRepository;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string): string => {
    const email = `repo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new UsersRepository(db);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await pool.end();
  });

  it('creates the user and an empty profile on first sight of an identity', async () => {
    const email = uniqueEmail('create');
    const externalId = crypto.randomUUID();

    const user = await repository.upsertFromIdentity(externalId, email);

    expect(user.email).toBe(email);
    // The internal id is application-owned and must not be the provider's id (ADR-008).
    expect(user.id).not.toBe(externalId);
    await expect(repository.findProfile(user.id)).resolves.toMatchObject({
      userId: user.id,
      unitSystem: 'metric',
    });
  });

  it('is idempotent for a repeated login by the same identity', async () => {
    const email = uniqueEmail('idempotent');
    const externalId = crypto.randomUUID();

    const first = await repository.upsertFromIdentity(externalId, email);
    const second = await repository.upsertFromIdentity(externalId, email);

    expect(second.id).toBe(first.id);
    await expect(db.select().from(users).where(eq(users.email, email))).resolves.toHaveLength(1);
  });

  /**
   * The regression this file exists for. Keying the upsert on email let a different auth
   * identity presenting a known address silently inherit the existing row — and every
   * profile, goal and preference cascading from its id.
   */
  it('refuses to hand an existing account to a different identity using the same email', async () => {
    const email = uniqueEmail('takeover');
    const originalExternalId = crypto.randomUUID();
    const original = await repository.upsertFromIdentity(originalExternalId, email);

    await expect(repository.upsertFromIdentity(crypto.randomUUID(), email)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const [row] = await db.select().from(users).where(eq(users.id, original.id));
    expect(row?.supabaseUserId).toBe(originalExternalId);
    expect(row?.email).toBe(email);
  });

  it('finds a user by external id and returns null for an unknown one', async () => {
    const email = uniqueEmail('lookup');
    const externalId = crypto.randomUUID();
    const created = await repository.upsertFromIdentity(externalId, email);

    await expect(repository.findByExternalId(externalId)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(repository.findByExternalId(crypto.randomUUID())).resolves.toBeNull();
  });

  it('round-trips heightCm through the numeric column as a number', async () => {
    const email = uniqueEmail('height');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    const updated = await repository.updateProfile(user.id, { heightCm: 180.5 });

    expect(updated?.heightCm).toBe(180.5);
  });

  it('distinguishes clearing a field from leaving it untouched', async () => {
    const email = uniqueEmail('patch');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    await repository.updateProfile(user.id, { displayName: 'Original', heightCm: 175 });
    const afterPartial = await repository.updateProfile(user.id, { displayName: 'Renamed' });

    expect(afterPartial?.displayName).toBe('Renamed');
    expect(afterPartial?.heightCm).toBe(175);

    const afterClear = await repository.updateProfile(user.id, { heightCm: null });
    expect(afterClear?.heightCm).toBeNull();
    expect(afterClear?.displayName).toBe('Renamed');
  });
});
