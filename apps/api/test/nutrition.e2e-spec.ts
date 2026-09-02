import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  foodListResponseSchema,
  foodResponseSchema,
  macroGoalsResponseSchema,
  nutritionLogEntryResponseSchema,
  nutritionLogListResponseSchema,
  savedMealResponseSchema,
} from '@forjd/contracts';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { foods } from '../src/database/schema/nutrition.schema';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-nutrition-owner-${suiteId}@example.com`;
const strangerEmail = `e2e-nutrition-stranger-${suiteId}@example.com`;

/**
 * The nutrition vertical's golden path over real HTTP (Phase E). Unit suites already cover the
 * policy in isolation (`nutrition.service.spec.ts`) and the SQL against real Postgres
 * (`nutrition.repository.spec.ts`); this suite proves the wiring -- guard, Zod pipes, and that a
 * real response parses against the published contract -- plus the two properties that only
 * matter once search and logging are reachable over the wire: cross-user data isolation, and
 * that a client cannot supply its own macro values for a log entry.
 */
describe('Nutrition (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const marker = `zqn${suiteId.replace(/[^a-z0-9]/gi, '')}`;
  const createdFoodIds: string[] = [];
  let catalogueFoodId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: ownerEmail, externalId: '77777777-7777-4777-8777-777777777777', tokens: ['owner-token'] },
            { email: strangerEmail, externalId: '88888888-8888-4888-8888-888888888888', tokens: ['stranger-token'] },
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

    const [catalogueRow] = await db
      .insert(foods)
      .values({
        ownerUserId: null,
        name: `${marker} Banana, raw`,
        category: 'fruits',
        kcalPer100g: '89',
        proteinPer100g: '1.1',
        carbsPer100g: '22.8',
        fatPer100g: '0.3',
        source: 'usda_fdc',
        sourceId: `${marker}-1`,
      })
      .returning();
    if (!catalogueRow) throw new Error('seed insert returned no row');
    catalogueFoodId = catalogueRow.id;
    createdFoodIds.push(catalogueFoodId);
  });

  afterAll(async () => {
    await db.delete(foods).where(inArray(foods.id, createdFoodIds));
    await db.delete(users).where(inArray(users.email, [ownerEmail, strangerEmail]));
    await app.close();
  });

  it('requires authentication on every route', async () => {
    await request(app.getHttpServer()).get('/api/v1/nutrition/foods?q=banana').expect(401);
    await request(app.getHttpServer()).get('/api/v1/nutrition/macro-goals').expect(401);
  });

  it('searches the catalogue and returns a shape matching the published contract', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/nutrition/foods?q=${encodeURIComponent(marker)}`)
      .set(auth('owner-token'))
      .expect(200);

    expect(foodListResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body.items.some((food: { id: string }) => food.id === catalogueFoodId)).toBe(true);
  });

  it('404s macro goals before any have been saved, then round-trips a real save', async () => {
    await request(app.getHttpServer()).get('/api/v1/nutrition/macro-goals').set(auth('owner-token')).expect(404);

    const set = await request(app.getHttpServer())
      .put('/api/v1/nutrition/macro-goals')
      .set(auth('owner-token'))
      .send({ kcal: 2400, protein: 180, carbs: 240, fat: 80 })
      .expect(200);
    expect(macroGoalsResponseSchema.parse(set.body)).toEqual({ kcal: 2400, protein: 180, carbs: 240, fat: 80 });

    const get = await request(app.getHttpServer()).get('/api/v1/nutrition/macro-goals').set(auth('owner-token')).expect(200);
    expect(get.body).toEqual({ kcal: 2400, protein: 180, carbs: 240, fat: 80 });
  });

  it('logs a food, computing macros server-side even when the caller tries to send its own', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/nutrition/log')
      .set(auth('owner-token'))
      .send({
        foodId: catalogueFoodId,
        slot: 'breakfast',
        loggedDate: '2026-08-31',
        servingLabel: '1 medium (118g)',
        grams: 118,
        // A caller-supplied macro value has no field to land in -- logFoodRequestSchema strips
        // anything not in its own shape, so this must not reach the stored kcal.
        kcal: 999999,
      })
      .expect(201);

    expect(nutritionLogEntryResponseSchema.parse(response.body)).toEqual(response.body);
    // 89 kcal/100g * 118g / 100 = 105.02
    expect(response.body.kcal).toBeCloseTo(105.02, 1);
    expect(response.body.kcal).not.toBe(999999);

    const list = await request(app.getHttpServer())
      .get('/api/v1/nutrition/log?date=2026-08-31')
      .set(auth('owner-token'))
      .expect(200);
    expect(nutritionLogListResponseSchema.parse(list.body)).toEqual(list.body);
    expect(list.body.items.some((entry: { id: string }) => entry.id === response.body.id)).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/nutrition/log/${response.body.id}`)
      .set(auth('owner-token'))
      .expect(204);
  });

  it('creates a custom food, rejects a duplicate name with 409, and hides it from another user', async () => {
    const name = `${marker} My Private Snack`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/nutrition/foods')
      .set(auth('owner-token'))
      .send({ name, category: 'snacks', kcalPer100g: 400, proteinPer100g: 10, carbsPer100g: 40, fatPer100g: 15 })
      .expect(201);
    expect(foodResponseSchema.parse(created.body)).toEqual(created.body);
    expect(created.body.isCustom).toBe(true);
    createdFoodIds.push(created.body.id);

    await request(app.getHttpServer())
      .post('/api/v1/nutrition/foods')
      .set(auth('owner-token'))
      .send({ name, category: 'snacks', kcalPer100g: 400, proteinPer100g: 10, carbsPer100g: 40, fatPer100g: 15 })
      .expect(409);

    // 404, never 403, and indistinguishable from an id that doesn't exist -- the same
    // anti-enumeration property the athlete profile endpoint already guarantees.
    const unknown = await request(app.getHttpServer())
      .get('/api/v1/nutrition/foods/00000000-0000-4000-8000-000000000000')
      .set(auth('stranger-token'))
      .expect(404);
    const strangersView = await request(app.getHttpServer())
      .get(`/api/v1/nutrition/foods/${created.body.id}`)
      .set(auth('stranger-token'))
      .expect(404);
    expect(strangersView.body).toEqual(unknown.body);

    const strangerSearch = await request(app.getHttpServer())
      .get(`/api/v1/nutrition/foods?q=${encodeURIComponent(name)}`)
      .set(auth('stranger-token'))
      .expect(200);
    expect(strangerSearch.body.items).toEqual([]);
  });

  it('saves a meal, logs it as one group carrying the meal name as groupName, and deletes the whole group at once', async () => {
    const mealName = `${marker} Breakfast — usual`;
    const meal = await request(app.getHttpServer())
      .post('/api/v1/nutrition/meals')
      .set(auth('owner-token'))
      .send({
        name: mealName,
        items: [{ foodId: catalogueFoodId, servingLabel: '1 medium (118g)', grams: 118 }],
      })
      .expect(201);
    expect(savedMealResponseSchema.parse(meal.body)).toEqual(meal.body);

    const logged = await request(app.getHttpServer())
      .post('/api/v1/nutrition/log/meal')
      .set(auth('owner-token'))
      .send({ savedMealId: meal.body.id, slot: 'lunch', loggedDate: '2026-08-31' })
      .expect(201);
    expect(logged.body.items).toHaveLength(1);
    expect(nutritionLogEntryResponseSchema.parse(logged.body.items[0])).toEqual(logged.body.items[0]);
    const groupId = logged.body.items[0].groupId as string;
    expect(groupId).not.toBeNull();
    // The dashboard's collapsed-group row needs this to render "<name> · N items" -- a Phase H
    // follow-up fix (`nutrition-plan.md`) for a name source that groupId alone never provided.
    expect(logged.body.items[0].groupName).toBe(mealName);

    await request(app.getHttpServer())
      .delete(`/api/v1/nutrition/log/group/${groupId}`)
      .set(auth('owner-token'))
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/v1/nutrition/meals/${meal.body.id}`)
      .set(auth('owner-token'))
      .expect(204);

    // A stranger can never log someone else's saved meal id, even a now-deleted one.
    await request(app.getHttpServer())
      .post('/api/v1/nutrition/log/meal')
      .set(auth('stranger-token'))
      .send({ savedMealId: meal.body.id, slot: 'dinner', loggedDate: '2026-08-31' })
      .expect(404);
  });

  it('rejects a duplicate saved-meal name (case-insensitive) for the same owner with 409, but allows it for a different owner', async () => {
    const name = `${marker} Duplicate Meal`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/nutrition/meals')
      .set(auth('owner-token'))
      .send({ name, items: [] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/nutrition/meals')
      .set(auth('owner-token'))
      .send({ name: name.toUpperCase(), items: [] })
      .expect(409);

    // A different user can use the exact same name -- uniqueness is per-owner, not global.
    const strangers = await request(app.getHttpServer())
      .post('/api/v1/nutrition/meals')
      .set(auth('stranger-token'))
      .send({ name, items: [] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/nutrition/meals/${first.body.id}`)
      .set(auth('owner-token'))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/nutrition/meals/${strangers.body.id}`)
      .set(auth('stranger-token'))
      .expect(204);
  });
});
