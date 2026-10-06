import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { devicePushTokens } from '../database/schema/device-push-tokens.schema';
import { users } from '../database/schema/users.schema';
import { UsersRepository } from '../users/users.repository';
import { MAX_PUSH_TOKENS_PER_USER, PushTokensRepository } from './push-tokens.repository';

/**
 * Real Postgres, like the other repository specs: what is under test is the unique token, the upsert that moves a
 * token to the account now using the phone, the per-person cap and the cascade on account deletion.
 */
describe('PushTokensRepository (Phase 12F)', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: PushTokensRepository;
  let usersRepository: UsersRepository;
  const createdEmails: string[] = [];
  const suite = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let counter = 0;
  const token = (label: string): string => `ExponentPushToken[${label}-${suite}-${counter++}]`;

  const newUser = (label: string): Promise<{ id: string }> => {
    const email = `pushtokens-${label}-${suite}@example.com`;
    createdEmails.push(email);
    return usersRepository.upsertFromIdentity(crypto.randomUUID(), email);
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new PushTokensRepository(db);
    usersRepository = new UsersRepository(db);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await pool.end();
  });

  it('stores a token for the person and lists it', async () => {
    const user = await newUser('store');
    const value = token('store');

    await repository.register(user.id, value, 'android');

    const rows = await repository.listForUser(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: value, platform: 'android' });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(rows[0]?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('is idempotent: registering the same token again keeps one row and moves last seen forward', async () => {
    const user = await newUser('idem');
    const value = token('idem');
    await repository.register(user.id, value, 'android');
    const [first] = await repository.listForUser(user.id);

    await new Promise((resolve) => setTimeout(resolve, 15));
    await repository.register(user.id, value, 'android');

    const rows = await repository.listForUser(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastSeenAt.getTime()).toBeGreaterThan(first!.lastSeenAt.getTime());
    expect(rows[0]!.createdAt.getTime()).toBe(first!.createdAt.getTime());
  });

  it('moves a token to the account now using the phone, so the earlier account stops receiving its pushes', async () => {
    const a = await newUser('move-a');
    const b = await newUser('move-b');
    const value = token('move');
    await repository.register(a.id, value, 'android');

    await repository.register(b.id, value, 'android');

    expect(await repository.listForUser(a.id)).toEqual([]);
    expect((await repository.listForUser(b.id)).map((row) => row.token)).toEqual([value]);
  });

  it('keeps several phones for one person, up to a cap, dropping the one seen longest ago', async () => {
    const user = await newUser('cap');
    const values: string[] = [];
    for (let index = 0; index < MAX_PUSH_TOKENS_PER_USER; index += 1) {
      const value = token(`cap${index}`);
      values.push(value);
      await repository.register(user.id, value, 'android');
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    expect(await repository.listForUser(user.id)).toHaveLength(MAX_PUSH_TOKENS_PER_USER);

    const newest = token('cap-newest');
    await repository.register(user.id, newest, 'ios');

    const kept = (await repository.listForUser(user.id)).map((row) => row.token);
    expect(kept).toHaveLength(MAX_PUSH_TOKENS_PER_USER);
    expect(kept).toContain(newest);
    expect(kept).not.toContain(values[0]);
  });

  it('re-registering a token the person already holds, at the cap, refreshes it and evicts nothing', async () => {
    const user = await newUser('cap-refresh');
    const values: string[] = [];
    for (let index = 0; index < MAX_PUSH_TOKENS_PER_USER; index += 1) {
      const value = token(`capr${index}`);
      values.push(value);
      await repository.register(user.id, value, 'android');
      await new Promise((resolve) => setTimeout(resolve, 3));
    }

    await repository.register(user.id, values[0]!, 'android');

    const kept = (await repository.listForUser(user.id)).map((row) => row.token);
    expect(kept).toHaveLength(MAX_PUSH_TOKENS_PER_USER);
    expect(kept).toEqual(expect.arrayContaining(values));
  });

  it("moving a token into an account that is at the cap evicts that account's oldest token and leaves the other account alone", async () => {
    const full = await newUser('cap-move-full');
    const other = await newUser('cap-move-other');
    const fullTokens: string[] = [];
    for (let index = 0; index < MAX_PUSH_TOKENS_PER_USER; index += 1) {
      const value = token(`capm${index}`);
      fullTokens.push(value);
      await repository.register(full.id, value, 'android');
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    const moving = token('capm-moving');
    const otherKeep = token('capm-other-keep');
    await repository.register(other.id, moving, 'ios');
    await repository.register(other.id, otherKeep, 'ios');

    await repository.register(full.id, moving, 'ios');

    const fullNow = (await repository.listForUser(full.id)).map((row) => row.token);
    expect(fullNow).toHaveLength(MAX_PUSH_TOKENS_PER_USER);
    expect(fullNow).toContain(moving);
    expect(fullNow).not.toContain(fullTokens[0]);
    expect((await repository.listForUser(other.id)).map((row) => row.token)).toEqual([otherKeep]);
  });

  it('never leaves more than the cap when several phones register at once', async () => {
    const user = await newUser('cap-race');
    for (let index = 0; index < MAX_PUSH_TOKENS_PER_USER - 1; index += 1) {
      await repository.register(user.id, token(`race${index}`), 'android');
    }

    await Promise.all(
      Array.from({ length: 6 }, (_, index) => repository.register(user.id, token(`race-new${index}`), 'android')),
    );

    expect(await repository.listForUser(user.id)).toHaveLength(MAX_PUSH_TOKENS_PER_USER);
  });

  it("removes only the caller's own token", async () => {
    const a = await newUser('rm-a');
    const b = await newUser('rm-b');
    const mine = token('rm-mine');
    const theirs = token('rm-theirs');
    await repository.register(a.id, mine, 'android');
    await repository.register(b.id, theirs, 'android');

    expect(await repository.remove(a.id, theirs)).toBe(false);
    expect(await repository.remove(a.id, mine)).toBe(true);
    expect(await repository.remove(a.id, mine)).toBe(false);

    expect(await repository.listForUser(a.id)).toEqual([]);
    expect(await repository.listForUser(b.id)).toHaveLength(1);
  });

  it('deletes tokens the platform rejected, whoever holds them', async () => {
    const user = await newUser('invalid');
    const dead = token('dead');
    const alive = token('alive');
    await repository.register(user.id, dead, 'android');
    await repository.register(user.id, alive, 'android');

    await repository.deleteByTokens([dead, 'ExponentPushToken[not-stored]']);
    await repository.deleteByTokens([]);

    expect((await repository.listForUser(user.id)).map((row) => row.token)).toEqual([alive]);
  });

  it('refuses a platform the database does not know', async () => {
    const user = await newUser('platform');

    await expect(
      db.insert(devicePushTokens).values({ userId: user.id, token: token('bad'), platform: 'web' }),
    ).rejects.toThrow();
  });

  it('is removed with the account, so deletion leaves nothing behind', async () => {
    const user = await newUser('cascade');
    await repository.register(user.id, token('cascade'), 'android');

    await db.delete(users).where(eq(users.id, user.id));

    const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
