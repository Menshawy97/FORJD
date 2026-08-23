import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { auditLogs } from '../database/schema/audit-logs.schema';
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

  describe('updateLocked', () => {
    it('runs the decision against the stored row and writes the patch', async () => {
      const user = await newUser('locked');
      await repository.findOrCreate(user.id);

      const updated = await repository.updateLocked(user.id, (current) => {
        expect(current.publicProfile).toBe(false);
        return { patch: { publicProfile: true }, audit: null };
      });

      expect(updated?.publicProfile).toBe(true);
    });

    it('returns null when there is no row to lock', async () => {
      const user = await newUser('locked-missing');
      await db.delete(privacySettings).where(eq(privacySettings.userId, user.id));

      await expect(
        repository.updateLocked(user.id, () => ({ patch: { publicProfile: true }, audit: null })),
      ).resolves.toBeNull();
    });

    it('writes the audit row in the same transaction as the change', async () => {
      const user = await newUser('locked-audit');
      await repository.findOrCreate(user.id);

      await repository.updateLocked(user.id, () => ({
        patch: { aiFeaturesConsent: true },
        audit: { action: 'privacy.ai_consent_granted', metadata: { at: 'now' } },
      }));

      const logs = await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id));
      expect(logs.map((log) => log.action)).toContain('privacy.ai_consent_granted');
    });

    /**
     * A throw from the decision must undo the whole thing, audit row included. This is what
     * makes rejecting an invalid consent change safe to do from inside the callback.
     */
    it('rolls back the change and the audit row when the decision throws', async () => {
      const user = await newUser('locked-rollback');
      await repository.findOrCreate(user.id);

      await expect(
        repository.updateLocked(user.id, () => {
          throw new Error('refused');
        }),
      ).rejects.toThrow('refused');

      const [row] = await db
        .select()
        .from(privacySettings)
        .where(eq(privacySettings.userId, user.id));
      expect(row?.publicProfile).toBe(false);

      const logs = await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id));
      expect(logs).toHaveLength(0);
    });

    /**
     * The guarantee `updateLocked` rests on, tested directly rather than through an outcome.
     *
     * An earlier version of this test raced two `updateLocked` calls with `Promise.all` and
     * asserted the invariant on the resulting row. It passed with the lock **and without it**,
     * across repeated runs — the two transactions did not reliably interleave in the window
     * that matters, so it proved nothing. A concurrency test that cannot fail when the
     * protection is removed is worse than no test, because it reads as evidence.
     *
     * This asserts the mechanism instead, deterministically: while `updateLocked` holds the
     * row, a second `SELECT ... FOR UPDATE NOWAIT` on the same row must fail with Postgres's
     * lock_not_available (55P03). If the `.for('update')` is ever dropped from the repository,
     * the second statement succeeds and this test fails.
     */
    it('holds a row lock for the duration of the decision', async () => {
      const user = await newUser('locked-holds');
      await repository.findOrCreate(user.id);

      // A separate connection, so it contends for the row rather than joining the
      // transaction. It tries to take the same lock from *inside* the decision callback,
      // which is the only moment the repository's own transaction is provably holding it.
      const contender = new Pool({ connectionString });
      let contention: unknown = 'never attempted';

      try {
        await repository.updateLocked(user.id, async () => {
          try {
            await contender.query(
              'SELECT user_id FROM privacy_settings WHERE user_id = $1 FOR UPDATE NOWAIT',
              [user.id],
            );
            contention = null;
          } catch (error: unknown) {
            contention = error;
          }

          return { patch: { publicProfile: true }, audit: null };
        });
      } finally {
        await contender.end();
      }

      // 55P03 is lock_not_available: the row was already locked, which is exactly the
      // guarantee the consent rules depend on. Drop `.for('update')` from the repository and
      // the NOWAIT select succeeds instead, `contention` is null, and this fails — which is
      // how this test was confirmed to be load-bearing rather than merely green.
      expect((contention as { code?: string } | null)?.code).toBe('55P03');

      // And the lock is released afterwards, or every later request for this row would hang.
      const after = new Pool({ connectionString });
      try {
        const result = await after.query(
          'SELECT user_id FROM privacy_settings WHERE user_id = $1 FOR UPDATE NOWAIT',
          [user.id],
        );
        expect(result.rowCount).toBe(1);
      } finally {
        await after.end();
      }
    });

    /**
     * The application-level invariant, kept as a regression guard even though it cannot
     * force the interleaving (see the test above for why that matters). It never fails
     * spuriously: whichever order the two transactions commit in, location must not be left
     * enabled without the leaderboard that justifies it.
     */
    it('never leaves location enabled without the leaderboard under concurrent updates', async () => {
      const user = await newUser('locked-race');
      await repository.findOrCreate(user.id);
      await repository.update(user.id, { leaderboardOptIn: true, locationForLeaderboard: true });

      /** The same rule PrivacyService applies, reproduced here as the decision under test. */
      const decide =
        (request: { leaderboardOptIn?: boolean; locationForLeaderboard?: boolean }) =>
        (current: { leaderboardOptIn: boolean; locationForLeaderboard: boolean }) => {
          const leaderboardAfter = request.leaderboardOptIn ?? current.leaderboardOptIn;
          if (request.locationForLeaderboard === true && !leaderboardAfter) {
            throw new Error('refused');
          }
          const patch: Record<string, boolean> = { ...request };
          if (request.leaderboardOptIn === false && current.locationForLeaderboard) {
            patch.locationForLeaderboard = false;
          }
          return { patch, audit: null };
        };

      await Promise.allSettled([
        repository.updateLocked(user.id, decide({ leaderboardOptIn: false })),
        repository.updateLocked(user.id, decide({ locationForLeaderboard: true })),
      ]);

      const [row] = await db
        .select()
        .from(privacySettings)
        .where(eq(privacySettings.userId, user.id));

      if (row && !row.leaderboardOptIn) {
        expect(row.locationForLeaderboard).toBe(false);
      }
    });
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
