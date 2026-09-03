import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  programEnrollmentResponseSchema,
  programListResponseSchema,
  programResponseSchema,
} from '@forjd/contracts';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { exercises } from '../src/database/schema/exercises.schema';
import { users } from '../src/database/schema/users.schema';
import {
  programEnrollments,
  programWorkouts,
  programs,
  workoutBlocks,
  workoutExercises,
  workoutTemplates,
} from '../src/database/schema/workouts.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-programs-owner-${suiteId}@example.com`;
const strangerEmail = `e2e-programs-stranger-${suiteId}@example.com`;
// Random per run, like every other e2e suite: a leftover row from an interrupted run can then
// never be silently reused.
const ownerExternalId = randomUUID();
const strangerExternalId = randomUUID();

/**
 * The programs read API over real HTTP.
 *
 * The unit suites already cover each layer in isolation -- `programs.service.spec.ts` at a 100%
 * threshold for the policy, `programs.repository.spec.ts` against real Postgres for the SQL. What
 * only this suite can prove is what lives *between* them and in the framework: that
 * `GET /programs/enrollment` is not swallowed by `GET /programs/:id`, that `?scope=` and
 * `?category=` survive the query pipe as strings, that an unknown scope is a 400 rather than a
 * silent full list, and that every response parses against the published contract.
 */
