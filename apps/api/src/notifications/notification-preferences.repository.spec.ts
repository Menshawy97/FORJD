import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_QUIET_HOURS } from '@forjd/domain';

import { notificationPreferences } from '../database/schema/notification-preferences.schema';
import { users } from '../database/schema/users.schema';
import { UsersRepository } from '../users/users.repository';
import { NotificationPreferencesRepository } from './notification-preferences.repository';

/**
 * Real Postgres, like the other repository specs: the behaviour under test is column defaults,
 * NOT NULL, ON CONFLICT and cascade delete, all of which live in the database.
 */
describe('NotificationPreferencesRepository (Phase 12D)', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: NotificationPreferencesRepository;
  let usersRepository: UsersRepository;
  const createdEmails: string[] = [];

  const newUser = (label: string): Promise<{ id: string }> => {
    const email = `notifprefs-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    return usersRepository.upsertFromIdentity(crypto.randomUUID(), email);
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new NotificationPreferencesRepository(db);
    usersRepository = new UsersRepository(db);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await pool.end();
  });

  it('answers the defaults with a null timestamp when nothing was ever saved', async () => {
    const user = await newUser('none');

    const result = await repository.get(user.id);

    expect(result.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(result.quietHours).toEqual(DEFAULT_QUIET_HOURS);
    expect(result.updatedAt).toBeNull();
  });

  describe('quiet hours', () => {
    it('start at 22:00 to 07:00 on a row created by a switch change', async () => {
      const user = await newUser('quiet-default');

      const result = await repository.upsert(user.id, { rank: true });

      expect(result.quietHours).toEqual(DEFAULT_QUIET_HOURS);
    });

    it('are saved and read back, and a same-day window is kept as sent', async () => {
      const user = await newUser('quiet-save');

      const saved = await repository.upsert(user.id, {
        quietHours: { startMinute: 23 * 60, endMinute: 6 * 60 },
      });
      const afternoon = await repository.upsert(user.id, {
        quietHours: { startMinute: 13 * 60, endMinute: 15 * 60 },
      });

      expect(saved.quietHours).toEqual({ startMinute: 1380, endMinute: 360 });
      expect(afternoon.quietHours).toEqual({ startMinute: 780, endMinute: 900 });
      expect((await repository.get(user.id)).quietHours).toEqual({
        startMinute: 780,
        endMinute: 900,
      });
    });

    it('survive a switch change, and a switch survives a quiet-hours change', async () => {
      const user = await newUser('quiet-keep');
      await repository.upsert(user.id, {
        weekly: false,
        quietHours: { startMinute: 1380, endMinute: 360 },
      });

      const afterSwitch = await repository.upsert(user.id, { rank: true });
      const afterHours = await repository.upsert(user.id, {
        quietHours: { startMinute: 1260, endMinute: 480 },
      });

      expect(afterSwitch.quietHours).toEqual({ startMinute: 1380, endMinute: 360 });
      expect(afterHours.preferences).toMatchObject({ weekly: false, rank: true });
      expect(afterHours.quietHours).toEqual({ startMinute: 1260, endMinute: 480 });
    });

    it('are refused by the database when the times are equal or off the clock', async () => {
      const user = await newUser('quiet-check');

      for (const [start, end] of [
        [600, 600],
        [-1, 420],
        [1320, 1440],
      ] as const) {
        await expect(
          repository.upsert(user.id, { quietHours: { startMinute: start, endMinute: end } }),
        ).rejects.toThrow();
      }
      expect((await repository.get(user.id)).quietHours).toEqual(DEFAULT_QUIET_HOURS);
    });

    it('are saved together with a switch in one change', async () => {
      const user = await newUser('quiet-both');

      const result = await repository.upsert(user.id, { meals: true, quietHours: { startMinute: 1380, endMinute: 360 } });

      expect(result.preferences.meals).toBe(true);
      expect(result.quietHours).toEqual({ startMinute: 1380, endMinute: 360 });
    });

    it("never touch another user's row", async () => {
      const a = await newUser('quiet-iso-a');
      const b = await newUser('quiet-iso-b');

      await repository.upsert(a.id, { quietHours: { startMinute: 1380, endMinute: 360 } });

      expect((await repository.get(b.id)).quietHours).toEqual(DEFAULT_QUIET_HOURS);
    });
  });

  it('creates the row on the first change, with every other switch at its default', async () => {
    const user = await newUser('first');

    const result = await repository.upsert(user.id, { rank: true });

    expect(result.preferences).toEqual({ ...DEFAULT_NOTIFICATION_PREFERENCES, rank: true });
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it('changes only the switches sent, keeping the ones saved earlier', async () => {
    const user = await newUser('partial');
    await repository.upsert(user.id, { rank: true, workout: false });

    const result = await repository.upsert(user.id, { weekly: false });

    expect(result.preferences).toEqual({
      workout: false,
      recovery: true,
      pr: true,
      rank: true,
      weekly: false,
      meals: false,
      noWorkout: false,
      forgeClosing: false,
      weighIn: false,
    });
    expect((await repository.get(user.id)).preferences).toEqual(result.preferences);
  });

  it('starts the 12E reminders off, and saves each one on its own', async () => {
    const user = await newUser('reminders');

    const first = await repository.upsert(user.id, { meals: true });
    const second = await repository.upsert(user.id, { weighIn: true });

    expect(first.preferences).toMatchObject({
      meals: true,
      noWorkout: false,
      forgeClosing: false,
      weighIn: false,
    });
    expect(second.preferences).toMatchObject({
      meals: true,
      noWorkout: false,
      forgeClosing: false,
      weighIn: true,
    });
  });

  it('moves the timestamp forward on every change', async () => {
    const user = await newUser('stamp');
    const first = await repository.upsert(user.id, { pr: false });

    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await repository.upsert(user.id, { pr: true });

    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it('accepts all five at once', async () => {
    const user = await newUser('all');
    const all = {
      workout: false,
      recovery: false,
      pr: false,
      rank: true,
      weekly: false,
      meals: true,
      noWorkout: true,
      forgeClosing: true,
      weighIn: true,
    };

    expect((await repository.upsert(user.id, all)).preferences).toEqual(all);
  });

  it("never touches another user's row", async () => {
    const a = await newUser('iso-a');
    const b = await newUser('iso-b');

    await repository.upsert(a.id, { workout: false, rank: true });

    expect((await repository.get(b.id)).preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect((await repository.get(b.id)).updatedAt).toBeNull();
  });

  it('is removed with the account, so deletion leaves nothing behind', async () => {
    const user = await newUser('cascade');
    await repository.upsert(user.id, { rank: true });

    await db.delete(users).where(eq(users.id, user.id));

    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
