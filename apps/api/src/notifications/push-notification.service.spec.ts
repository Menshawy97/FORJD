import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { buildPrPush, buildRankPush } from '@forjd/domain';

import { preferences } from '../database/schema/preferences.schema';
import { users } from '../database/schema/users.schema';
import { FakeNotificationProvider } from '../integrations/push/fake-notification-provider';
import { acquirePushSuiteLock } from '../test-support/push-suite-lock';
import { UsersRepository } from '../users/users.repository';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { PushNotificationService } from './push-notification.service';
import { PushOutboxRepository } from './push-outbox.repository';
import { PushTokensRepository } from './push-tokens.repository';

/**
 * Phase 12F slice 3b. The outbox and the dispatcher against real Postgres with the fake provider, so what is proved is
 * what production does: a push is queued once, held outside quiet hours, re-checked at the moment it goes, sent to every
 * phone, cleaned up when a phone is gone, retried with backoff, and never sent twice. The fake records the exact payload,
 * which is also where ADR-061's "no health value in a captured payload" is checked.
 */
describe('PushNotificationService (Phase 12F)', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let outbox: PushOutboxRepository;
  let tokens: PushTokensRepository;
  let prefs: NotificationPreferencesRepository;
  let usersRepository: UsersRepository;
  let provider: FakeNotificationProvider;
  let ticketPrefix: string;
  let service: PushNotificationService;
  let releaseLock: () => Promise<void>;
  const createdEmails: string[] = [];
  const suite = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let counter = 0;

  // Midday UTC: outside the default quiet hours.
  const NOW = new Date('2026-10-07T12:00:00.000Z');
  const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

  const pr = buildPrPush({ sessionId: 'session-1', records: [{ type: 'lift', exerciseName: 'Back Squat' }] })!;

  async function person(label: string, opts: { pr?: boolean; rank?: boolean; phones?: number; timeZone?: string } = {}) {
    const email = `pushsvc-${label}-${suite}@example.com`;
    createdEmails.push(email);
    const user = await usersRepository.upsertFromIdentity(crypto.randomUUID(), email);
    await prefs.upsert(user.id, { pr: opts.pr ?? true, rank: opts.rank ?? true });
    if (opts.timeZone) await db.insert(preferences).values({ userId: user.id, timezone: opts.timeZone });
    const phones: string[] = [];
    for (let index = 0; index < (opts.phones ?? 1); index += 1) {
      const token = `ExponentPushToken[${label}-${index}-${suite}]`;
      phones.push(token);
      await tokens.register(user.id, token, 'android');
    }
    return { user, phones };
  }

  const enqueuePr = (userId: string, over: Partial<Parameters<PushNotificationService['enqueue']>[0]> = {}) =>
    service.enqueue({ userId, kind: 'pr', dedupeKey: `pr:${suite}:${counter++}`, content: pr, occurredAt: later(-5), now: NOW, ...over });

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    outbox = new PushOutboxRepository(db);
    tokens = new PushTokensRepository(db);
    prefs = new NotificationPreferencesRepository(db);
    usersRepository = new UsersRepository(db);
    // A dispatcher claims every due row in the table, so this file and the repository spec take turns.
    releaseLock = await acquirePushSuiteLock(pool);
  }, 120_000);

  beforeEach(() => {
    // A prefix of its own per test, so tickets left in the shared database by other tests never share an id with these.
    ticketPrefix = `t${counter++}-${suite}`;
    provider = new FakeNotificationProvider(ticketPrefix);
    service = new PushNotificationService(outbox, tokens, prefs, provider);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await releaseLock();
    await pool.end();
  });

  describe('enqueue', () => {
    it('queues a push for a person who wants it and has a phone, to go now in the daytime', async () => {
      const { user } = await person('queue');

      expect(await enqueuePr(user.id)).toEqual({ result: 'queued' });

      const [row] = await outbox.listForUser(user.id);
      expect(row).toMatchObject({ kind: 'pr', status: 'pending', title: 'New PR on Back Squat', data: { type: 'pr', sessionId: 'session-1' } });
      expect(row!.sendAfter.getTime()).toBe(NOW.getTime());
    });

    it('holds a push that would land in quiet hours until the morning in the person own time zone', async () => {
      const { user } = await person('hold', { timeZone: 'Africa/Cairo' });
      const snapshot = new Date('2026-10-10T00:20:00.000Z'); // 03:20 in Cairo
      const content = buildRankPush({ direction: 'up', cityName: 'Cairo', weekStart: '2026-10-10' });

      const result = await service.enqueue({ userId: user.id, kind: 'rank', dedupeKey: `rank:${suite}:hold`, content, occurredAt: snapshot, now: snapshot });

      expect(result).toEqual({ result: 'queued' });
      const [row] = await outbox.listForUser(user.id);
      expect(row!.sendAfter.toISOString()).toBe('2026-10-10T04:00:00.000Z'); // 07:00 in Cairo
    });

    it('stores nothing and says why when the push is not wanted, cannot be delivered or is stale', async () => {
      const off = await person('off', { pr: false });
      const noPhone = await person('nophone', { phones: 0 });
      const stale = await person('stale');

      expect(await enqueuePr(off.user.id)).toEqual({ result: 'dropped', reason: 'switch_off' });
      expect(await enqueuePr(noPhone.user.id)).toEqual({ result: 'dropped', reason: 'no_token' });
      expect(await enqueuePr(stale.user.id, { occurredAt: later(-60 * 25) })).toEqual({ result: 'dropped', reason: 'too_old' });

      for (const { user } of [off, noPhone, stale]) expect(await outbox.listForUser(user.id)).toEqual([]);
    });

    it('answers duplicate for a key it has seen, so a retried upload queues one push', async () => {
      const { user } = await person('dup');
      await enqueuePr(user.id, { dedupeKey: `pr:${suite}:same` });

      expect(await enqueuePr(user.id, { dedupeKey: `pr:${suite}:same` })).toEqual({ result: 'duplicate' });

      expect(await outbox.listForUser(user.id)).toHaveLength(1);
    });
  });

  describe('dispatchDue', () => {
    it('sends to every phone of the person with the channel, priority and a time to live, and marks the row sent', async () => {
      const { user, phones } = await person('send', { phones: 2 });
      await enqueuePr(user.id, { occurredAt: later(-60) });

      const summary = await service.dispatchDue(NOW);

      expect(summary.sent).toBeGreaterThanOrEqual(1);
      expect(provider.sent.filter((message) => phones.includes(message.token))).toEqual(
        phones.map((token) => ({
          token,
          title: 'New PR on Back Squat',
          body: 'Open FORJD to see it.',
          data: { type: 'pr', sessionId: 'session-1' },
          channelId: 'updates',
          priority: 'high',
          // A PR is news for 24 hours; it happened an hour ago, so 23 hours are left.
          ttlSeconds: 23 * 3600,
        })),
      );
      const [row] = await outbox.listForUser(user.id);
      expect(row).toMatchObject({ status: 'sent' });
      expect(row!.sentAt!.getTime()).toBe(NOW.getTime());
    });

    it('puts no health value in anything it sends (ADR-061): the captured payload is only the text and a kind and an id', async () => {
      const { user, phones } = await person('adr');
      const HEALTH = ['ZZ-HR-142', 'ZZ-HRV-91', 'ZZ-SLEEP-5h12', 'ZZ-KCAL-2310', 'ZZ-WEIGHT-81.4'];
      const content = buildPrPush({
        sessionId: 'session-9',
        records: [{ type: 'lift', exerciseName: 'Back Squat' }],
        ...Object.fromEntries(HEALTH.map((value, index) => [`health${index}`, value])),
      } as unknown as Parameters<typeof buildPrPush>[0])!;
      await service.enqueue({ userId: user.id, kind: 'pr', dedupeKey: `pr:${suite}:adr`, content, occurredAt: later(-5), now: NOW });

      await service.dispatchDue(NOW);

      const captured = JSON.stringify(provider.sent.filter((message) => phones.includes(message.token)));
      expect(captured).toContain('New PR on Back Squat');
      for (const value of HEALTH) expect(captured).not.toContain(value);
    });

    it('leaves a push that is not due yet for later', async () => {
      const { user, phones } = await person('notdue');
      await enqueuePr(user.id, { now: later(60) });

      await service.dispatchDue(NOW);

      expect(provider.sent.filter((message) => phones.includes(message.token))).toEqual([]);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'pending' });
    });

    it('checks again at the moment it goes: a switch turned off since is respected', async () => {
      const { user, phones } = await person('turnedoff');
      await enqueuePr(user.id);
      await prefs.upsert(user.id, { pr: false });

      await service.dispatchDue(NOW);

      expect(provider.sent.filter((message) => phones.includes(message.token))).toEqual([]);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'dropped', dropReason: 'switch_off' });
    });

    it('holds again when it is late enough that quiet hours have started, and does not count that as an attempt', async () => {
      const { user, phones } = await person('late');
      await enqueuePr(user.id);
      const night = new Date('2026-10-07T23:00:00.000Z');

      await service.dispatchDue(night);

      expect(provider.sent.filter((message) => phones.includes(message.token))).toEqual([]);
      const [row] = await outbox.listForUser(user.id);
      expect(row).toMatchObject({ status: 'pending', attempts: 0 });
      expect(row!.sendAfter.toISOString()).toBe('2026-10-08T07:00:00.000Z');
    });

    it('removes a phone the service says is gone, and still counts the push as sent if another phone took it', async () => {
      const { user, phones } = await person('dead', { phones: 2 });
      provider.rejectAtSend(phones[0]!, 'device_not_registered');
      await enqueuePr(user.id);

      await service.dispatchDue(NOW);

      expect((await tokens.listForUser(user.id)).map((token) => token.token)).toEqual([phones[1]]);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'sent' });
    });

    it('drops the push, with the reason, when every phone turns out to be gone', async () => {
      const { user, phones } = await person('alldead', { phones: 2 });
      for (const phone of phones) provider.rejectAtSend(phone, 'device_not_registered');
      await enqueuePr(user.id);

      await service.dispatchDue(NOW);

      expect(await tokens.listForUser(user.id)).toEqual([]);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'dropped', dropReason: 'no_token' });
    });

    it('retries a push the service could not take, later each time, and gives up after five attempts', async () => {
      const { user } = await person('retry');
      provider.breakTransport();
      await enqueuePr(user.id, { occurredAt: later(-5) });
      let clock = NOW;

      const sendAfters: string[] = [];
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await service.dispatchDue(clock);
        const [row] = await outbox.listForUser(user.id);
        sendAfters.push(row!.sendAfter.toISOString());
        if (row!.status === 'failed') break;
        expect(row).toMatchObject({ status: 'pending', attempts: attempt });
        clock = row!.sendAfter;
      }

      const [final] = await outbox.listForUser(user.id);
      expect(final).toMatchObject({ status: 'failed', attempts: 4 });
      // 5, 10, 20, 40 minutes between attempts: it backs off instead of hammering a service that is down.
      const gaps = sendAfters
        .slice(0, 4)
        .map((iso, index) => (new Date(iso).getTime() - (index === 0 ? NOW.getTime() : new Date(sendAfters[index - 1]!).getTime())) / 60_000);
      expect(gaps).toEqual([5, 10, 20, 40]);
    });

    it('does not send again when it fails to write down that it sent: the push may already be on the phone', async () => {
      const { user, phones } = await person('postsend');
      await enqueuePr(user.id);
      jest.spyOn(outbox, 'markSent').mockRejectedValueOnce(new Error('database went away'));

      const first = await service.dispatchDue(NOW);
      const second = await service.dispatchDue(NOW);

      expect(first.retried).toBe(0);
      expect(provider.sent.filter((message) => phones.includes(message.token))).toHaveLength(1);
      expect(second.claimed).toBeGreaterThanOrEqual(0);
      expect(provider.sent.filter((message) => phones.includes(message.token))).toHaveLength(1);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'sending', attempts: 0 });
      jest.restoreAllMocks();
    });

    it('still marks the push sent when one ticket cannot be kept (a phone unregistered in between)', async () => {
      const { user } = await person('ticketfail', { phones: 2 });
      await enqueuePr(user.id);
      jest.spyOn(outbox, 'addTickets').mockRejectedValueOnce(new Error('foreign key'));

      const summary = await service.dispatchDue(NOW);

      expect(summary.sent).toBeGreaterThanOrEqual(1);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'sent' });
      jest.restoreAllMocks();
    });

    it('gives up on a push that has used all its tries, even when the tries were dispatchers that died', async () => {
      const { user, phones } = await person('poison');
      await enqueuePr(user.id);
      const [row] = await outbox.listForUser(user.id);
      for (let attempt = 0; attempt < 5; attempt += 1) await outbox.release(row!.id, NOW, true);

      const summary = await service.dispatchDue(NOW);

      expect(summary.failed).toBeGreaterThanOrEqual(1);
      expect(provider.sent.filter((message) => phones.includes(message.token))).toEqual([]);
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'failed' });
    });

    it('fails at once when the service refuses the message for a reason that will not change', async () => {
      const { user, phones } = await person('toobig');
      provider.rejectAtSend(phones[0]!, 'message_too_big');
      await enqueuePr(user.id);

      await service.dispatchDue(NOW);

      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'failed' });
    });

    it('never sends twice when two dispatchers run at the same moment', async () => {
      const { user, phones } = await person('twice', { phones: 2 });
      await enqueuePr(user.id);
      const other = new PushNotificationService(outbox, tokens, prefs, provider);

      await Promise.all([service.dispatchDue(NOW), other.dispatchDue(NOW)]);

      expect(provider.sent.filter((message) => phones.includes(message.token))).toHaveLength(2);
    });

    it('gives a rank change only as long to live as it has left of its own freshness', async () => {
      const { user, phones } = await person('rank');
      const content = buildRankPush({ direction: 'down', cityName: 'Cairo', weekStart: '2026-10-03' });
      await service.enqueue({ userId: user.id, kind: 'rank', dedupeKey: `rank:${suite}:ttl`, content, occurredAt: later(-60 * 24), now: NOW });

      await service.dispatchDue(NOW);

      const sent = provider.sent.find((message) => message.token === phones[0]);
      expect(sent).toMatchObject({ title: 'You moved down in Cairo', ttlSeconds: 24 * 3600 });
    });
  });

  describe('checkReceipts', () => {
    it('asks about a ticket only after a quarter of an hour, and marks it checked when the service answers', async () => {
      const { user } = await person('receipt');
      await enqueuePr(user.id);
      await service.dispatchDue(NOW);
      const requestsAfterSend = provider.requestCount;

      expect(await service.checkReceipts(later(5))).toMatchObject({ checked: 0 });
      expect(provider.requestCount).toBe(requestsAfterSend);

      expect(await service.checkReceipts(later(16))).toMatchObject({ checked: 1, removedTokens: 0 });
      expect(await service.checkReceipts(later(17))).toMatchObject({ checked: 0 });
    });

    it('removes a phone whose receipt says the device is gone', async () => {
      const { user, phones } = await person('rcptdead', { phones: 2 });
      await enqueuePr(user.id);
      await service.dispatchDue(NOW);
      const deadToken = (await tokens.listForUser(user.id)).find((token) => token.token === phones[0])!;
      const tickets = await outbox.dueTickets(later(16), 1000);
      const deadTicket = tickets.find((ticket) => ticket.deviceTokenId === deadToken.id)!;
      provider.setReceipt(deadTicket.ticketId, 'device_not_registered');

      const summary = await service.checkReceipts(later(16));

      expect(summary).toMatchObject({ removedTokens: 1 });
      expect((await tokens.listForUser(user.id)).map((token) => token.token)).toEqual([phones[1]]);
    });

    it('leaves a ticket the service does not know yet, and gives up on it after a day', async () => {
      const { user } = await person('unknown');
      await enqueuePr(user.id);
      await service.dispatchDue(NOW);
      const [ticket] = (await outbox.dueTickets(later(16), 1000)).filter((t) => t.ticketId.startsWith(ticketPrefix));
      // Make the fake forget this ticket, as a service that has not got to it yet would.
      (provider as unknown as { issued: Set<string> }).issued.delete(ticket!.ticketId);

      expect(await service.checkReceipts(later(16))).toMatchObject({ checked: 0 });
      expect((await outbox.dueTickets(later(16), 1000)).some((t) => t.id === ticket!.id)).toBe(true);

      await service.checkReceipts(later(60 * 25));
      expect((await outbox.dueTickets(later(60 * 25), 1000)).some((t) => t.id === ticket!.id)).toBe(false);
    });
  });

  describe('drain', () => {
    it('still sends and tidies up when reading receipts fails, and says what it did', async () => {
      const { user, phones } = await person('drainfail');
      await enqueuePr(user.id);
      jest.spyOn(service, 'checkReceipts').mockRejectedValueOnce(new Error('service down'));

      const result = await service.drain(NOW);

      expect(result.dispatched.sent).toBeGreaterThanOrEqual(1);
      expect(result.receipts).toEqual({ checked: 0, removedTokens: 0, expired: 0 });
      expect(typeof result.purged).toBe('number');
      expect(provider.sent.filter((message) => phones.includes(message.token))).toHaveLength(1);
      jest.restoreAllMocks();
    });

    it('sends what is due, reads receipts and tidies up, and reports each', async () => {
      const { user } = await person('drain');
      await enqueuePr(user.id);

      const first = await service.drain(NOW);
      const second = await service.drain(later(16));

      expect(first.dispatched.sent).toBeGreaterThanOrEqual(1);
      expect(second.receipts.checked).toBeGreaterThanOrEqual(1);
      expect(typeof second.purged).toBe('number');
      expect((await outbox.listForUser(user.id))[0]).toMatchObject({ status: 'sent' });
    });
  });
});
