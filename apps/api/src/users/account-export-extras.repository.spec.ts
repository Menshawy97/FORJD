import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { exerciseFavourites, exercises } from '../database/schema/exercises.schema';
import { goals } from '../database/schema/goals.schema';
import { healthConnections } from '../database/schema/health-data.schema';
import { foods, foodServings, macroGoals, savedMealItems, savedMeals } from '../database/schema/nutrition.schema';
import { preferences } from '../database/schema/preferences.schema';
import { users } from '../database/schema/users.schema';
import { programEnrollments, programs } from '../database/schema/workouts.schema';
import { AccountExportExtrasRepository } from './account-export-extras.repository';

/**
 * Phase 8 / 8C -- the tables the R4 export left out (custom exercises and foods, favourites,
 * macro goals, saved meals, goals, preferences, health connections, past program enrollments).
 * Against real Postgres, because the behaviour under test is per-user scoping and the numeric
 * columns' string-to-number conversion, neither of which a mock can prove.
 */
describe('AccountExportExtrasRepository', () => {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd';

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: AccountExportExtrasRepository;
  const suite = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emails: string[] = [];
  let ownerId: string;
  let otherId: string;

  async function seed(label: string): Promise<string> {
    const email = `extras-${label}-${suite}@example.com`;
    emails.push(email);
    const [user] = await db.insert(users).values({ email }).returning();
    const userId = user!.id;

    const [exercise] = await db
      .insert(exercises)
      .values({
        ownerUserId: userId,
        name: `${label} curl`,
        slug: `${label}-curl-${suite}`,
        category: 'strength',
        goal: 'strength',
        measure: 'weight',
        primaryMuscles: ['biceps'],
        instructions: ['Curl it'],
      })
      .returning();
    await db.insert(exerciseFavourites).values({ userId, exerciseId: exercise!.id });

    const [food] = await db
      .insert(foods)
      .values({
        ownerUserId: userId,
        name: `${label} bar`,
        category: 'other',
        kcalPer100g: '400.50',
        proteinPer100g: '20',
        carbsPer100g: '40',
        fatPer100g: '10',
      })
      .returning();
    await db.insert(foodServings).values({ foodId: food!.id, label: '1 bar', grams: '45.00', sortOrder: 0 });

    await db.insert(macroGoals).values({ userId, kcal: '2500', protein: '180', carbs: '250', fat: '70' });

    const [meal] = await db.insert(savedMeals).values({ userId, name: `${label} breakfast` }).returning();
    await db
      .insert(savedMealItems)
      .values({ savedMealId: meal!.id, foodId: food!.id, servingLabel: '1 bar', grams: '45.00', sortOrder: 0 });

    await db.insert(goals).values({ userId, type: 'weight', targetValue: '80.00', targetDate: '2026-12-31', status: 'active' });
    await db.insert(preferences).values({ userId, timezone: 'Africa/Cairo', locale: 'en', notificationsEnabled: false });
    await db.insert(healthConnections).values({
      userId,
      source: 'health_connect',
      lastSuccessfulSyncAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const [program] = await db
      .insert(programs)
      .values({
        ownerUserId: userId,
        name: `${label} program`,
        slug: `${label}-program-${suite}`,
        category: 'strength',
        level: 'beginner',
        daysPerWeek: 3,
        durationWeeks: 8,
      })
      .returning();
    await db.insert(programEnrollments).values({
      userId,
      programId: program!.id,
      programVersion: 1,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await db.insert(programEnrollments).values({
      userId,
      programId: program!.id,
      programVersion: 1,
      startedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    return userId;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new AccountExportExtrasRepository(db);
    ownerId = await seed('owner');
    otherId = await seed('other');
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, emails));
    await pool.end();
  });

  it("returns the owner's custom exercises and favourites, never another user's", async () => {
    const extras = await repository.getExtras(ownerId);

    expect(extras.customExercises).toHaveLength(1);
    expect(extras.customExercises[0]).toMatchObject({
      name: 'owner curl',
      category: 'strength',
      measure: 'weight',
      primaryMuscles: ['biceps'],
      instructions: ['Curl it'],
    });
    expect(extras.favouriteExerciseIds).toEqual([extras.customExercises[0]!.id]);
  });

  it('returns custom foods with their servings and numbers, not numeric strings', async () => {
    const extras = await repository.getExtras(ownerId);

    expect(extras.customFoods).toHaveLength(1);
    expect(extras.customFoods[0]).toMatchObject({
      name: 'owner bar',
      kcalPer100g: 400.5,
      proteinPer100g: 20,
      servings: [{ label: '1 bar', grams: 45 }],
    });
  });

  it('returns macro goals, saved meals with their items, goals, preferences and connections', async () => {
    const extras = await repository.getExtras(ownerId);

    expect(extras.macroGoals).toEqual({ kcal: 2500, protein: 180, carbs: 250, fat: 70 });
    expect(extras.savedMeals).toHaveLength(1);
    expect(extras.savedMeals[0]).toMatchObject({
      name: 'owner breakfast',
      items: [{ servingLabel: '1 bar', grams: 45 }],
    });
    expect(extras.goals).toEqual([{ type: 'weight', targetValue: 80, targetDate: '2026-12-31', status: 'active' }]);
    expect(extras.preferences).toEqual({ timezone: 'Africa/Cairo', locale: 'en', notificationsEnabled: false });
    expect(extras.healthConnections).toEqual([
      { source: 'health_connect', lastSuccessfulSyncAt: '2026-09-01T10:00:00.000Z' },
    ]);
  });

  it('returns every program enrolment, past and active, oldest first', async () => {
    const extras = await repository.getExtras(ownerId);

    expect(extras.programEnrollmentHistory).toHaveLength(2);
    expect(extras.programEnrollmentHistory[0]).toMatchObject({
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(extras.programEnrollmentHistory[1]).toMatchObject({
      startedAt: '2026-03-01T00:00:00.000Z',
      endedAt: null,
    });
  });

  it('never leaks one user into another: each sees exactly their own rows', async () => {
    const owner = await repository.getExtras(ownerId);
    const other = await repository.getExtras(otherId);

    expect(other.customExercises[0]?.name).toBe('other curl');
    expect(owner.customExercises.map((e) => e.name)).not.toContain('other curl');
    expect(other.customFoods.map((f) => f.name)).toEqual(['other bar']);
    expect(owner.savedMeals.map((m) => m.name)).toEqual(['owner breakfast']);
  });

  it('returns empty collections and nulls for a user with none of it', async () => {
    const email = `extras-empty-${suite}@example.com`;
    emails.push(email);
    const [user] = await db.insert(users).values({ email }).returning();

    const extras = await repository.getExtras(user!.id);

    expect(extras).toEqual({
      customExercises: [],
      favouriteExerciseIds: [],
      customFoods: [],
      macroGoals: null,
      savedMeals: [],
      goals: [],
      preferences: null,
      healthConnections: [],
      programEnrollmentHistory: [],
    });
  });
});