describe('Programs (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const createdProgramIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdExerciseIds: string[] = [];

  let presetId: string;
  let ownProgramId: string;
  let strangersProgramId: string;

  const list = (query = '', token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/programs${query}`)
      .set('Authorization', `Bearer ${token}`);

  const detail = (id: string, token = 'owner-token') =>
    request(app.getHttpServer())
      .get(`/api/v1/programs/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const enrollment = (token = 'owner-token') =>
    request(app.getHttpServer())
      .get('/api/v1/programs/enrollment')
      .set('Authorization', `Bearer ${token}`);

  /** Only rows this suite created -- the nine seeded presets are shared and must survive. */
  const ourItems = (body: { items: { slug: string }[] }) =>
    body.items.filter((item) => item.slug.startsWith(suiteId));

  const makeTemplate = async (name: string, exerciseIds: string[]): Promise<string> => {
    const [template] = await db
      .insert(workoutTemplates)
      .values({ ownerUserId: null, name: `${suiteId} ${name}`, activity: 'strength' })
      .returning();
    if (!template) throw new Error('template insert returned no row');
    createdTemplateIds.push(template.id);

    const [block] = await db
      .insert(workoutBlocks)
      .values({ templateId: template.id, type: 'straight_sets', orderIndex: 0 })
      .returning();
    if (!block) throw new Error('block insert returned no row');

    await db.insert(workoutExercises).values(
      exerciseIds.map((exerciseId, orderIndex) => ({
        blockId: block.id,
        exerciseId,
        orderIndex,
        setCount: 3,
      })),
    );
    return template.id;
  };

  const makeProgram = async (input: {
    slug: string;
    name: string;
    ownerUserId?: string | null;
    category?: string;
  }): Promise<string> => {
    const [row] = await db
      .insert(programs)
      .values({
        ownerUserId: input.ownerUserId ?? null,
        name: `${suiteId} ${input.name}`,
        slug: `${suiteId}-${input.slug}`,
        category: input.category ?? 'strength',
        level: 'intermediate',
        daysPerWeek: 3,
        durationWeeks: 8,
        description: 'A description',
      })
      .returning();
    if (!row) throw new Error('program insert returned no row');
    createdProgramIds.push(row.id);
    return row.id;
  };

  const userIdFor = async (email: string): Promise<string> => {
    const [row] = await db.select().from(users).where(inArray(users.email, [email]));
    if (!row) throw new Error(`no user row for ${email}`);
    return row.id;
  };

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

    const ownerId = await userIdFor(ownerEmail);
    const strangerId = await userIdFor(strangerEmail);

    const [benchRow] = await db
      .insert(exercises)
      .values({
        name: `${suiteId} Bench Press`,
        slug: `${suiteId}-bench-press`,
        category: 'strength',
        goal: 'strength',
        measure: 'weight',
      })
      .returning();
    if (!benchRow) throw new Error('exercise seed insert returned no row');
    createdExerciseIds.push(benchRow.id);

    const templateId = await makeTemplate('Upper Body A', [benchRow.id]);

    presetId = await makeProgram({ slug: 'preset', name: 'A Preset' });
    ownProgramId = await makeProgram({
      slug: 'own',
      name: 'B Mine',
      ownerUserId: ownerId,
      category: 'running',
    });
    strangersProgramId = await makeProgram({
      slug: 'strangers',
      name: 'C Theirs',
      ownerUserId: strangerId,
    });

    await db.insert(programWorkouts).values({
      programId: presetId,
      templateId,
      orderIndex: 0,
      dayOfWeek: null,
    });
  });

  afterAll(async () => {
    // Programs first: `program_workouts` cascades from them, and `template_id` is `restrict`, so
    // the join rows must be gone before a template can be removed.
    if (createdProgramIds.length > 0) {
      await db.delete(programs).where(inArray(programs.id, createdProgramIds));
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

  describe('GET /programs', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/programs').expect(401);
    });

    it('returns a body that parses against the published contract', async () => {
      const response = await list().expect(200);
      expect(() => programListResponseSchema.parse(response.body)).not.toThrow();
    });

    /**
     * The catalogue screen sends no `scope` at all. Its own call must never show a program the
     * athlete built -- which is what the schema's `preset` default is for, exercised here through
     * the real query pipe rather than by calling the schema directly.
     */
    it('defaults to presets only, so the catalogue can never show a custom program', async () => {
      const response = await list().expect(200);
      const slugs = ourItems(response.body).map((item) => item.slug);

      expect(slugs).toContain(`${suiteId}-preset`);
      expect(slugs).not.toContain(`${suiteId}-own`);
      expect(slugs).not.toContain(`${suiteId}-strangers`);
    });

    it('returns only the caller own programs under scope=mine', async () => {
      const response = await list('?scope=mine').expect(200);
      expect(ourItems(response.body).map((item) => item.slug)).toEqual([`${suiteId}-own`]);
    });

    it('never returns a stranger program, even under scope=all', async () => {
      const response = await list('?scope=all').expect(200);
      const slugs = ourItems(response.body).map((item) => item.slug);

      expect(slugs).toContain(`${suiteId}-preset`);
      expect(slugs).toContain(`${suiteId}-own`);
      expect(slugs).not.toContain(`${suiteId}-strangers`);
    });

    /** A query string is all strings; the enum has to survive that, and an unknown one must 400. */
    it('filters by category and rejects a category that is not in the vocabulary', async () => {
      const response = await list('?scope=all&category=running').expect(200);
      expect(ourItems(response.body).map((item) => item.slug)).toEqual([`${suiteId}-own`]);

      await list('?category=yoga').expect(400);
    });

    /**
     * A bad scope is a client bug and is told so. Falling back to the default would quietly hand
     * a screen a different list than it asked for.
     */
    it('rejects an unknown scope rather than silently defaulting', async () => {
      await list('?scope=everyone').expect(400);
    });

    it('marks a preset as not the caller own and a custom program as theirs', async () => {
      const response = await list('?scope=all').expect(200);
      const items = ourItems(response.body) as { slug: string; isOwn: boolean }[];

      expect(items.find((item) => item.slug === `${suiteId}-preset`)?.isOwn).toBe(false);
      expect(items.find((item) => item.slug === `${suiteId}-own`)?.isOwn).toBe(true);
    });
  });

  describe('GET /programs/enrollment', () => {
    /**
     * The route-ordering trap this phase's plan calls out by name. `@Get("enrollment")` is
     * declared above `@Get(":id")`; the other way round, Nest would treat "enrollment" as a
     * program id and this would 404. Only an over-the-wire test can catch that -- the service
     * knows nothing about route order.
     */
    it('is not swallowed by the :id route -- "enrollment" is not treated as a program id', async () => {
      const response = await enrollment().expect(200);

      expect(response.body).toHaveProperty('enrollment');
      expect(response.body).not.toHaveProperty('id');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/programs/enrollment').expect(401);
    });

    it('returns an explicit null with a 200 when the athlete follows nothing', async () => {
      const response = await enrollment().expect(200);

      expect(() => programEnrollmentResponseSchema.parse(response.body)).not.toThrow();
      expect(response.body.enrollment).toBeNull();
    });

    it('returns the active enrolment with the version it began under', async () => {
      const strangerId = await userIdFor(strangerEmail);
      await db.insert(programEnrollments).values({
        userId: strangerId,
        programId: presetId,
        programVersion: 7,
      });

      const response = await enrollment('stranger-token').expect(200);

      expect(() => programEnrollmentResponseSchema.parse(response.body)).not.toThrow();
      expect(response.body.enrollment.programId).toBe(presetId);
      expect(response.body.enrollment.programVersion).toBe(7);
      // The other athlete is unaffected -- an enrolment is per user, not per program.
      expect((await enrollment().expect(200)).body.enrollment).toBeNull();
    });
  });

  describe('GET /programs/:id', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(`/api/v1/programs/${presetId}`).expect(401);
    });

    it('returns a body that parses against the published contract', async () => {
      const response = await detail(presetId).expect(200);
      expect(() => programResponseSchema.parse(response.body)).not.toThrow();
    });

    it('carries the workouts with their template ids and exercise names', async () => {
      const response = await detail(presetId).expect(200);

      expect(response.body.workouts).toHaveLength(1);
      expect(response.body.workouts[0].name).toBe(`${suiteId} Upper Body A`);
      expect(response.body.workouts[0].exerciseNames).toEqual([`${suiteId} Bench Press`]);
      expect(response.body.workouts[0].dayOfWeek).toBeNull();
    });

    it('lets an athlete read their own program', async () => {
      const response = await detail(ownProgramId).expect(200);
      expect(response.body.isOwn).toBe(true);
    });

    /**
     * 404, never 403, and the same 404 for all three: a probe must not be able to tell "does not
     * exist" from "exists and belongs to someone else".
     */
    it('404s alike for a stranger program, an unknown id, and a malformed one', async () => {
      await detail(strangersProgramId).expect(404);
      await detail(randomUUID()).expect(404);
      await detail('not-a-uuid').expect(404);
    });
  });
});
