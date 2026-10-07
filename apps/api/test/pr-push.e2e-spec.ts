import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { exercises } from '../src/database/schema/exercises.schema';
import { pushOutbox } from '../src/database/schema/push-outbox.schema';
import { users } from '../src/database/schema/users.schema';
import { workoutSessions } from '../src/database/schema/workouts.schema';
import { FakeNotificationProvider } from '../src/integrations/push/fake-notification-provider';
import { NOTIFICATION_PROVIDER } from '../src/integrations/push/notification-provider';
import { acquirePushSuiteLock } from '../src/test-support/push-suite-lock';
import { markAdult } from './support/adult';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `e2e-prpush-${suiteId}@example.com`;
const phoneToken = `ExponentPushToken[prpush-${suiteId}]`;
const HOUR = 3_600_000;

/**
 * A new lift record over real HTTP and real Postgres queues one push (Phase 12F slice 5a). The rules are unit tested; this
 * shows the whole path: upload, detection against stored history, the outbox row, the send through the (fake) provider, and
 * that a retried upload or a backlog upload does not produce a second or a stale push.
 */
describe('PR push (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let pool: Pool;
  let releaseLock: () => Promise<void>;
  const provider = new FakeNotificationProvider(`prpush-${suiteId}`);
  const sessionIds: string[] = [];
  const exerciseIds: string[] = [];
  let squat: string;
  let deadlift: string;
  let userId: string;

  const upload = (exerciseId: string, weightKg: number, startedAt: Date, id = randomUUID()) => {
    sessionIds.push(id);
    return request(app.getHttpServer())
      .post('/api/v1/workouts/sessions')
      .set('Authorization', 'Bearer pr-token')
      .send({
        id,
        name: `${suiteId} Lifting`,
        activity: 'strength',
        status: 'completed',
        startedAt: startedAt.toISOString(),
        endedAt: new Date(startedAt.getTime() + 1800_000).toISOString(),
        durationSeconds: 1800,
        isLiveTracked: true,
        exercises: [{ exerciseId, sets: [{ type: 'working', isCompleted: true, weightKg, reps: 5 }] }],
      })
      .expect(201)
      .then(() => id);
  };
  const uploadRun = (distanceMeters: number, movingSeconds: number, startedAt: Date) => {
    const id = randomUUID();
    sessionIds.push(id);
    return request(app.getHttpServer())
      .post('/api/v1/workouts/sessions')
      .set('Authorization', 'Bearer pr-token')
      .send({
        id,
        name: `${suiteId} Run`,
        activity: 'running',
        status: 'completed',
        startedAt: startedAt.toISOString(),
        endedAt: new Date(startedAt.getTime() + movingSeconds * 1000).toISOString(),
        durationSeconds: movingSeconds,
        isLiveTracked: true,
        exercises: [],
        run: { distanceMeters, movingSeconds, elevationGainMeters: null, avgHeartRateBpm: null, caloriesKcal: null, caloriesSource: null, splits: [] },
      })
      .expect(201)
      .then(() => id);
  };
  const outboxFor = (id: string) => db.select().from(pushOutbox).where(eq(pushOutbox.dedupeKey, `pr:${id}`));
  const sentCount = async () => {
    for (let i = 0; i < 40 && provider.sent.length === 0; i += 1) await new Promise((r) => setTimeout(r, 50));
    return provider.sent.length;
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd',
    });
    releaseLock = await acquirePushSuiteLock(pool);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [{ email, externalId: randomUUID(), tokens: ['pr-token'] }],
          signIn: 'disabled',
        }),
      )
      .overrideProvider(NOTIFICATION_PROVIDER)
      .useValue(provider)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: 'Str0ngPass!' }).expect(201);
    await markAdult(app, email);
    const [user] = await db.select().from(users).where(eq(users.email, email));
    userId = user!.id;
    await request(app.getHttpServer())
      .post('/api/v1/users/me/push-tokens')
      .set('Authorization', 'Bearer pr-token')
      .send({ token: phoneToken, platform: 'android' })
      .expect(204);

    // Quiet hours cannot be switched off, so make them a one-minute window twelve hours from now: a push is then sent at once
    // whatever the time of day the suite runs (a push inside quiet hours is held, which the policy specs already prove).
    const startMinute = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 720) % 1440;
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/notifications')
      .set('Authorization', 'Bearer pr-token')
      .send({ quietHours: { startMinute, endMinute: (startMinute + 1) % 1440 } })
      .expect(200);

    for (const name of ['Back squat', 'Deadlift']) {
      const [row] = await db
        .insert(exercises)
        .values({ name: `${suiteId} ${name}`, slug: `${suiteId}-${name.toLowerCase().replace(' ', '-')}`, category: 'strength', goal: 'strength', measure: 'weight' })
        .returning();
      exerciseIds.push(row!.id);
    }
    [squat, deadlift] = exerciseIds as [string, string];
  });

  afterAll(async () => {
    // The send after an upload is not awaited by the request: let it finish before the rows and the pool go away.
    for (let i = 0; i < 40; i += 1) {
      const pending = (await db.select().from(pushOutbox).where(eq(pushOutbox.userId, userId))).filter((row) =>
        ['pending', 'sending'].includes(row.status),
      );
      if (pending.length === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await db.delete(pushOutbox).where(eq(pushOutbox.userId, userId));
    await db.delete(workoutSessions).where(inArray(workoutSessions.id, sessionIds));
    await db.delete(users).where(eq(users.email, email));
    await db.delete(exercises).where(inArray(exercises.id, exerciseIds));
    await app.close();
    await releaseLock();
    await pool.end();
  });

  it('says nothing for a first lift, then queues and sends one push for a heavier one, with no weight in it', async () => {
    const first = await upload(squat, 100, new Date(Date.now() - 3 * HOUR));
    expect(await outboxFor(first)).toHaveLength(0);

    const second = await upload(squat, 120, new Date(Date.now() - 1 * HOUR));

    const rows = await outboxFor(second);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, kind: 'pr', data: { type: 'pr', sessionId: second } });
    expect(rows[0]!.title).toBe(`New PR on ${suiteId} Back squat`);
    expect(`${rows[0]!.title} ${rows[0]!.body}`).not.toMatch(/120|100|kg/);
    expect(await sentCount()).toBe(1);
    expect(provider.sent[0]).toMatchObject({ token: phoneToken, channelId: 'updates' });
  });

  it('is still one push when the same upload is retried', async () => {
    const id = await upload(squat, 130, new Date(Date.now() - 30 * 60_000));
    await upload(squat, 130, new Date(Date.now() - 30 * 60_000), id);

    expect(await outboxFor(id)).toHaveLength(1);
  });

  it('says nothing for a first run, then celebrates a longer one without naming a distance', async () => {
    const first = await uploadRun(5000, 1800, new Date(Date.now() - 4 * HOUR));
    expect(await outboxFor(first)).toHaveLength(0);

    const longer = await uploadRun(8000, 3200, new Date(Date.now() - 2 * HOUR));

    const rows = await outboxFor(longer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'pr', title: 'New PR: your longest run', data: { type: 'pr', sessionId: longer } });
    expect(`${rows[0]!.title} ${rows[0]!.body}`).not.toMatch(/8000|8 km|5000|km|min/);
  });

  it('does not celebrate a record from a workout uploaded days late', async () => {
    await upload(deadlift, 140, new Date(Date.now() - 7 * 24 * HOUR));
    const late = await upload(deadlift, 160, new Date(Date.now() - 5 * 24 * HOUR));

    expect(await outboxFor(late)).toHaveLength(0);
  });
});
