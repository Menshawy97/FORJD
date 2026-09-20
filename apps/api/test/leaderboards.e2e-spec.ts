import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { leaderboardResponseSchema } from '@forjd/contracts';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { exercises } from '../src/database/schema/exercises.schema';
import { users } from '../src/database/schema/users.schema';
import { workoutSessions } from '../src/database/schema/workouts.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';
import { markAdult } from './support/adult';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ATHLETE_COUNT = 6; // the viewer and five others: exactly enough for a board (MIN_COHORT_SIZE is 5)
const emailOf = (n: number): string => `e2e-leaderboard-${n}-${suiteId}@example.com`;
const tokenOf = (n: number): string => `lb-token-${n}`;
const externalIds = Array.from({ length: ATHLETE_COUNT + 2 }, () => randomUUID());
const OUTSIDER = ATHLETE_COUNT + 1; // never opts in
const NO_SESSIONS = ATHLETE_COUNT + 2; // opts in, never trains

// Alexandria, Egypt, well inside the city. The server resolves the city from this, for real.
const ALEXANDRIA = { latitude: 31.2001, longitude: 29.9187 };

/**
 * The city leaderboard over real HTTP (Phase 10).
 *
 * The unit suites cover every branch in isolation (`leaderboards.service.spec.ts` at 100%, the
 * repository against real Postgres). What only this suite proves is the whole chain: an upload
 * with a start position becomes a city on the row, that row becomes a place on a board, consent is
 * read live so a withdrawal removes someone on the very next request, and every state the screen
 * has to draw parses against the published contract.
 */
