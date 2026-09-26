import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { CreateWorkoutSessionInput, WorkoutsRepository } from "../workouts/workouts.repository";
import { AthleteStatsRepository } from "./athlete-stats.repository";

/**
 * Against real Postgres: the claims are aggregates over sessions, sets and exercises, which a mock
 * would only prove the author's assumptions about. Each case pins one rule of the public profile
 * (Phase 10N): what counts toward a record, what a recent session shows, and how a streak is dated.
 */
describe("AthleteStatsRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: AthleteStatsRepository;
  let workouts: WorkoutsRepository;
  let exercisesRepository: ExercisesRepository;
  const createdEmails: string[] = [];
  const createdExerciseIds: string[] = [];
  const createdSessionIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `athstats-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const makeExercise = async (name: string): Promise<string> => {
    const exercise = await exercisesRepository.upsertCatalogueExercise({
      source: "test",
      sourceId: `athstats-${randomUUID()}`,
      name: `${name} ${randomUUID().slice(0, 8)}`,
      slug: `athstats-${randomUUID()}`,
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
    createdExerciseIds.push(exercise.id);
    return exercise.id;
  };

  const set = (weightKg: number | null, reps: number | null, isCompleted = true) => ({
    type: "working" as const,
    isCompleted,
    weightKg,
    reps,
    durationSeconds: null,
    distanceMeters: null,
    restSeconds: null,
    completedAt: null,
  });

  const session = (
    userId: string,
    startedAt: string,
    over: Partial<CreateWorkoutSessionInput> = {},
  ): CreateWorkoutSessionInput => ({
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
    isLiveTracked: true,
    exercises: [],
    ...over,
  });

  const save = async (input: CreateWorkoutSessionInput) => {
    const saved = await workouts.upsertSession(input);
    createdSessionIds.push(saved.id);
    return saved;
  };

  const withSets = (exerciseId: string, sets: ReturnType<typeof set>[]) => [
    { exerciseId, measure: "weight" as const, notes: null, sets },
  ];

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new AthleteStatsRepository(db as unknown as Database);
    workouts = new WorkoutsRepository(db);
    exercisesRepository = new ExercisesRepository(db);
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    if (createdEmails.length > 0) await db.delete(users).where(inArray(users.email, createdEmails));
    if (createdExerciseIds.length > 0) await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    await pool.end();
  });

  describe("personalRecords", () => {
    it("is the heaviest completed set of each exercise, heaviest first", async () => {
      const userId = await makeUser("pr");
      const bench = await makeExercise("Bench");
      const squat = await makeExercise("Squat");
      await save(session(userId, "2026-09-01T10:00:00Z", { exercises: withSets(bench, [set(80, 5), set(100, 3)]) }));
      await save(session(userId, "2026-09-02T10:00:00Z", { exercises: withSets(squat, [set(140, 5)]) }));
      await save(session(userId, "2026-09-03T10:00:00Z", { exercises: withSets(bench, [set(90, 8)]) }));

      const records = await repository.personalRecords(userId, 4);

      expect(records.map((r) => r.weightKg)).toEqual([140, 100]);
      expect(records[0]?.exerciseName).toContain("Squat");
      expect(records[1]?.exerciseName).toContain("Bench");
    });

    it("returns at most the limit, keeping the heaviest", async () => {
      const userId = await makeUser("prlimit");
      for (const weight of [60, 70, 80, 90, 100]) {
        await save(session(userId, "2026-09-01T10:00:00Z", { exercises: withSets(await makeExercise("Lift"), [set(weight, 5)]) }));
      }

      const records = await repository.personalRecords(userId, 4);

      expect(records.map((r) => r.weightKg)).toEqual([100, 90, 80, 70]);
    });

    it("ignores sets that were not completed, unweighted sets and unfinished sessions", async () => {
      const userId = await makeUser("prskip");
      const lift = await makeExercise("Skip");
      await save(session(userId, "2026-09-01T10:00:00Z", { exercises: withSets(lift, [set(200, 5, false), set(null, 10), set(0, 10)]) }));
      await save(session(userId, "2026-09-02T10:00:00Z", { status: "cancelled", exercises: withSets(lift, [set(250, 1)]) }));

      expect(await repository.personalRecords(userId, 4)).toEqual([]);
    });

    it("never includes another athlete's lifts", async () => {
      const mine = await makeUser("prmine");
      const theirs = await makeUser("prtheirs");
      const lift = await makeExercise("Shared");
      await save(session(theirs, "2026-09-01T10:00:00Z", { exercises: withSets(lift, [set(300, 1)]) }));

      expect(await repository.personalRecords(mine, 4)).toEqual([]);
    });
  });

  describe("recentSessions", () => {
    it("is the newest completed sessions first, with the kilograms lifted", async () => {
      const userId = await makeUser("recent");
      const lift = await makeExercise("Recent");
      await save(session(userId, "2026-09-01T10:00:00Z", { name: "Old", exercises: withSets(lift, [set(100, 10)]) }));
      await save(session(userId, "2026-09-05T10:00:00Z", { name: "Mid", exercises: withSets(lift, [set(50, 10), set(50, 10)]) }));
      await save(session(userId, "2026-09-09T10:00:00Z", { name: "New", exercises: withSets(lift, [set(60, 5, false), set(80, 5)]) }));

      const recent = await repository.recentSessions(userId, 3);

      expect(recent.map((s) => s.name)).toEqual(["New", "Mid", "Old"]);
      // Only the completed set counts: 80 x 5.
      expect(recent.map((s) => s.volumeKg)).toEqual([400, 1000, 1000]);
      expect(recent[0]?.startedAt).toEqual(new Date("2026-09-09T10:00:00Z"));
    });

    it("keeps only the most recent few", async () => {
      const userId = await makeUser("recentlimit");
      for (let day = 1; day <= 5; day += 1) {
        await save(session(userId, `2026-09-0${day}T10:00:00Z`, { name: `Day ${day}` }));
      }

      const recent = await repository.recentSessions(userId, 3);

      expect(recent.map((s) => s.name)).toEqual(["Day 5", "Day 4", "Day 3"]);
    });

    it("reports zero kilograms and the duration for a session with no weighted sets, such as a run", async () => {
      const userId = await makeUser("run");
      await save(session(userId, "2026-09-01T10:00:00Z", { name: "5K Run", activity: "running", durationSeconds: 1422 }));

      const [run] = await repository.recentSessions(userId, 3);

      expect(run).toMatchObject({ name: "5K Run", volumeKg: 0, durationSeconds: 1422 });
    });

    it("leaves out sessions that were never completed", async () => {
      const userId = await makeUser("recentskip");
      await save(session(userId, "2026-09-01T10:00:00Z", { status: "cancelled" }));

      expect(await repository.recentSessions(userId, 3)).toEqual([]);
    });
  });

  describe("weekStreak", () => {
    const NOW = new Date("2026-09-23T12:00:00Z"); // a Wednesday; this week began Saturday 19 September (ADR-056)

    it("counts consecutive trained weeks ending this week", async () => {
      const userId = await makeUser("streak");
      await save(session(userId, "2026-09-22T10:00:00Z")); // this week
      await save(session(userId, "2026-09-15T10:00:00Z")); // last week
      await save(session(userId, "2026-09-08T10:00:00Z")); // the week before

      expect(await repository.weekStreak(userId, "UTC", NOW)).toBe(3);
    });

    it("stays alive when this week is still empty but last week was trained", async () => {
      const userId = await makeUser("streakalive");
      await save(session(userId, "2026-09-15T10:00:00Z"));

      expect(await repository.weekStreak(userId, "UTC", NOW)).toBe(1);
    });

    it("breaks on a missed week", async () => {
      const userId = await makeUser("streakbreak");
      await save(session(userId, "2026-09-22T10:00:00Z"));
      await save(session(userId, "2026-09-01T10:00:00Z"));

      expect(await repository.weekStreak(userId, "UTC", NOW)).toBe(1);
    });

    it("is zero with no sessions", async () => {
      expect(await repository.weekStreak(await makeUser("streakzero"), "UTC", NOW)).toBe(0);
    });

    it("dates a session by the athlete's own calendar", async () => {
      const userId = await makeUser("streaktz");
      // Friday 18 September 23:30 UTC is already Saturday 19 September in Cairo (UTC+3), so there
      // it is this week and the week of 12 September is empty. In UTC it is still the week of 12
      // September, so the streak reaches back through the week of 5 September (the 11th).
      await save(session(userId, "2026-09-18T23:30:00Z"));
      await save(session(userId, "2026-09-11T10:00:00Z"));

      expect(await repository.weekStreak(userId, "Africa/Cairo", NOW)).toBe(1);
      expect(await repository.weekStreak(userId, "UTC", NOW)).toBe(2);
    });
  });
});
