import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { exerciseCatalogueResponseSchema, exerciseListResponseSchema, exerciseResponseSchema } from '@forjd/contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { exerciseFavourites, exercises } from '../src/database/schema/exercises.schema';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-exercises-owner-${suiteId}@example.com`;
const strangerEmail = `e2e-exercises-stranger-${suiteId}@example.com`;

/**
 * The library read path over real HTTP.
 *
 * The unit suites already cover every branch in isolation -- `exercises.service.spec.ts` at a
 * 100% threshold for the policy, `exercises.repository.spec.ts` against real Postgres for the
 * SQL. What only this suite can prove is that the pieces are wired together: that the query
 * string actually reaches a Zod schema (this is the codebase's first `@Query` validation, so
 * nothing before it established that `z.coerce` behaves through Nest's pipe), that the guard
 * is on the route, and that what comes back over the wire parses against the published
 * contract rather than merely resembling it.
 */
describe('Exercise library (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  /** Unique per run, so assertions see only this suite's rows even against a loaded catalogue. */
  const marker = `zqe${suiteId.replace(/[^a-z0-9]/gi, '')}`;
  const createdExerciseIds: string[] = [];
  let ownerId: string;
  let alphaId: string;
  let ownExerciseId: string;
  let strangersExerciseId: string;

  const list = (query: string, token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/exercises${query}`)
      .set('Authorization', `Bearer ${token}`);

  const detail = (id: string, token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/exercises/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const seed = async (values: {
    name: string;
    ownerUserId?: string;
    category?: string;
    equipment?: string[];
    primaryMuscles?: string[];
    imageKeys?: string[];
  }): Promise<string> => {
    const [row] = await db
      .insert(exercises)
      .values({
        ownerUserId: values.ownerUserId ?? null,
        name: `${marker} ${values.name}`,
        slug: `${marker}-${values.name.toLowerCase().replace(/ /g, '-')}`,
        category: values.category ?? 'strength',
        goal: 'hypertrophy',
        measure: 'weight',
        primaryMuscles: values.primaryMuscles ?? ['chest'],
        secondaryMuscles: ['triceps'],
        equipment: values.equipment ?? ['barbell'],
        force: 'push',
        level: 'beginner',
        mechanic: 'compound',
        instructions: ['Lie on the bench.'],
        imageKeys: values.imageKeys ?? [],
        description: null,
        source: values.ownerUserId ? null : 'e2e',
        sourceId: values.ownerUserId ? null : `${marker}-${values.name}`,
      })
      .returning();

    if (!row) {
      throw new Error('seed insert returned no row');
    }
    createdExerciseIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            {
              email: ownerEmail,
              externalId: '66666666-6666-4666-8666-666666666666',
              tokens: ['owner-token'],
            },
            {
              email: strangerEmail,
              externalId: '77777777-7777-4777-8777-777777777777',
              tokens: ['stranger-token'],
            },
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

    const owner = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: ownerEmail, password: 'Str0ngPass!' })
      .expect(201);
    ownerId = owner.body.userId;

    const stranger = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: strangerEmail, password: 'Str0ngPass!' })
      .expect(201);

    alphaId = await seed({ name: 'Alpha', imageKeys: ['Test_Exercise/0.jpg'] });
    await seed({ name: 'Bravo', category: 'mobility', equipment: ['kettlebell'] });
    await seed({ name: 'Charlie', primaryMuscles: ['glutes'] });
    ownExerciseId = await seed({ name: 'Delta Own', ownerUserId: ownerId });
    strangersExerciseId = await seed({ name: 'Echo Private', ownerUserId: stranger.body.userId });
  });

  afterAll(async () => {
    if (createdExerciseIds.length > 0) {
      await db
        .delete(exerciseFavourites)
        .where(inArray(exerciseFavourites.exerciseId, createdExerciseIds));
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    await db.delete(users).where(inArray(users.email, [ownerEmail, strangerEmail]));
    await app.close();
  });

  describe('GET /exercises', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/exercises').expect(401);
    });

    it('returns a body that parses against the published contract', async () => {
      const response = await list(`?q=${marker}`).expect(200);

      expect(() => exerciseListResponseSchema.parse(response.body)).not.toThrow();
    });

    it('returns the catalogue plus the caller own exercises, ordered by name', async () => {
      const response = await list(`?q=${marker}`).expect(200);

      expect(response.body.items.map((item: { name: string }) => item.name)).toEqual([
        `${marker} Alpha`,
        `${marker} Bravo`,
        `${marker} Charlie`,
        `${marker} Delta Own`,
      ]);
    });

    it('never includes another user custom exercise', async () => {
      const response = await list(`?q=${marker}`).expect(200);

      expect(response.body.items.map((item: { id: string }) => item.id)).not.toContain(
        strangersExerciseId,
      );
    });

    it('filters by category', async () => {
      const response = await list(`?q=${marker}&category=mobility`).expect(200);

      expect(response.body.items.map((item: { name: string }) => item.name)).toEqual([
        `${marker} Bravo`,
      ]);
    });

    it('filters by equipment and muscle', async () => {
      const byEquipment = await list(`?q=${marker}&equipment=kettlebell`).expect(200);
      const byMuscle = await list(`?q=${marker}&muscle=glutes`).expect(200);

      expect(byEquipment.body.items).toHaveLength(1);
      expect(byMuscle.body.items.map((item: { name: string }) => item.name)).toEqual([
        `${marker} Charlie`,
      ]);
    });

    /**
     * The whole reason `favourite` is a spelled-out enum rather than `z.coerce.boolean()`.
     * Over real HTTP, `?favourite=false` must not narrow the list.
     */
    it('treats favourite=false as no filter', async () => {
      const response = await list(`?q=${marker}&favourite=false`).expect(200);

      expect(response.body.items).toHaveLength(4);
    });

    it('narrows to favourites when asked', async () => {
      await db.insert(exerciseFavourites).values({ userId: ownerId, exerciseId: alphaId });

      const response = await list(`?q=${marker}&favourite=true`).expect(200);

      expect(response.body.items.map((item: { name: string }) => item.name)).toEqual([
        `${marker} Alpha`,
      ]);
      expect(response.body.items[0].isFavourite).toBe(true);
    });

    it('rejects a filter value outside the vocabulary', async () => {
      await list('?category=stretching').expect(400);
    });

    it('rejects a limit above the maximum', async () => {
      await list('?limit=101').expect(400);
    });

    /** `limit` arrives as a string; without `z.coerce` this would be a 400 on every request. */
    it('coerces a numeric limit out of the query string', async () => {
      const response = await list(`?q=${marker}&limit=2`).expect(200);

      expect(response.body.items).toHaveLength(2);
    });

    it('pages through the whole result set with the cursor it returns', async () => {
      const first = await list(`?q=${marker}&limit=2`).expect(200);
      expect(first.body.nextCursor).not.toBeNull();

      const second = await list(
        `?q=${marker}&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      ).expect(200);

      const seen = [...first.body.items, ...second.body.items].map(
        (item: { name: string }) => item.name,
      );
      expect(seen).toEqual([
        `${marker} Alpha`,
        `${marker} Bravo`,
        `${marker} Charlie`,
        `${marker} Delta Own`,
      ]);
      expect(second.body.nextCursor).toBeNull();
    });

    it('rejects a cursor the server did not mint', async () => {
      await list(`?q=${marker}&cursor=tampered`).expect(400);
    });

    it('returns an empty envelope rather than a 404 when nothing matches', async () => {
      const response = await list(`?q=${marker}zzzznope`).expect(200);

      expect(response.body).toEqual({ items: [], nextCursor: null });
    });
  });

  describe('GET /exercises/catalogue', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/exercises/catalogue').expect(401);
    });

    it('returns a body that parses against the published contract', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      expect(() => exerciseCatalogueResponseSchema.parse(response.body)).not.toThrow();
    });

    it('includes the caller own custom exercise and never a strangers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      const ids = response.body.exercises.map((item: { id: string }) => item.id);
      expect(ids).toContain(ownExerciseId);
      expect(ids).not.toContain(strangersExerciseId);
    });

    it('is not swallowed by the :id route -- "catalogue" is not treated as an exercise id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      expect(response.body).toHaveProperty('catalogueVersion');
      expect(response.body).not.toHaveProperty('id');
    });

    it('returns the same version on two consecutive calls with nothing changed in between', async () => {
      const first = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);
      const second = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      expect(first.body.catalogueVersion).toBe(second.body.catalogueVersion);
    });

    it('changes the version after a new custom exercise is created', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      const created = await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({
          name: `${marker} Catalogue Sync Test`,
          category: 'strength',
          measure: 'weight',
          primaryMuscles: ['core'],
          equipment: ['bodyweight'],
        })
        .expect(201);
      createdExerciseIds.push(created.body.id);

      const after = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      expect(after.body.catalogueVersion).not.toBe(before.body.catalogueVersion);
    });

    /** Favouriting is a higher-frequency change than the catalogue is expected to invalidate on. */
    it('does not change the version when only a favourite toggles', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);

      const after = await request(app.getHttpServer())
        .get('/api/v1/exercises/catalogue')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      expect(after.body.catalogueVersion).toBe(before.body.catalogueVersion);

      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);
    });
  });

  describe('GET /exercises/:id', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(`/api/v1/exercises/${alphaId}`).expect(401);
    });

    it('returns a body that parses against the published contract', async () => {
      const response = await detail(alphaId).expect(200);

      expect(() => exerciseResponseSchema.parse(response.body)).not.toThrow();
    });

    /** ADR-018: the storage key stays server-side, so the swap to licensed media stays cheap. */
    it('never puts a storage key on the wire', async () => {
      const response = await detail(alphaId).expect(200);

      expect(response.body).not.toHaveProperty('imageKeys');
      expect(JSON.stringify(response.body)).not.toContain('Test_Exercise/0.jpg');
    });

    it('answers 404 for an unknown id', async () => {
      await detail('55555555-5555-4555-8555-555555555555').expect(404);
    });

    it('answers 404 rather than 500 for a malformed id', async () => {
      await detail('not-a-uuid').expect(404);
    });

    /**
     * The property the endpoint exists to guarantee: probing ids must not tell you which of
     * them name a real exercise somebody else authored.
     */
    it('is indistinguishable between an unknown exercise and someone elses', async () => {
      const unknown = await detail('55555555-5555-4555-8555-555555555555').expect(404);
      const someoneElses = await detail(strangersExerciseId).expect(404);

      expect(unknown.body).toEqual(someoneElses.body);
    });

    it('returns the caller own custom exercise to its owner', async () => {
      const response = await detail(ownExerciseId).expect(200);

      expect(response.body.isCustom).toBe(true);
    });

    it('does not report an exercise as custom for a user who does not own it', async () => {
      const [row] = await db.select().from(exercises).where(eq(exercises.id, alphaId));

      expect(row?.ownerUserId).toBeNull();
      expect((await detail(alphaId).expect(200)).body.isCustom).toBe(false);
    });
  });

  describe('POST /exercises', () => {
    const validBody = {
      name: `${marker} Landmine Press`,
      category: 'strength',
      measure: 'weight',
      primaryMuscles: ['shoulders'],
      equipment: ['barbell'],
      description: 'Brace the core.',
    };

    it('requires authentication', async () => {
      await request(app.getHttpServer()).post('/api/v1/exercises').send(validBody).expect(401);
    });

    it('creates the exercise and returns a body that parses against the published contract', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send(validBody)
        .expect(201);
      createdExerciseIds.push(response.body.id);

      expect(() => exerciseResponseSchema.parse(response.body)).not.toThrow();
      expect(response.body.isCustom).toBe(true);
      expect(response.body.isFavourite).toBe(false);
    });

    /** "goal is derived, not chosen" — docs/design/phase2-screen-specs.md §6.1. */
    it('derives goal from measure server-side, ignoring any goal sent by the client', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({ ...validBody, name: `${marker} Derived Goal`, goal: 'power' })
        .expect(201);
      createdExerciseIds.push(response.body.id);

      expect(response.body.goal).toBe('hypertrophy');
    });

    it('rejects a blank name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({ ...validBody, name: '   ' })
        .expect(400);
    });

    it('rejects an empty primaryMuscles array', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({ ...validBody, primaryMuscles: [] })
        .expect(400);
    });

    /** The partial unique index (`owner_user_id, lower(name)`), reached through the API. */
    it('rejects a duplicate name for the same owner', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({ ...validBody, name: `${marker} Duplicate Me` })
        .expect(201);
      createdExerciseIds.push(first.body.id);

      await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({ ...validBody, name: `${marker} Duplicate Me` })
        .expect(409);
    });
  });

  describe('PATCH /exercises/:id', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/exercises/${ownExerciseId}`)
        .send({ name: 'New Name' })
        .expect(401);
    });

    it('updates the owner own exercise and returns the updated body', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/exercises/${ownExerciseId}`)
        .set('Authorization', 'Bearer owner-token')
        .send({ name: `${marker} Delta Own Renamed` })
        .expect(200);

      expect(response.body.name).toBe(`${marker} Delta Own Renamed`);
    });

    it('answers 404 rather than 403 for someone elses exercise', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/exercises/${strangersExerciseId}`)
        .set('Authorization', 'Bearer owner-token')
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('answers 404 for a catalogue exercise, which has no owner to match', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/exercises/${alphaId}`)
        .set('Authorization', 'Bearer owner-token')
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('answers 404 for a malformed id', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/exercises/not-a-uuid')
        .set('Authorization', 'Bearer owner-token')
        .send({ name: 'x' })
        .expect(404);
    });
  });

  describe('DELETE /exercises/:id', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${strangersExerciseId}`)
        .expect(401);
    });

    it('answers 404 rather than 403 for someone elses exercise', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${strangersExerciseId}`)
        .set('Authorization', 'Bearer owner-token')
        .expect(404);
    });

    it('soft-deletes the owner own exercise and 404s a second time', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/exercises')
        .set('Authorization', 'Bearer owner-token')
        .send({
          name: `${marker} To Delete`,
          category: 'strength',
          measure: 'weight',
          primaryMuscles: ['core'],
          equipment: ['bodyweight'],
        })
        .expect(201);
      createdExerciseIds.push(created.body.id);

      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${created.body.id}`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);

      await detail(created.body.id).expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${created.body.id}`)
        .set('Authorization', 'Bearer owner-token')
        .expect(404);
    });
  });

  describe('PUT/DELETE /exercises/:id/favourite', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/exercises/${alphaId}/favourite`)
        .expect(401);
    });

    it('stars a visible exercise and it shows as favourited afterwards', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);

      expect((await detail(alphaId).expect(200)).body.isFavourite).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);

      expect((await detail(alphaId).expect(200)).body.isFavourite).toBe(false);
    });

    it('is idempotent -- starring twice does not error', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);
      await request(app.getHttpServer())
        .put(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/api/v1/exercises/${alphaId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(204);
    });

    it('answers 404 rather than a raw foreign-key failure for an unknown exercise', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/exercises/55555555-5555-4555-8555-555555555555/favourite')
        .set('Authorization', 'Bearer owner-token')
        .expect(404);
    });

    it('answers 404 for someone elses private exercise, not just a visibility error', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/exercises/${strangersExerciseId}/favourite`)
        .set('Authorization', 'Bearer owner-token')
        .expect(404);
    });
  });
});
