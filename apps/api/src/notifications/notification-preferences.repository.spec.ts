import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@forjd/domain';

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
    expect(result.updatedAt).toBeNull();
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
    });
    expect((await repository.get(user.id)).preferences).toEqual(result.preferences);
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
    const all = { workout: false, recovery: false, pr: false, rank: true, weekly: false };

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

    const rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
