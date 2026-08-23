import { ConflictException } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, getTableColumns, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { privacySettings } from '../database/schema/privacy-settings.schema';
import { profiles } from '../database/schema/profiles.schema';
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

  it('defaults the new unit, list and city columns without a wire change', async () => {
    const email = uniqueEmail('defaults');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    await expect(repository.findProfile(user.id)).resolves.toMatchObject({
      weightUnit: 'kg',
      distanceUnit: 'km',
      energyUnit: 'kcal',
      trainingGoals: [],
      activities: [],
      city: null,
      citySlug: null,
    });
  });

  it('round-trips the training goal and activity arrays', async () => {
    const email = uniqueEmail('lists');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    const updated = await repository.updateProfile(user.id, {
      trainingGoals: ['get_stronger', 'lose_fat'],
      activities: ['strength', 'hyrox'],
    });

    expect(updated?.trainingGoals).toEqual(['get_stronger', 'lose_fat']);
    expect(updated?.activities).toEqual(['strength', 'hyrox']);
  });

  /**
   * The reason these are `text[]` and not a Postgres enum: narrowing an enum is impossible
   * (`ALTER TYPE` cannot remove a value), whereas narrowing the *known-value set* in code is
   * free — as the recent `sex` narrowing was. The cost of that freedom is that a value which
   * has since left the set is still sitting in the column, and if it reached the response
   * unfiltered the API's own output would fail the API's own schema. Filtering here degrades
   * that to "the chip is simply deselected", which is a display glitch rather than a 500.
   */
  it('drops array members that are no longer known values', async () => {
    const email = uniqueEmail('unknown-members');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    await db
      .update(profiles)
      .set({
        trainingGoals: ['get_stronger', 'retired_goal'],
        activities: ['running', 'retired_activity'],
      })
      .where(eq(profiles.userId, user.id));

    const profile = await repository.findProfile(user.id);

    expect(profile?.trainingGoals).toEqual(['get_stronger']);
    expect(profile?.activities).toEqual(['running']);
  });

  it('stores the three unit preferences independently of each other', async () => {
    const email = uniqueEmail('units');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    const updated = await repository.updateProfile(user.id, { weightUnit: 'lb' });

    expect(updated?.weightUnit).toBe('lb');
    // Nothing derives one unit from another — that was the point of three real preferences
    // rather than a single system flag (see the slice 2 plan's decisions table).
    expect(updated?.distanceUnit).toBe('km');
    expect(updated?.energyUnit).toBe('kcal');
  });

  it('stores city as a string', async () => {
    const email = uniqueEmail('city');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    const updated = await repository.updateProfile(user.id, {
      city: 'Cairo',
      citySlug: 'cairo',
    });

    expect(updated?.city).toBe('Cairo');
    expect(updated?.citySlug).toBe('cairo');
  });

  /**
   * docs/architecture/security.md places location on WorkoutSession, never on the user
   * record, so `profiles` must never grow a coordinate. This reads the real column names out
   * of the table definition and matches them by *pattern* rather than against a list of four
   * literal names — the failure worth catching is someone adding a coordinate under a name
   * nobody thought to enumerate, which is exactly what a literal list would wave through.
   */
  it('has no coordinate-shaped column on the profile table', () => {
    const columnNames = Object.keys(getTableColumns(profiles));

    expect(columnNames).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/lat|lon|lng|coord|geo|point/i)]),
    );
  });

  /**
   * Registration creates user, profile and privacy row together. If the privacy insert were
   * outside the transaction, a failure there would leave an account whose settings screen
   * 500s — which is exactly why findOrCreate is defensive as well.
   */
  it('creates the privacy settings row alongside the user and profile', async () => {
    const email = uniqueEmail('privacy-row');
    const user = await repository.upsertFromIdentity(crypto.randomUUID(), email);

    const [row] = await db
      .select()
      .from(privacySettings)
      .where(eq(privacySettings.userId, user.id));

    expect(row).toBeDefined();
    expect(row?.publicProfile).toBe(false);
    expect(row?.leaderboardOptIn).toBe(false);
    expect(row?.locationForLeaderboard).toBe(false);
    expect(row?.aiFeaturesConsent).toBe(false);
    expect(row?.crashDiagnostics).toBe(false);
  });

  it('leaves exactly one profile and one privacy row after a repeated login', async () => {
    const email = uniqueEmail('privacy-idempotent');
    const externalId = crypto.randomUUID();

    const user = await repository.upsertFromIdentity(externalId, email);
    await repository.upsertFromIdentity(externalId, email);

    await expect(
      db.select().from(profiles).where(eq(profiles.userId, user.id)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(privacySettings).where(eq(privacySettings.userId, user.id)),
    ).resolves.toHaveLength(1);
  });
});
