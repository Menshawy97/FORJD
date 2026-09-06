import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { progressStrengthResponseSchema } from '@forjd/contracts';
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

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-progress-owner-${suiteId}@example.com`;
const strangerEmail = `e2e-progress-stranger-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
const strangerExternalId = randomUUID();

/**
 * The Progress-Strength read API over real HTTP (Phase 4).
 *
 * The unit suites already cover each layer in isolation -- `progress.service.spec.ts` for the
 * policy, `progress.repository.spec.ts` against real Postgres for the SQL, including
 * cross-user isolation and the unticked-set exclusion directly at that layer. What only this
 * suite can prove is what lives between them and in the framework: that the route is not
 * captured by `@Get(":id")`, that an unknown time zone is a 400, and that a real upload
 * through the public `POST /workouts/sessions` endpoint is visible on this read a moment
 * later, exactly as a mobile client would experience it.
 */
describe('Progress (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const createdExerciseIds: string[] = [];
  const createdSessionIds: string[] = [];
  let exerciseId: string;

  const strength = (query = '', token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/workouts/sessions/progress/strength${query}`)
      .set('Authorization', `Bearer ${token}`);

  const upload = (body: unknown, token = 'owner-token') =>
    request(app.getHttpServer())
      .post('/api/v1/workouts/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: ownerEmail, externalId: ownerExternalId, tokens: ['owner-token'] },
            { email: strangerEmail, externalId: strangerExternalId, tokens: ['stranger-token'] },
          ],
          signIn: 'disabled',
        }),
      )
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: ownerEmail, password: 'Str0ngPass!' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: strangerEmail, password: 'Str0ngPass!' })
      .expect(201);

    const [exerciseRow] = await db
      .insert(exercises)
      .values({
        name: `${suiteId} Deadlift`,
        slug: `${suiteId}-deadlift`,
        category: 'strength',
        goal: 'strength',
        measure: 'weight',
      })
      .returning();
    if (!exerciseRow) throw new Error('exercise seed insert returned no row');
    exerciseId = exerciseRow.id;
    createdExerciseIds.push(exerciseId);
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    await db.delete(users).where(inArray(users.email, [ownerEmail, strangerEmail]));
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/workouts/sessions/progress/strength')
      .expect(401);
  });

  it("is not captured by ':id' -- 'progress' is never mistaken for a session id", async () => {
    const response = await strength().expect(200);
    expect(() => progressStrengthResponseSchema.parse(response.body)).not.toThrow();
  });

  it('rejects an unknown time zone with a 400, matching the stats endpoint', async () => {
    await strength('?timeZone=Not/AZone').expect(400);
  });

  it('defaults to UTC and returns the honest-empty shape for a brand new account', async () => {
    const response = await strength(undefined, 'stranger-token').expect(200);

    expect(response.body.personalRecords).toEqual([]);
    expect(response.body.insight).toBeNull();
  });

  it("reflects a session uploaded through the public API a moment later, and never leaks it to another account", async () => {
    const uploadResponse = await upload({
      id: randomUUID(),
      templateId: null,
      name: `${suiteId} Deadlift day`,
      activity: 'strength',
      status: 'completed',
      startedAt: '2026-08-19T09:00:00.000Z',
      endedAt: '2026-08-19T09:30:00.000Z',
      durationSeconds: 1800,
      perceivedEffort: 'solid',
      isLiveTracked: true,
      exercises: [
        {
          exerciseId,
          sets: [{ type: 'working', isCompleted: true, weightKg: 180, reps: 1 }],
        },
      ],
    }).expect(201);
    createdSessionIds.push(uploadResponse.body.id);

    const ownerResponse = await strength().expect(200);
    expect(ownerResponse.body.personalRecords).toHaveLength(1);
    expect(ownerResponse.body.personalRecords[0].weightKg).toBe(180);

    const strangerResponse = await strength(undefined, 'stranger-token').expect(200);
    expect(strangerResponse.body.personalRecords).toEqual([]);
  });
});