describe('Leaderboards (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let exerciseId: string;
  const createdSessionIds: string[] = [];

  const asAthlete = (n: number) => ({ Authorization: `Bearer ${tokenOf(n)}` });

  const board = (n: number, query = '') =>
    request(app.getHttpServer()).get(`/api/v1/leaderboards${query}`).set(asAthlete(n));

  const setPrivacy = (n: number, body: object) =>
    request(app.getHttpServer()).patch('/api/v1/users/me/privacy').set(asAthlete(n)).send(body);

  const upload = (n: number, over: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/workouts/sessions')
      .set(asAthlete(n))
      .send({
        id: randomUUID(),
        name: `${suiteId} session`,
        activity: 'strength',
        status: 'completed',
        // A minute ago, so it is inside the current month in any city.
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt: new Date().toISOString(),
        // Athlete n trains a little more than athlete n-1, in both time and volume, so the
        // ranking is strict and its order is known.
        durationSeconds: 1200 + 300 * n,
        isLiveTracked: true,
        startLocation: ALEXANDRIA,
        exercises: [
          { exerciseId, sets: [{ type: 'working', isCompleted: true, weightKg: 50 + 10 * n, reps: 5 }] },
        ],
        ...over,
      });

  beforeAll(async () => {
    const accounts = Array.from({ length: ATHLETE_COUNT + 2 }, (_, i) => ({
      email: emailOf(i + 1),
      externalId: externalIds[i] as string,
      tokens: [tokenOf(i + 1)],
    }));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(new FakeAuthProvider({ accounts, signIn: 'disabled' }))
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<Database>(DRIZZLE);

    for (let n = 1; n <= ATHLETE_COUNT + 2; n += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: emailOf(n), password: 'Str0ngPass!' })
        .expect(201);
      await markAdult(app, emailOf(n));
    }

    const [exerciseRow] = await db
      .insert(exercises)
      .values({
        name: `${suiteId} Bench Press`,
        slug: `${suiteId}-bench-press`,
        category: 'strength',
        goal: 'strength',
        measure: 'weight',
      })
      .returning();
    if (!exerciseRow) throw new Error('exercise seed insert returned no row');
    exerciseId = exerciseRow.id;

    // Everyone but the outsider joins leaderboards and allows location, then trains once.
    for (let n = 1; n <= ATHLETE_COUNT; n += 1) {
      await setPrivacy(n, { leaderboardOptIn: true, locationForLeaderboard: true, publicProfile: n !== 3 }).expect(200);
    }
    await setPrivacy(NO_SESSIONS, { leaderboardOptIn: true, locationForLeaderboard: true }).expect(200);
    for (let n = 1; n <= ATHLETE_COUNT; n += 1) {
      const response = await upload(n).expect(201);
      createdSessionIds.push(response.body.id);
    }
    // The outsider trains too, but has not joined: their session is stored and never counted.
    const outsider = await upload(OUTSIDER).expect(201);
    createdSessionIds.push(outsider.body.id);
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    await db.delete(users).where(inArray(users.email, Array.from({ length: ATHLETE_COUNT + 2 }, (_, i) => emailOf(i + 1))));
    await db.delete(exercises).where(inArray(exercises.id, [exerciseId]));
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/v1/leaderboards').expect(401);
  });

  it('ranks the city and parses against the published contract', async () => {
    const response = await board(1).expect(200);

    expect(() => leaderboardResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body).toMatchObject({
      status: 'ranked',
      metric: 'activity',
      period: 'month',
      city: { name: 'Alexandria', slug: 'alexandria-eg-361058' },
      cohortSize: ATHLETE_COUNT,
    });
  });

  it('puts the athlete who trained most first, and the one who trained least last', async () => {
    const top = await board(ATHLETE_COUNT, '?window=10').expect(200);
    const rows = top.body.rows as Array<{ rank: number; displayName: string; isSelf: boolean }>;

    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(top.body.me.rank).toBe(1);
    expect(rows[0]?.isSelf).toBe(true);

    const bottom = await board(1, '?window=10').expect(200);
    expect(bottom.body.me.rank).toBe(ATHLETE_COUNT);
  });

  it('marks exactly one row as the caller, and it agrees with me', async () => {
    const response = await board(3, '?window=10').expect(200);
    const selves = (response.body.rows as Array<{ isSelf: boolean; rank: number; score: number }>).filter((r) => r.isSelf);

    expect(selves).toHaveLength(1);
    expect(selves[0]?.rank).toBe(response.body.me.rank);
    expect(selves[0]?.score).toBe(response.body.me.score);
  });

  it('shows a private profile on the board by name, marked so the row is not opened', async () => {
    const response = await board(1, '?window=10').expect(200);
    const rows = response.body.rows as Array<{ displayName: string; isPublicProfile: boolean; userId: string }>;

    // Athlete 3 kept their profile private; athletes 2 and 4 did not.
    expect(rows.filter((r) => !r.isPublicProfile)).toHaveLength(1);
    expect(rows.filter((r) => r.isPublicProfile)).toHaveLength(ATHLETE_COUNT - 1);
    expect(rows.every((r) => typeof r.displayName === 'string' && r.displayName.length > 0)).toBe(true);
  });

  it('honours the window: three either side by default, and only the caller for zero', async () => {
    const byDefault = await board(3).expect(200);
    const alone = await board(3, '?window=0').expect(200);

    expect(byDefault.body.rows).toHaveLength(6); // the city is smaller than the seven-row window
    expect(alone.body.rows).toHaveLength(1);
    expect(alone.body.rows[0].isSelf).toBe(true);
  });

  it('rejects a window that is out of range, blank or not a number', async () => {
    for (const query of ['?window=11', '?window=-1', '?window=', '?window=abc', '?metric=crossfit', '?period=week']) {
      await board(1, query).expect(400);
    }
  });

  it('answers a metric with no score yet as coming soon, with no rows and no number', async () => {
    const response = await board(1, '?metric=strength').expect(200);

    expect(() => leaderboardResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body).toMatchObject({ status: 'coming_soon', metric: 'strength', rows: [], me: null });
  });

  it('answers an athlete who has not joined with a 200 and a designed state, never a 403', async () => {
    const response = await board(OUTSIDER).expect(200);

    expect(() => leaderboardResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body).toMatchObject({ status: 'not_opted_in', rows: [], me: null, city: null });
  });

  it('says an athlete with no workouts has nothing to rank yet', async () => {
    const response = await board(NO_SESSIONS).expect(200);

    expect(() => leaderboardResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body).toMatchObject({ status: 'no_eligible_sessions', rows: [], me: null });
  });

  it('never counts the outsider: their workout is stored but they are not on the board', async () => {
    const response = await board(1, '?window=10').expect(200);

    expect(response.body.cohortSize).toBe(ATHLETE_COUNT);
  });

  it('reads consent live: a withdrawal removes someone on the very next request, and a small city is withheld', async () => {
    // Athlete 2 withdraws. Five are left: still exactly enough.
    await setPrivacy(2, { leaderboardOptIn: false }).expect(200);
    const five = await board(1).expect(200);
    expect(five.body).toMatchObject({ status: 'ranked', cohortSize: 5 });
    expect(JSON.stringify(five.body)).not.toContain('Athlete 2');

    // Athlete 4 withdraws too. Four are left, which is too few to show anyone.
    await setPrivacy(4, { leaderboardOptIn: false }).expect(200);
    const four = await board(1).expect(200);
    expect(() => leaderboardResponseSchema.parse(four.body)).not.toThrow();
    expect(four.body).toMatchObject({ status: 'cohort_too_small', cohortSize: 4, rows: [], me: null });

    // Everyone withdrew from the board still sees a designed state for themselves.
    const withdrawn = await board(2).expect(200);
    expect(withdrawn.body.status).toBe('not_opted_in');
  });
});
