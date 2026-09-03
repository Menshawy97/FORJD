import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  workoutSessionListResponseSchema,
  workoutSessionResponseSchema,
  workoutSessionUploadRequestSchema,
  workoutStatsResponseSchema,
} from '@forjd/contracts';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { exercises } from '../src/database/schema/exercises.schema';
import { users } from '../src/database/schema/users.schema';
import { workoutSessions, workoutTemplates } from '../src/database/schema/workouts.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-worksessions-owner-${suiteId}@example.com`;
const strangerEmail = `e2e-worksessions-stranger-${suiteId}@example.com`;
// Random per run -- see workouts.e2e-spec.ts's own comment on why this is not a hardcoded
// constant: a leftover row from a prior interrupted run can then never be silently reused.
const ownerExternalId = randomUUID();
const strangerExternalId = randomUUID();

/**
 * The session upload path over real HTTP.
 *
 * The unit suites already cover every branch in isolation --
 * `workout-sessions.service.spec.ts` at a 100% threshold for the policy,
 * `workouts.repository.spec.ts` against real Postgres for the SQL, including idempotency at
 * the repository layer directly. What only this suite can prove is the same guarantee
 * end to end: a client that retries an upload after a dropped response, over the real HTTP
 * surface, still produces exactly one row -- and that a session's own values, not its
 * template's, are what a read returns.
 */
