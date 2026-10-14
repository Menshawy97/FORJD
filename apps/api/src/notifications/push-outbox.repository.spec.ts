import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { devicePushTokens } from '../database/schema/device-push-tokens.schema';
import { preferences } from '../database/schema/preferences.schema';
import { pushOutbox, pushTickets } from '../database/schema/push-outbox.schema';
import { users } from '../database/schema/users.schema';
import { acquirePushSuiteLock } from '../test-support/push-suite-lock';
import { UsersRepository } from '../users/users.repository';
import { PushOutboxRepository, type NewOutboxEntry } from './push-outbox.repository';
import { PushTokensRepository } from './push-tokens.repository';

/**
 * Real Postgres, like the other repository specs: what is under test is the unique dedupe key, the claim that two
 * dispatchers cannot both win (`FOR UPDATE SKIP LOCKED`), a stale claim being taken back, and the cascade on deletion.
 */
describe('PushOutboxRepository (Phase 12F)', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: PushOutboxRepository;
  let tokens: PushTokensRepository;
  let usersRepository: UsersRepository;
  let releaseLock: () => Promise<void>;
  const createdEmails: string[] = [];
  const suite = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let counter = 0;
  const T0 = new Date('2026-10-07T12:00:00.000Z');
  const minutes = (n: number): Date => new Date(T0.getTime() + n * 60_000);

  const newUser = (label: string): Promise<{ id: string }> => {
    const email = `pushoutbox-${label}-${suite}@example.com`;
    createdEmails.push(email);
    return usersRepository.upsertFromIdentity(crypto.randomUUID(), email);
  };
  const entry = (userId: string, over: Partial<NewOutboxEntry> = {}): NewOutboxEntry => ({
    userId,
    kind: 'pr',
    dedupeKey: `pr:${suite}:${counter++}`,
    title: 'New PR on Back Squat',
    body: 'Open FORJD to see it.',
    data: { type: 'pr', sessionId: 's1' },
    occurredAt: T0,
    sendAfter: T0,
    ...over,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new PushOutboxRepository(db);
    tokens = new PushTokensRepository(db);
    usersRepository = new UsersRepository(db);
    // A claim works on the whole table, so this file and the service spec take turns.
    releaseLock = await acquirePushSuiteLock(pool);
  }, 120_000);

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await releaseLock();
    await pool.end();
  });

  describe('enqueue', () => {
    it('stores a pending row and answers true', async () => {
      const user = await newUser('enq');
      const e = entry(user.id);

      expect(await repository.enqueue(e)).toBe(true);

      const [row] = await repository.listForUser(user.id);
      expect(row).toMatchObject({
        userId: user.id,
        kind: 'pr',
        dedupeKey: e.dedupeKey,
        title: 'New PR on Back Squat',
        body: 'Open FORJD to see it.',
        data: { type: 'pr', sessionId: 's1' },
        status: 'pending',
        attempts: 0,
        claimedAt: null,
        sentAt: null,
        dropReason: null,
      });
      expect(row!.sendAfter.getTime()).toBe(T0.getTime());
    });

    it('answers false and stores nothing new for a dedupe key already used, so a retried upload cannot send twice', async () => {
      const user = await newUser('dup');
      const e = entry(user.id);
      await repository.enqueue(e);

      expect(await repository.enqueue({ ...e, title: 'changed' })).toBe(false);

      const rows = await repository.listForUser(user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toBe('New PR on Back Squat');
    });

    it('refuses a kind the database does not know', async () => {
      const user = await newUser('kind');

      await expect(db.insert(pushOutbox).values({ ...entry(user.id), kind: 'recovery' } as never)).rejects.toThrow();
    });
  });

  describe('claimDue', () => {
    it('claims only pending rows that are due, oldest first, up to the limit, and marks them sending', async () => {
      const user = await newUser('claim');
      const due1 = entry(user.id, { sendAfter: minutes(-30) });
      const due2 = entry(user.id, { sendAfter: minutes(-10) });
      const later = entry(user.id, { sendAfter: minutes(30) });
      for (const e of [due2, later, due1]) await repository.enqueue(e);

      const claimed = await repository.claimDue(T0, 10, minutes(-60));
      const mine = claimed.filter((row) => row.userId === user.id);

      expect(mine.map((row) => row.dedupeKey)).toEqual([due1.dedupeKey, due2.dedupeKey]);
      expect(mine.every((row) => row.status === 'sending' && row.claimedAt !== null)).toBe(true);
      const rows = await repository.listForUser(user.id);
      expect(rows.find((row) => row.dedupeKey === later.dedupeKey)!.status).toBe('pending');
    });

    it('gives each row to one dispatcher only when two claim at once', async () => {
      const user = await newUser('race');
      const keys: string[] = [];
      for (let index = 0; index < 12; index += 1) {
        const e = entry(user.id, { sendAfter: minutes(-5) });
        keys.push(e.dedupeKey);
        await repository.enqueue(e);
      }

      const [a, b] = await Promise.all([repository.claimDue(T0, 100, minutes(-60)), repository.claimDue(T0, 100, minutes(-60))]);

      const mineA = a.filter((row) => keys.includes(row.dedupeKey)).map((row) => row.dedupeKey);
      const mineB = b.filter((row) => keys.includes(row.dedupeKey)).map((row) => row.dedupeKey);
      expect([...mineA, ...mineB].sort()).toEqual([...keys].sort());
      expect(mineA.filter((key) => mineB.includes(key))).toEqual([]);
    });

    it('counts a stale take-back as a try, so a row that keeps killing its dispatcher ends up out of tries', async () => {
      const user = await newUser('poison');
      const e = entry(user.id, { sendAfter: minutes(-30) });
      await repository.enqueue(e);
      await repository.claimDue(minutes(-20), 100, minutes(-60));

      await repository.claimDue(T0, 100, minutes(-10));

      const [row] = await repository.listForUser(user.id);
      expect(row).toMatchObject({ status: 'sending', attempts: 1 });
    });

    it('renews a claim so a long batch is not taken for a dead dispatcher, and touches only a row that is still sending', async () => {
      const user = await newUser('touch');
      const e = entry(user.id, { sendAfter: minutes(-30) });
      await repository.enqueue(e);
      const [claimed] = (await repository.claimDue(minutes(-20), 100, minutes(-60))).filter((row) => row.dedupeKey === e.dedupeKey);

      await repository.touchClaim(claimed!.id, minutes(-1));
      const afterTouch = (await repository.get(claimed!.id))!;
      expect(afterTouch.claimedAt!.getTime()).toBe(minutes(-1).getTime());
      // Renewed a minute ago, so it is not stale for a dispatcher that counts ten minutes.
      expect((await repository.claimDue(T0, 100, minutes(-10))).filter((row) => row.dedupeKey === e.dedupeKey)).toHaveLength(0);

      await repository.markSent(claimed!.id, T0);
      await repository.touchClaim(claimed!.id, minutes(5));
      expect((await repository.get(claimed!.id))!.claimedAt).toBeNull();
    });

    it('takes back a claim that went stale (a dispatcher that died), and leaves a fresh claim alone', async () => {
      const user = await newUser('stale');
      const e = entry(user.id, { sendAfter: minutes(-30) });
      await repository.enqueue(e);
      await repository.claimDue(minutes(-20), 100, minutes(-60));

      const fresh = await repository.claimDue(T0, 100, minutes(-30));
      expect(fresh.filter((row) => row.dedupeKey === e.dedupeKey)).toHaveLength(0);

      const stale = await repository.claimDue(T0, 100, minutes(-10));
      expect(stale.filter((row) => row.dedupeKey === e.dedupeKey)).toHaveLength(1);
    });
  });

  describe('outcomes', () => {
    const claimOne = async (userId: string, over: Partial<NewOutboxEntry> = {}) => {
      const e = entry(userId, { sendAfter: minutes(-1), ...over });
      await repository.enqueue(e);
      const claimed = await repository.claimDue(T0, 100, minutes(-60));
      return claimed.find((row) => row.dedupeKey === e.dedupeKey)!;
    };

    it('marks a row sent, with when', async () => {
      const user = await newUser('sent');
      const row = await claimOne(user.id);

      await repository.markSent(row.id, T0);

      expect((await repository.get(row.id))!).toMatchObject({ status: 'sent' });
      expect((await repository.get(row.id))!.sentAt!.getTime()).toBe(T0.getTime());
    });

    it('marks a row dropped, with the reason', async () => {
      const user = await newUser('dropped');
      const row = await claimOne(user.id);

      await repository.markDropped(row.id, 'switch_off');

      expect(await repository.get(row.id)).toMatchObject({ status: 'dropped', dropReason: 'switch_off' });
    });

    it('marks a row failed', async () => {
      const user = await newUser('failed');
      const row = await claimOne(user.id);

      await repository.markFailed(row.id);

      expect(await repository.get(row.id)).toMatchObject({ status: 'failed' });
    });

    it('releases a row back to pending for a later time, counting the attempt only when asked', async () => {
      const user = await newUser('release');
      const row = await claimOne(user.id);

      await repository.release(row.id, minutes(15), true);
      const afterRetry = (await repository.get(row.id))!;
      expect(afterRetry).toMatchObject({ status: 'pending', attempts: 1, claimedAt: null });
      expect(afterRetry.sendAfter.getTime()).toBe(minutes(15).getTime());

      await repository.release(row.id, minutes(60), false);
      expect(await repository.get(row.id)).toMatchObject({ status: 'pending', attempts: 1 });
    });

    it('answers null for a row that does not exist', async () => {
      expect(await repository.get(crypto.randomUUID())).toBeNull();
    });
  });

  describe('tickets', () => {
    const withTicket = async (label: string, createdAt: Date) => {
      const user = await newUser(label);
      await tokens.register(user.id, `ExponentPushToken[${label}-${suite}]`, 'android');
      const [token] = await tokens.listForUser(user.id);
      const e = entry(user.id);
      await repository.enqueue(e);
      const [row] = await repository.listForUser(user.id);
      await repository.addTickets([{ outboxId: row!.id, deviceTokenId: token!.id, ticketId: `ticket-${label}-${suite}` }]);
      await db.update(pushTickets).set({ createdAt }).where(eq(pushTickets.outboxId, row!.id));
      return { user, token: token!, row: row! };
    };

    it('lists tickets that are old enough to have a receipt and not yet checked', async () => {
      const old = await withTicket('t-old', minutes(-60));
      await withTicket('t-recent', minutes(-5));

      const due = await repository.dueTickets(minutes(-15), 1000);

      const ids = due.map((ticket) => ticket.ticketId);
      expect(ids).toContain(`ticket-t-old-${suite}`);
      expect(ids).not.toContain(`ticket-t-recent-${suite}`);
      expect(due.find((ticket) => ticket.ticketId === `ticket-t-old-${suite}`)!.deviceTokenId).toBe(old.token.id);
    });

    it('stops listing tickets once they are marked checked', async () => {
      await withTicket('t-checked', minutes(-60));
      const [ticket] = (await repository.dueTickets(minutes(-15), 1000)).filter((t) => t.ticketId === `ticket-t-checked-${suite}`);

      await repository.markTicketsChecked([ticket!.id], T0);

      const again = await repository.dueTickets(minutes(-15), 1000);
      expect(again.find((t) => t.ticketId === `ticket-t-checked-${suite}`)).toBeUndefined();
      await expect(repository.markTicketsChecked([], T0)).resolves.toBeUndefined();
    });

    it('gives up on a ticket the service never answered once it is a day old', async () => {
      await withTicket('t-expire', minutes(-60 * 25));

      const expired = await repository.expireTickets(minutes(-60 * 24), T0);

      expect(expired).toBeGreaterThanOrEqual(1);
      const again = await repository.dueTickets(minutes(-15), 1000);
      expect(again.find((t) => t.ticketId === `ticket-t-expire-${suite}`)).toBeUndefined();
    });

    it('drops the ticket when its token is removed', async () => {
      const { token, user } = await withTicket('t-cascade', minutes(-60));

      await tokens.remove(user.id, token.token);

      expect((await repository.dueTickets(minutes(-15), 1000)).find((t) => t.ticketId === `ticket-t-cascade-${suite}`)).toBeUndefined();
    });
  });

  describe('purge', () => {
    it('removes finished rows older than the cutoff, and keeps pending ones and recent ones', async () => {
      const user = await newUser('purge');
      const oldSent = entry(user.id, { dedupeKey: `purge-old-${suite}` });
      const oldPending = entry(user.id, { dedupeKey: `purge-pending-${suite}` });
      const recentSent = entry(user.id, { dedupeKey: `purge-recent-${suite}` });
      for (const e of [oldSent, oldPending, recentSent]) await repository.enqueue(e);
      const rows = await repository.listForUser(user.id);
      const idOf = (key: string) => rows.find((row) => row.dedupeKey === key)!.id;
      await repository.markSent(idOf(oldSent.dedupeKey), minutes(-60 * 24 * 40));
      await repository.markSent(idOf(recentSent.dedupeKey), minutes(-60));
      await db.update(pushOutbox).set({ updatedAt: minutes(-60 * 24 * 40) }).where(eq(pushOutbox.id, idOf(oldSent.dedupeKey)));
      await db.update(pushOutbox).set({ updatedAt: minutes(-60 * 24 * 40) }).where(eq(pushOutbox.id, idOf(oldPending.dedupeKey)));

      const removed = await repository.purge(minutes(-60 * 24 * 30));

      expect(removed).toBeGreaterThanOrEqual(1);
      const left = (await repository.listForUser(user.id)).map((row) => row.dedupeKey).sort();
      expect(left).toEqual([`purge-pending-${suite}`, `purge-recent-${suite}`].sort());
    });
  });

  // The notifications list behind the Home bell (walk finding 17, slice B): only this person's pushes that were
  // actually sent, since the cut-off, newest first. Pending, dropped and failed rows never reached the phone.
  describe('listSentForUser', () => {
    const days = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);

    async function queueAndSend(userId: string, sentAt: Date, title: string): Promise<void> {
      const e = entry(userId, { title });
      await repository.enqueue(e);
      const row = (await repository.listForUser(userId)).find((r) => r.dedupeKey === e.dedupeKey)!;
      await repository.markSent(row.id, sentAt);
    }

    it("lists the person's sent pushes since the cut-off, newest first, and nobody else's", async () => {
      const user = await newUser('feed');
      const other = await newUser('feed-other');
      await queueAndSend(user.id, days(-2), 'older');
      await queueAndSend(user.id, days(-1), 'newer');
      await queueAndSend(user.id, days(-40), 'too old');
      await queueAndSend(other.id, days(-1), 'not theirs');
      await repository.enqueue(entry(user.id, { title: 'still pending' }));
      const dropped = entry(user.id, { title: 'dropped' });
      await repository.enqueue(dropped);
      const droppedRow = (await repository.listForUser(user.id)).find((r) => r.dedupeKey === dropped.dedupeKey)!;
      await repository.markDropped(droppedRow.id, 'quiet');

      const rows = await repository.listSentForUser(user.id, days(-30), 100);

      expect(rows.map((r) => r.title)).toEqual(['newer', 'older']);
      expect(rows[0]).toMatchObject({ kind: 'pr', body: 'Open FORJD to see it.', data: { type: 'pr', sessionId: 's1' } });
      expect(rows[0]!.sentAt!.getTime()).toBe(days(-1).getTime());
    });

    it('stops at the limit', async () => {
      const user = await newUser('feed-limit');
      await queueAndSend(user.id, days(-3), 'a');
      await queueAndSend(user.id, days(-2), 'b');
      await queueAndSend(user.id, days(-1), 'c');

      expect((await repository.listSentForUser(user.id, days(-30), 2)).map((r) => r.title)).toEqual(['c', 'b']);
    });
  });

  describe('timeZoneOf', () => {
    it('answers the time zone the person has stored, or null', async () => {
      const user = await newUser('tz');
      expect(await repository.timeZoneOf(user.id)).toBeNull();

      await db.insert(preferences).values({ userId: user.id, timezone: 'Africa/Cairo' });

      expect(await repository.timeZoneOf(user.id)).toBe('Africa/Cairo');
    });
  });

  it('is removed with the account, rows and tickets both', async () => {
    const user = await newUser('cascade');
    await tokens.register(user.id, `ExponentPushToken[cascade-${suite}]`, 'ios');
    const [token] = await tokens.listForUser(user.id);
    await repository.enqueue(entry(user.id));
    const [row] = await repository.listForUser(user.id);
    await repository.addTickets([{ outboxId: row!.id, deviceTokenId: token!.id, ticketId: `ticket-cascade-${suite}` }]);

    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.select().from(pushOutbox).where(eq(pushOutbox.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(pushTickets).where(eq(pushTickets.outboxId, row!.id))).toHaveLength(0);
    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.userId, user.id))).toHaveLength(0);
  });
});
