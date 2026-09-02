import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  createWorkoutTemplateRequestSchema,
  workoutTemplateListResponseSchema,
  workoutTemplateResponseSchema,
} from '@forjd/contracts';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { exercises } from '../src/database/schema/exercises.schema';
import { users } from '../src/database/schema/users.schema';
import { workoutTemplates } from '../src/database/schema/workouts.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-workouts-owner-${suiteId}@example.com`;
const strangerEmail = `e2e-workouts-stranger-${suiteId}@example.com`;
// Random per run, unlike some older e2e suites' hardcoded externalIds -- a leftover row from
// a prior interrupted run can then never be silently reused by this suite's registration.
const ownerExternalId = randomUUID();
const strangerExternalId = randomUUID();

/**
 * The templates CRUD path over real HTTP.
 *
 * The unit suites already cover every branch in isolation -- `workouts.service.spec.ts` at a
 * 100% threshold for the policy, `workouts.repository.spec.ts` against real Postgres for the
 * SQL. What only this suite can prove is that the pieces are wired together end to end: the
 * guard is on the route, the body actually reaches `createWorkoutTemplateRequestSchema`, and
 * -- the one thing no unit suite can show -- that a stranger genuinely cannot read or mutate
 * another user's template over the real HTTP surface.
 */
describe('Workout templates (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const createdExerciseIds: string[] = [];
  const createdTemplateIds: string[] = [];
  let exerciseId: string;

  const create = (body: object, token = 'owner-token') =>
    request(app.getHttpServer())
      .post('/api/v1/workouts/templates')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const get = (id: string, token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/workouts/templates/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const list = (token = 'owner-token') =>
    request(app.getHttpServer())
      .get('/api/v1/workouts/templates')
      .set('Authorization', `Bearer ${token}`);

  const patch = (id: string, body: object, token = 'owner-token') =>
    request(app.getHttpServer())
      .patch(`/api/v1/workouts/templates/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const del = (id: string, token = 'owner-token') =>
    request(app.getHttpServer())
      .delete(`/api/v1/workouts/templates/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const validBody = () => ({
    name: `${suiteId} Upper Push`,
    activity: 'strength',
    blocks: [
      {
        type: 'straight_sets',
        exercises: [{ exerciseId, setCount: 4, targetReps: 8, targetWeightKg: 80 }],
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
  });

  afterAll(async () => {
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
    await request(app.getHttpServer()).get('/api/v1/workouts/templates').expect(401);
  });

  it('creates a template that parses against the published response contract', async () => {
    const response = await create(validBody()).expect(201);
    createdTemplateIds.push(response.body.id);

    expect(() => workoutTemplateResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body.blocks[0].exercises[0].exerciseId).toBe(exerciseId);
    expect(response.body.isCustom).toBe(true);
  });

  it('rejects a create body with an unknown block type before it reaches the service', async () => {
    const body = { ...validBody(), blocks: [{ ...validBody().blocks[0], type: 'circuit' }] };
    expect(() => createWorkoutTemplateRequestSchema.parse(body)).toThrow();

    await create(body).expect(400);
  });

  it('rejects a create body referencing an exercise the caller cannot see', async () => {
    const response = await create({
      ...validBody(),
      blocks: [{ type: 'straight_sets', exercises: [{ exerciseId: randomUUID() }] }],
    });

    expect(response.status).toBe(400);
  });

  it('gets a created template by id and it parses against the response contract', async () => {
    const created = await create(validBody()).expect(201);
    createdTemplateIds.push(created.body.id);

    const response = await get(created.body.id).expect(200);

    expect(() => workoutTemplateResponseSchema.parse(response.body)).not.toThrow();
  });

  it('lists templates in an envelope that parses against the response contract', async () => {
    const created = await create(validBody()).expect(201);
    createdTemplateIds.push(created.body.id);

    const response = await list().expect(200);

    expect(() => workoutTemplateListResponseSchema.parse(response.body)).not.toThrow();
    expect(response.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(
      true,
    );
  });

  it('updates a template and reflects the change on the next read', async () => {
    const created = await create(validBody()).expect(201);
    createdTemplateIds.push(created.body.id);

    await patch(created.body.id, { name: 'Renamed by e2e' }).expect(200);

    const response = await get(created.body.id).expect(200);
    expect(response.body.name).toBe('Renamed by e2e');
  });

  it('deletes a template, after which it 404s', async () => {
    const created = await create(validBody()).expect(201);
    // Soft delete only -- the row (and its blocks/exercises, restrict-FK'd to the shared test
    // exercise) still physically exists afterwards, so it still needs the same hard-delete
    // cleanup in afterAll as every other template this suite creates.
    createdTemplateIds.push(created.body.id);

    await del(created.body.id).expect(204);
    await get(created.body.id).expect(404);
  });

  describe('cross-user isolation', () => {
    it("404s, never 403s, when a stranger reads another user's template", async () => {
      const created = await create(validBody()).expect(201);
      createdTemplateIds.push(created.body.id);

      await get(created.body.id, 'stranger-token').expect(404);
    });

    it("404s when a stranger updates another user's template, and the original is unchanged", async () => {
      const created = await create(validBody()).expect(201);
      createdTemplateIds.push(created.body.id);

      await patch(created.body.id, { name: 'Hijacked' }, 'stranger-token').expect(404);

      const response = await get(created.body.id).expect(200);
      expect(response.body.name).toBe(validBody().name);
    });

    it("404s when a stranger deletes another user's template, and it still exists", async () => {
      const created = await create(validBody()).expect(201);
      createdTemplateIds.push(created.body.id);

      await del(created.body.id, 'stranger-token').expect(404);

      await get(created.body.id).expect(200);
    });

    it("never includes another user's template in the stranger's own list", async () => {
      const created = await create(validBody()).expect(201);
      createdTemplateIds.push(created.body.id);

      const response = await list('stranger-token').expect(200);

      expect(
        response.body.items.some((item: { id: string }) => item.id === created.body.id),
      ).toBe(false);
    });
  });
});