describe('Workout sessions (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const createdExerciseIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdSessionIds: string[] = [];
  let exerciseId: string;
  let templateId: string;

  const upload = (body: unknown, token = 'owner-token') =>
    request(app.getHttpServer())
      .post('/api/v1/workouts/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  const get = (id: string, token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/workouts/sessions/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const list = (token = 'owner-token') =>
    request(app.getHttpServer())
      .get('/api/v1/workouts/sessions')
      .set('Authorization', `Bearer ${token}`);

  const stats = (token = 'owner-token') =>
    request(app.getHttpServer())
      .get('/api/v1/workouts/sessions/stats')
      .set('Authorization', `Bearer ${token}`);

  const validBody = () => ({
    id: randomUUID(),
    templateId,
    name: `${suiteId} Upper Push`,
    activity: 'strength',
    status: 'completed',
    startedAt: '2026-09-02T09:00:00.000Z',
    endedAt: '2026-09-02T09:30:00.000Z',
    durationSeconds: 1800,
    perceivedEffort: 'solid',
    isLiveTracked: true,
    exercises: [
      {
        exerciseId,
        sets: [{ type: 'working', isCompleted: true, weightKg: 95, reps: 6 }],
      },
    ],
  });

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
        name: `${suiteId} Bench Press`,
        slug: `${suiteId}-bench-press`,
        category: 'strength',
        goal: 'strength',
        measure: 'weight',
      })
      .returning();
    if (!exerciseRow) throw new Error('exercise seed insert returned no row');
    exerciseId = exerciseRow.id;
    createdExerciseIds.push(exerciseId);

    // Prescribes 100kg -- the session below performs 95kg, which is the point of the
    // "never back-filled from its template" assertion.
    const [templateRow] = await db
      .insert(workoutTemplates)
      .values({ name: `${suiteId} Upper Push Template`, activity: 'strength' })
      .returning();
    if (!templateRow) throw new Error('template seed insert returned no row');
    templateId = templateRow.id;
    createdTemplateIds.push(templateId);
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    if (createdTemplateIds.length > 0) {
      await db.delete(workoutTemplates).where(inArray(workoutTemplates.id, createdTemplateIds));
    }
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    await db.delete(users).where(inArray(users.email, [ownerEmail, strangerEmail]));
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/v1/workouts/sessions').expect(401);
  });

  it('uploads a session that parses against the published response contract', async () => {
    const body = validBody();
    expect(() => workoutSessionUploadRequestSchema.parse(body)).not.toThrow();

    const response = await upload(body).expect(201);
    createdSessionIds.push(response.body.id);

    expect(() => workoutSessionResponseSchema.parse(response.body)).not.toThrow();
  });

  it("stores the session's own performed values, never the template's prescription", async () => {
    const body = validBody();
    const response = await upload(body).expect(201);
    createdSessionIds.push(response.body.id);

    // The template prescribes 100kg; the session performed 95kg.
    expect(response.body.exercises[0].sets[0].weightKg).toBe(95);
    expect(response.body.templateId).toBe(templateId);
  });

  it('rejects an upload referencing an exercise the caller cannot see', async () => {
    const response = await upload({
      ...validBody(),
      exercises: [{ exerciseId: randomUUID(), sets: [{ type: 'working', isCompleted: true }] }],
    });

    expect(response.status).toBe(400);
  });

  it('rejects an upload whose templateId the caller cannot see', async () => {
    const response = await upload({ ...validBody(), templateId: randomUUID() });

    expect(response.status).toBe(400);
  });

  it('is idempotent over real HTTP: a retried upload with the same id produces exactly one row', async () => {
    const body = validBody();

    const first = await upload(body).expect(201);
    createdSessionIds.push(first.body.id);

    // A genuine retry sends a different payload than what actually happened, because the
    // client does not know whether its first request landed -- the server must return the
    // original, not re-describe the session from this second call's own body.
    const retried = await upload({ ...body, name: 'Hijacked Retry', durationSeconds: 1 }).expect(
      201,
    );

    expect(retried.body.id).toBe(first.body.id);
    expect(retried.body.name).toBe(body.name);
    expect(retried.body.durationSeconds).toBe(1800);

    const rows = await db.select().from(workoutSessions).where(inArray(workoutSessions.id, [body.id]));
    expect(rows).toHaveLength(1);
  });

  it('gets an uploaded session by id and it parses against the response contract', async () => {
    const created = await upload(validBody()).expect(201);
    createdSessionIds.push(created.body.id);

    const response = await get(created.body.id).expect(200);

    expect(() => workoutSessionResponseSchema.parse(response.body)).not.toThrow();
  });

  it('lists sessions in an envelope that parses against the response contract', async () => {
    const created = await upload(validBody()).expect(201);
    createdSessionIds.push(created.body.id);

    const response = await list().expect(200);

    expect(() => workoutSessionListResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(
      true,
    );
  });

  /**
   * Phase 3J-c. The aggregates themselves are proven against real Postgres in
   * `workouts.repository.spec.ts`; what only a real HTTP request can prove is the routing and
   * the query validation below, either of which would ship a dead endpoint with a green unit
   * suite.
   */
  describe('GET /workouts/sessions/stats', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/v1/workouts/sessions/stats').expect(401);
    });

    /*
     * The route-ordering trap. Nest matches in declaration order, so if `@Get("stats")` ever
     * moves below `@Get(":id")`, this path binds to `getById` with `id: "stats"`, fails its
     * UUID guard and 404s -- on every Home request, with nothing in either method looking
     * wrong. A 200 here is the assertion that the ordering is still right.
     */
    it('is routed to the stats handler, not matched as a session id', async () => {
      const response = await stats().expect(200);

      expect(() => workoutStatsResponseSchema.parse(response.body)).not.toThrow();
    });

    it('counts an uploaded session and parses against the published contract', async () => {
      const created = await upload(validBody()).expect(201);
      createdSessionIds.push(created.body.id);

      const response = await stats().expect(200);

      expect(() => workoutStatsResponseSchema.parse(response.body)).not.toThrow();
      expect(response.body.totalSessions).toBeGreaterThan(0);
    });

    // The zone reaches a `date_trunc(... at time zone $1)`, and Postgres raises on a name it
    // does not know -- so without validation at the boundary a typo is a 500, not a 400.
    it('rejects an unknown time zone at the boundary rather than letting Postgres raise', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/workouts/sessions/stats')
        .query({ timeZone: 'Mars/Olympus_Mons' })
        .set('Authorization', 'Bearer owner-token');

      expect(response.status).toBe(400);
    });

    it('accepts a real zone', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/workouts/sessions/stats')
        .query({ timeZone: 'Africa/Cairo' })
        .set('Authorization', 'Bearer owner-token')
        .expect(200);
    });

    it("never counts another user's sessions", async () => {
      const created = await upload(validBody()).expect(201);
      createdSessionIds.push(created.body.id);

      const response = await stats('stranger-token').expect(200);

      expect(response.body.totalSessions).toBe(0);
      expect(response.body.recentPersonalRecord).toBeNull();
    });
  });

  describe('cross-user isolation', () => {
    it("404s, never 403s, when a stranger reads another user's session", async () => {
      const created = await upload(validBody()).expect(201);
      createdSessionIds.push(created.body.id);

      await get(created.body.id, 'stranger-token').expect(404);
    });

    it("never includes another user's session in the stranger's own list", async () => {
      const created = await upload(validBody()).expect(201);
      createdSessionIds.push(created.body.id);

      const response = await list('stranger-token').expect(200);

      expect(
        response.body.items.some((item: { id: string }) => item.id === created.body.id),
      ).toBe(false);
    });

    it('rejects an id collision with a session belonging to a different user', async () => {
      const created = await upload(validBody()).expect(201);
      createdSessionIds.push(created.body.id);

      const response = await upload({ ...validBody(), id: created.body.id }, 'stranger-token');

      expect(response.status).toBe(409);
    });
  });
});
