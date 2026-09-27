import { randomUUID } from "crypto";
import { ACTIVITY_SESSION_CAP_SECONDS } from "@forjd/domain";
import { eq, inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { exercises } from "../database/schema/exercises.schema";
import { foods, nutritionLogEntries } from "../database/schema/nutrition.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { CreateWorkoutSessionInput, WorkoutsRepository } from "../workouts/workouts.repository";
import { ForgeTotalsRepository, ForgeWeekWindow } from "./forge-totals.repository";

/**
 * Against real Postgres: the behaviour under test is what one closed week adds up to on every
 * ladder, and the lock that keeps a closed week closed (ADR-057 decision 2). A mock could only prove
 * the author's assumptions about the SQL.
 *
 * The week of Saturday 26 September 2026 in Cairo (UTC+3): it starts Friday 25 September 21:00 UTC
 * and closes Friday 2 October 21:00 UTC.
 */
describe("ForgeTotalsRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  const WEEK: ForgeWeekWindow = {
    weekStart: "2026-09-26",
    start: new Date("2026-09-25T21:00:00Z"),
    end: new Date("2026-10-02T21:00:00Z"),
  };
  const LOCK = WEEK.end;

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ForgeTotalsRepository;
  let workouts: WorkoutsRepository;
  let exerciseId: string;
  const emails: string[] = [];
  const sessionIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `forge-totals-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    emails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    return row!.id;
  };

  const set = (
    weightKg: number | null,
    reps: number | null,
    over: { isCompleted?: boolean; type?: "working" | "warmup"; distanceMeters?: number | null } = {},
  ) => ({
    type: over.type ?? ("working" as const),
    isCompleted: over.isCompleted ?? true,
    weightKg,
    reps,
    durationSeconds: null,
    distanceMeters: over.distanceMeters ?? null,
    restSeconds: null,
    completedAt: null,
  });

  const session = (userId: string, startedAt: string, over: Partial<CreateWorkoutSessionInput> = {}): CreateWorkoutSessionInput => ({
    id: randomUUID(),
    userId,
    templateId: null,
    name: "Session",
    activity: "strength",
    status: "completed",
    startedAt: new Date(startedAt),
    endedAt: new Date(new Date(startedAt).getTime() + 45 * 60 * 1000),
    durationSeconds: 2700,
    perceivedEffort: null,
    notes: null,
    city: null,
    citySlug: null,
    isLiveTracked: false,
    exercises: [],
    ...over,
  });

  /** Saves a session, then stamps when the server received it (the lock reads `created_at`). */
  const save = async (input: CreateWorkoutSessionInput, receivedAt = new Date("2026-09-28T12:00:00Z")) => {
    const saved = await workouts.upsertSession(input);
    sessionIds.push(saved.id);
    await db.update(workoutSessions).set({ createdAt: receivedAt }).where(eq(workoutSessions.id, saved.id));
    return saved;
  };

  const lift = (sets: ReturnType<typeof set>[]) => [{ exerciseId, measure: "weight" as const, notes: null, sets }];

  const logMeal = async (userId: string, loggedDate: string, createdAt = new Date("2026-09-28T12:00:00Z")) => {
    const [food] = await db
      .insert(foods)
      .values({
        ownerUserId: userId,
        name: `food-${randomUUID()}`,
        category: "other",
        kcalPer100g: "100",
        proteinPer100g: "1",
        carbsPer100g: "1",
        fatPer100g: "1",
      })
      .returning();
    await db.insert(nutritionLogEntries).values({
      userId,
      foodId: food!.id,
      loggedDate,
      slot: "lunch",
      servingLabel: "1",
      grams: "100",
      kcal: "100",
      protein: "1",
      carbs: "1",
      fat: "1",
      createdAt,
    });
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new ForgeTotalsRepository(db as unknown as Database);
    workouts = new WorkoutsRepository(db);
    const exercise = await new ExercisesRepository(db).upsertCatalogueExercise({
      source: "test",
      sourceId: `forge-totals-${randomUUID()}`,
      name: `Forge Test Squat ${randomUUID()}`,
      slug: `forge-test-squat-${randomUUID()}`,
      category: "strength",
      goal: "strength",
      measure: "weight",
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: [],
      force: null,
      level: null,
      mechanic: null,
      instructions: [],
      imageKeys: [],
      description: null,
    });
    exerciseId = exercise.id;
  });

  afterAll(async () => {
    if (sessionIds.length > 0) await db.delete(workoutSessions).where(inArray(workoutSessions.id, sessionIds));
    if (emails.length > 0) await db.delete(users).where(inArray(users.email, emails));
    await db.delete(exercises).where(eq(exercises.id, exerciseId));
    await pool.end();
  });

  it("is zero on every ladder for a week with nothing logged", async () => {
    const userId = await makeUser("empty");

    expect(await repository.weeklyTotals(userId, WEEK, LOCK)).toEqual({
      consistency: 0,
      volume: 0,
      distance: 0,
      minutes: 0,
      nourish: 0,
    });
  });

  it("counts completed workouts, and not cancelled, unfinished or deleted ones", async () => {
    const userId = await makeUser("consistency");
    await save(session(userId, "2026-09-27T08:00:00Z"));
    await save(session(userId, "2026-09-29T08:00:00Z", { activity: "running" }));
    await save(session(userId, "2026-09-30T08:00:00Z", { status: "cancelled" }));
    const deleted = await save(session(userId, "2026-10-01T08:00:00Z"));
    await db
      .update(workoutSessions)
      .set({ deletedAt: new Date("2026-09-30T00:00:00Z") })
      .where(eq(workoutSessions.id, deleted.id));

    expect((await repository.weeklyTotals(userId, WEEK, LOCK)).consistency).toBe(2);
  });

  it("sums volume as weight x reps over completed sets, warm-ups included (the user's decision)", async () => {
    const userId = await makeUser("volume");
    await save(
      session(userId, "2026-09-27T08:00:00Z", {
        exercises: lift([set(100, 5), set(40, 10, { type: "warmup" }), set(999, 99, { isCompleted: false })]),
      }),
    );

    expect((await repository.weeklyTotals(userId, WEEK, LOCK)).volume).toBe(900);
  });

  it("sums kilometres from running sessions only", async () => {
    const userId = await makeUser("distance");
    const runSets = [
      { exerciseId, measure: "distance" as const, notes: null, sets: [set(null, null, { distanceMeters: 5250 })] },
    ];
    await save(session(userId, "2026-09-27T06:00:00Z", { activity: "running", exercises: runSets }));
    // A rowing or sled distance in a strength session is not "km run".
    await save(session(userId, "2026-09-28T06:00:00Z", { exercises: runSets }));

    expect((await repository.weeklyTotals(userId, WEEK, LOCK)).distance).toBeCloseTo(5.25);
  });

  it("sums active minutes, capping each session as the leaderboard does", async () => {
    const userId = await makeUser("minutes");
    await save(session(userId, "2026-09-27T08:00:00Z", { durationSeconds: 1800 }));
    await save(session(userId, "2026-09-28T08:00:00Z", { durationSeconds: 9 * 3600 }));

    expect((await repository.weeklyTotals(userId, WEEK, LOCK)).minutes).toBe(
      (1800 + ACTIVITY_SESSION_CAP_SECONDS) / 60,
    );
  });

  it("counts distinct days with a meal logged, not entries", async () => {
    const userId = await makeUser("nourish");
    await logMeal(userId, "2026-09-26");
    await logMeal(userId, "2026-09-26");
    await logMeal(userId, "2026-10-02");
    await logMeal(userId, "2026-10-03"); // next week
    await logMeal(userId, "2026-09-25"); // last week

    expect((await repository.weeklyTotals(userId, WEEK, LOCK)).nourish).toBe(2);
  });

  it("dates a workout by the athlete's week: Friday 23:30 in Cairo belongs to the closing week", async () => {
    const userId = await makeUser("boundary");
    await save(session(userId, "2026-10-02T20:30:00Z")); // Friday 23:30 Cairo: this week
    await save(session(userId, "2026-10-02T21:00:00Z")); // Saturday 00:00 Cairo: next week
    await save(session(userId, "2026-09-25T20:59:00Z")); // Friday 23:59 Cairo the week before

    expect((await repository.weeklyTotals(userId, WEEK, LOCK)).consistency).toBe(1);
  });

  describe("the lock at the close", () => {
    it("leaves out a workout the server received after the close, even one done inside the week", async () => {
      const userId = await makeUser("late-sync");
      await save(session(userId, "2026-10-01T08:00:00Z"), new Date("2026-10-02T21:00:01Z"));

      expect((await repository.weeklyTotals(userId, WEEK, LOCK)).consistency).toBe(0);
    });

    it("still counts a workout deleted after the close", async () => {
      const userId = await makeUser("late-delete");
      const saved = await save(session(userId, "2026-10-01T08:00:00Z"));
      await db
        .update(workoutSessions)
        .set({ deletedAt: new Date("2026-10-03T09:00:00Z") })
        .where(eq(workoutSessions.id, saved.id));

      expect((await repository.weeklyTotals(userId, WEEK, LOCK)).consistency).toBe(1);
    });

    it("leaves out a meal logged after the close", async () => {
      const userId = await makeUser("late-meal");
      await logMeal(userId, "2026-10-02", new Date("2026-10-03T09:00:00Z"));

      expect((await repository.weeklyTotals(userId, WEEK, LOCK)).nourish).toBe(0);
    });

    it("counts everything received so far when read live, mid-week", async () => {
      const userId = await makeUser("live");
      await save(session(userId, "2026-09-28T08:00:00Z"), new Date("2026-09-28T09:00:00Z"));

      expect((await repository.weeklyTotals(userId, WEEK, new Date("2026-09-28T10:00:00Z"))).consistency).toBe(1);
    });
  });

  it("never counts another athlete's training", async () => {
    const userId = await makeUser("mine");
    const other = await makeUser("theirs");
    await save(session(other, "2026-09-27T08:00:00Z", { exercises: lift([set(100, 5)]) }));
    await logMeal(other, "2026-09-27");

    expect(await repository.weeklyTotals(userId, WEEK, LOCK)).toEqual({
      consistency: 0,
      volume: 0,
      distance: 0,
      minutes: 0,
      nourish: 0,
    });
  });
});
