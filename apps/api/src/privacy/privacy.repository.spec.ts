import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { privacySettings } from '../database/schema/privacy-settings.schema';
import { users } from '../database/schema/users.schema';
import { UsersRepository } from '../users/users.repository';
import { PrivacyRepository } from './privacy.repository';

/**
 * Exercised against real Postgres for the same reason UsersRepository is: the behaviour
 * under test is defaults, NOT NULL and ON CONFLICT resolution, all of which live in the
 * database. A mocked client would only assert what this file's author believes Postgres does.
 */
describe('PrivacyRepository', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: PrivacyRepository;
  let usersRepository: UsersRepository;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string): string => {
    const email = `privacy-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    return email;
  };

  const newUser = (label: string): Promise<{ id: string }> =>
    usersRepository.upsertFromIdentity(crypto.randomUUID(), uniqueEmail(label));

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new PrivacyRepository(db);
    usersRepository = new UsersRepository(db);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await pool.end();
  });

  /**
   * Every flag is opt-in. This is the decision the whole privacy model rests on, so it is
   * asserted field by field rather than with a snapshot — a snapshot would happily record a
   * future accidental `true` as the new expected value.
   */
  it('creates a row with every consent flag off', async () => {
    const user = await newUser('defaults');

    const settings = await repository.findOrCreate(user.id);

    expect(settings).toEqual({
      userId: user.id,
      publicProfile: false,
      leaderboardOptIn: false,
      locationForLeaderboard: false,
      aiFeaturesConsent: false,
      aiFeaturesConsentAt: null,
      crashDiagnostics: false,
    });
  });

  /**
   * The defensive half of findOrCreate. A user whose row is missing — created before this
   * table existed, or lost to a partial failure — must read as all-off rather than 500 the
   * settings screen.
   */
  it('recreates a missing row instead of returning null', async () => {
    const user = await newUser('missing');
    await db.delete(privacySettings).where(eq(privacySettings.userId, user.id));

    const settings = await repository.findOrCreate(user.id);

    expect(settings.userId).toBe(user.id);
    expect(settings.publicProfile).toBe(false);
    await expect(
      db.select().from(privacySettings).where(eq(privacySettings.userId, user.id)),
    ).resolves.toHaveLength(1);
  });

  it('returns the stored row rather than resetting it when one already exists', async () => {
    const user = await newUser('existing');
    await repository.findOrCreate(user.id);
    await repository.update(user.id, { publicProfile: true, leaderboardOptIn: true });

    const settings = await repository.findOrCreate(user.id);

    expect(settings.publicProfile).toBe(true);
    expect(settings.leaderboardOptIn).toBe(true);
  });

  /**
   * A concurrent double-read of the settings screen must not fail on the unique primary key.
   */
  it('is safe under a concurrent first read', async () => {
    const user = await newUser('concurrent');
    await db.delete(privacySettings).where(eq(privacySettings.userId, user.id));

    const [first, second] = await Promise.all([
      repository.findOrCreate(user.id),
      repository.findOrCreate(user.id),
    ]);

    expect(first.userId).toBe(user.id);
    expect(second.userId).toBe(user.id);
    await expect(
      db.select().from(privacySettings).where(eq(privacySettings.userId, user.id)),
    ).resolves.toHaveLength(1);
  });

  it('applies a partial update without disturbing the untouched flags', async () => {
    const user = await newUser('partial');
    await repository.update(user.id, { leaderboardOptIn: true, crashDiagnostics: true });

    const settings = await repository.update(user.id, { crashDiagnostics: false });

    expect(settings?.leaderboardOptIn).toBe(true);
    expect(settings?.crashDiagnostics).toBe(false);
    expect(settings?.publicProfile).toBe(false);
  });

  /**
   * The consent timestamp is a plain nullable column at this layer. Stamping and clearing it
   * on real transitions is PrivacyService's job (phase C) — the repository must not decide it,
   * or the same rule would exist in two places.
   */
  it('stores the consent timestamp it is given, including null', async () => {
    const user = await newUser('consent-at');
    const consentedAt = new Date('2026-01-02T03:04:05.000Z');

    const granted = await repository.update(user.id, {
      aiFeaturesConsent: true,
      aiFeaturesConsentAt: consentedAt,
    });
    expect(granted?.aiFeaturesConsent).toBe(true);
    expect(granted?.aiFeaturesConsentAt).toEqual(consentedAt);

    const revoked = await repository.update(user.id, {
      aiFeaturesConsent: false,
      aiFeaturesConsentAt: null,
    });
    expect(revoked?.aiFeaturesConsentAt).toBeNull();
  });

  it('returns null when updating a user that has no row', async () => {
    await expect(
      repository.update(crypto.randomUUID(), { publicProfile: true }),
    ).resolves.toBeNull();
  });

  /**
   * The row must not outlive the user. Cascade is declared on the foreign key, so this asserts
   * the migration actually carried `ON DELETE CASCADE` rather than trusting the schema file.
   */
  it('is deleted with the user it belongs to', async () => {
    const email = uniqueEmail('cascade');
    const user = await usersRepository.upsertFromIdentity(crypto.randomUUID(), email);
    await repository.findOrCreate(user.id);

    await db.delete(users).where(eq(users.id, user.id));

    await expect(
      db.select().from(privacySettings).where(eq(privacySettings.userId, user.id)),
    ).resolves.toHaveLength(0);
  });
});
