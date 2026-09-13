import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { z } from "zod";
import { MuscleGroup } from "@forjd/domain";

import { Database } from "../database/database.module";
import { executeValidated, RawSqlValidationError } from "../database/db-utils";
import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions, workoutTemplates } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import {
  dailyVolumeRowSchema,
  firstCompletedSessionRowSchema,
  muscleSplitRowSchema,
  oneRepMaxTrendRowSchema,
  ProgressRepository,
  readyToProgressRowSchema,
  recentPersonalRecordsRowSchema,
  trainingCalendarDayRowSchema,
} from "./progress.repository";
import {
  CreateWorkoutSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutTemplateInput,
  WorkoutsRepository,
} from "./workouts.repository";

/**
 * A fake `Database` whose `execute` resolves to whatever rows the test hands it -- enough to
 * exercise `executeValidated`'s own parsing/throwing behaviour without a real Postgres
 * connection. Only `execute` is used by `executeValidated`, so the rest of the `Database`
 * surface is deliberately left unimplemented.
 */
function fakeDbReturning(rows: unknown[]): Database {
  return {
    execute: jest.fn().mockResolvedValue({ rows }),
  } as unknown as Database;
}

/**
 * Exercised against real Postgres, matching `workouts.repository.spec.ts`'s own rationale:
 * the behaviour under test is date-window SQL and multi-table joins, which a mock would only
 * prove the test author's own assumptions about.
 */
describe("ProgressRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let progressRepository: ProgressRepository;
  let workoutsRepository: WorkoutsRepository;
  let exercisesRepository: ExercisesRepository;
  const createdUserEmails: string[] = [];
  const createdExerciseIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdSessionIds: string[] = [];

  const ZONE = "UTC";
  // A Wednesday. Every fixture below is positioned relative to this instant.
  const NOW = new Date("2026-08-19T12:00:00Z");

  const makeUser = async (label: string): Promise<string> => {
    const email = `progressrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const makeExercise = async (label: string, primaryMuscles: MuscleGroup[] = []): Promise<string> => {
    const exercise = await exercisesRepository.upsertCatalogueExercise({
      source: "test",
      sourceId: `progressrepo-${label}-${randomUUID()}`,
      name: `Test ${label} ${randomUUID()}`,
      slug: `test-${label}-${randomUUID()}`,
      category: "strength",
      goal: "strength",
      measure: "weight",
      primaryMuscles,
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

  const withSet = (
    exerciseId: string,
    weightKg: number | null,
    reps: number | null,
    completedAt: Date,
  ): CreateWorkoutSessionExerciseInput => ({
    exerciseId,
    measure: "weight",
    notes: null,
    sets: [
      {
        type: "working",
        isCompleted: true,
        weightKg,
        reps,
        durationSeconds: null,
        distanceMeters: null,
        restSeconds: null,
        completedAt,
      },
    ],
  });

  const sessionAt = (
    userId: string,
    startedAt: Date,
    overrides: Partial<CreateWorkoutSessionInput> = {},
  ): CreateWorkoutSessionInput => ({
    id: randomUUID(),
    userId,
    templateId: null,
    name: "Session",
    activity: "strength",
    status: "completed",
    startedAt,
    endedAt: new Date(startedAt.getTime() + 45 * 60 * 1000),
    durationSeconds: 2700,
    perceivedEffort: null,
    notes: null,
    city: null,
    citySlug: null,
    isLiveTracked: true,
    exercises: [],
    ...overrides,
  });

  const save = async (input: CreateWorkoutSessionInput) => {
    const saved = await workoutsRepository.upsertSession(input);
    createdSessionIds.push(saved.id);
    return saved;
  };

  const minimalTemplate = (exerciseId: string, targetReps: number): CreateWorkoutTemplateInput => ({
    name: "Test Template",
    activity: "strength",
    notes: null,
    estimatedDurationMinutes: 45,
    basedOnTemplateId: null,
    blocks: [
      {
        type: "straight_sets",
        name: null,
        rounds: null,
        workSeconds: null,
        restSeconds: null,
        capSeconds: null,
        exercises: [
          {
            exerciseId,
            setCount: 3,
            targetReps,
            targetRepsMax: null,
            targetWeightKg: 80,
            targetSeconds: null,
            targetDistanceMeters: null,
            restSeconds: 90,
            notes: null,
          },
        ],
      },
    ],
  });

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    progressRepository = new ProgressRepository(db);
    workoutsRepository = new WorkoutsRepository(db);
    exercisesRepository = new ExercisesRepository(db);
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
    if (createdUserEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdUserEmails));
    }
    await pool.end();
  });

  describe("progressStrengthForUser", () => {
    it("returns the honest empty shape for an account that has never trained", async () => {
      const owner = await makeUser("empty");

      const result = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);

      expect(result.personalRecords).toEqual([]);
      expect(result.oneRepMaxTrend).toEqual([]);
      expect(result.muscleSplit).toEqual([]);
      expect(result.trainingCalendar.daysTrained).toBe(0);
      expect(result.readyToProgress).toBeNull();
      expect(result.weeksOfHistory).toBe(0);
      expect(result.weeklyVolumeKg).toHaveLength(7);
      expect(result.weeklyVolumeKg.every((day) => day.volumeKg === 0)).toBe(true);
    });

    it("never mixes one athlete's sessions into another's progress", async () => {
      const owner = await makeUser("mine");
      const stranger = await makeUser("theirs");
      const exerciseId = await makeExercise("cross-user");
      await save(
        sessionAt(stranger, new Date("2026-08-19T09:00:00Z"), {
          exercises: [withSet(exerciseId, 100, 5, new Date("2026-08-19T09:05:00Z"))],
        }),
      );

      const result = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);

      expect(result.personalRecords).toEqual([]);
      expect(result.volumeKgThisWeek).toBe(0);
    });

    it("counts volume as sets x reps x load, and excludes unticked sets", async () => {
      const owner = await makeUser("volume");
      const exerciseId = await makeExercise("volume-lift");
      const monday = new Date("2026-08-17T09:00:00Z");
      await save(
        sessionAt(owner, monday, {
          exercises: [
            {
              exerciseId,
              measure: "weight",
              notes: null,
              sets: [
                {
                  type: "working",
                  isCompleted: true,
                  weightKg: 100,
                  reps: 5,
                  durationSeconds: null,
                  distanceMeters: null,
                  restSeconds: null,
                  completedAt: monday,
                },
                // The live screen pre-creates unticked set rows -- this one must not count.
                {
                  type: "working",
                  isCompleted: false,
                  weightKg: 999,
                  reps: 99,
                  durationSeconds: null,
                  distanceMeters: null,
                  restSeconds: null,
                  completedAt: null,
                },
              ],
            },
          ],
        }),
      );

      const result = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);

      // Monday is dayOfWeek 1 in the Monday-first scheme this response uses.
      const mondayBar = result.weeklyVolumeKg.find((day) => day.dayOfWeek === 1);
      expect(mondayBar?.volumeKg).toBe(500);
      expect(result.volumeKgThisWeek).toBe(500);
    });

    it("returns the two most recently achieved personal records, headed by exercise name", async () => {
      const owner = await makeUser("prs");
      const squat = await makeExercise("squat");
      const bench = await makeExercise("bench");
      const deadlift = await makeExercise("deadlift");
      await save(
        sessionAt(owner, new Date("2026-07-01T09:00:00Z"), {
          exercises: [withSet(deadlift, 180, 1, new Date("2026-07-01T09:05:00Z"))],
        }),
      );
      await save(
        sessionAt(owner, new Date("2026-08-05T09:00:00Z"), {
          exercises: [withSet(bench, 100, 1, new Date("2026-08-05T09:05:00Z"))],
        }),
      );
      await save(
        sessionAt(owner, new Date("2026-08-12T09:00:00Z"), {
          exercises: [withSet(squat, 140, 1, new Date("2026-08-12T09:05:00Z"))],
        }),
      );

      const result = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);

      expect(result.personalRecords).toHaveLength(2);
      expect(result.personalRecords[0]?.exerciseName).toContain("squat");
      expect(result.personalRecords[1]?.exerciseName).toContain("bench");
    });

    it("distributes a set's volume equally across its exercise's mapped muscle buckets", async () => {
      const owner = await makeUser("muscles");
      const legExercise = await makeExercise("legs-only", ["quads"]);
      const monthDay = new Date("2026-08-05T09:00:00Z");
      await save(
        sessionAt(owner, monthDay, {
          exercises: [withSet(legExercise, 100, 10, monthDay)],
        }),
      );

      const result = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);

      expect(result.muscleSplit).toEqual([{ bucket: "legs", percent: 100 }]);
    });

    it("identifies a lift ready to progress only after two consecutive sessions past its target reps", async () => {
      const owner = await makeUser("ready");
      const exerciseId = await makeExercise("progressable");
      const template = await workoutsRepository.createTemplate(owner, minimalTemplate(exerciseId, 8));
      createdTemplateIds.push(template.id);

      // First qualifying session: 10 reps against an 8-rep target.
      await save(
        sessionAt(owner, new Date("2026-08-05T09:00:00Z"), {
          templateId: template.id,
          exercises: [withSet(exerciseId, 80, 10, new Date("2026-08-05T09:05:00Z"))],
        }),
      );
      const resultAfterOne = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);
      expect(resultAfterOne.readyToProgress).toBeNull();

      // Second consecutive qualifying session.
      await save(
        sessionAt(owner, new Date("2026-08-12T09:00:00Z"), {
          templateId: template.id,
          exercises: [withSet(exerciseId, 80, 11, new Date("2026-08-12T09:05:00Z"))],
        }),
      );
      const resultAfterTwo = await progressRepository.progressStrengthForUser(owner, ZONE, NOW);
      expect(resultAfterTwo.readyToProgress?.exerciseId).toBe(exerciseId);
    });
  });
});

/**
 * R24 -- unit-level coverage for the `executeValidated` wrapper itself and for every raw-SQL
 * call site's Zod schema in `progress.repository.ts`. These run against a fake `Database`
 * (no Postgres required) because the behaviour under test is "does a malformed driver row
 * throw a named error instead of silently yielding `undefined`" -- a fact about the wrapper
 * and the schemas, not about SQL execution.
 */
describe("executeValidated", () => {
  const dummySchema = z.object({ id: z.string(), count: z.number() });

  it("returns parsed rows when every row matches the schema", async () => {
    const db = fakeDbReturning([{ id: "a", count: 1 }, { id: "b", count: 2 }]);

    const rows = await executeValidated(db, sql`select 1`, dummySchema, "dummyCall");

    expect(rows).toEqual([{ id: "a", count: 1 }, { id: "b", count: 2 }]);
  });

  it("throws a RawSqlValidationError, not undefined-propagating data, when a column is missing", async () => {
    const db = fakeDbReturning([{ id: "a" }]);

    await expect(executeValidated(db, sql`select 1`, dummySchema, "dummyCall")).rejects.toThrow(
      RawSqlValidationError,
    );
  });

  it("names the failing call site and row index in the thrown error", async () => {
    const db = fakeDbReturning([{ id: "a", count: 1 }, { id: "b" }]);

    await expect(executeValidated(db, sql`select 1`, dummySchema, "dummyCall")).rejects.toThrow(
      /dummyCall.*row 1/,
    );
  });

  it("throws when a column has the wrong type instead of yielding undefined into arithmetic", async () => {
    const db = fakeDbReturning([{ id: "a", count: "not-a-number" }]);

    await expect(executeValidated(db, sql`select 1`, dummySchema, "dummyCall")).rejects.toThrow(
      RawSqlValidationError,
    );
  });
});

describe("progress.repository raw-SQL row schemas (R24, one per call site)", () => {
  it("recentPersonalRecords: validates a good row and rejects a row missing exercise_name", async () => {
    const goodRow = {
      exercise_id: randomUUID(),
      exercise_name: "Back Squat",
      weight_kg: "140.00",
      reps: 1,
      achieved_at: new Date("2026-08-12T09:05:00Z"),
      prior_best_weight_kg: null,
    };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(dbGood, sql`select 1`, recentPersonalRecordsRowSchema, "recentPersonalRecords"),
    ).resolves.toEqual([goodRow]);

    const { exercise_name: _dropped, ...malformedRow } = goodRow;
    const dbBad = fakeDbReturning([malformedRow]);
    await expect(
      executeValidated(dbBad, sql`select 1`, recentPersonalRecordsRowSchema, "recentPersonalRecords"),
    ).rejects.toThrow(RawSqlValidationError);
  });

  it("oneRepMaxTrend: validates a good row and rejects reps sent as a string", async () => {
    const goodRow = { local_date: "2026-08-17", weight_kg: "100.00", reps: 5 };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(dbGood, sql`select 1`, oneRepMaxTrendRowSchema, "oneRepMaxTrend"),
    ).resolves.toEqual([goodRow]);

    const dbBad = fakeDbReturning([{ ...goodRow, reps: "5" }]);
    await expect(
      executeValidated(dbBad, sql`select 1`, oneRepMaxTrendRowSchema, "oneRepMaxTrend"),
    ).rejects.toThrow(RawSqlValidationError);
  });

  it("dailyVolume: validates a good row and rejects a row missing sessions", async () => {
    const goodRow = { local_date: "2026-08-17", volume_kg: "500.00", sessions: 2 };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(dbGood, sql`select 1`, dailyVolumeRowSchema, "dailyVolume"),
    ).resolves.toEqual([goodRow]);

    const { sessions: _dropped, ...malformedRow } = goodRow;
    const dbBad = fakeDbReturning([malformedRow]);
    await expect(
      executeValidated(dbBad, sql`select 1`, dailyVolumeRowSchema, "dailyVolume"),
    ).rejects.toThrow(RawSqlValidationError);
  });

  it("trainingCalendarDays: validates a good row and rejects activities sent as a scalar, not an array", async () => {
    const goodRow = { local_date: "2026-08-17", activities: ["strength"] };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(dbGood, sql`select 1`, trainingCalendarDayRowSchema, "trainingCalendarDays"),
    ).resolves.toEqual([goodRow]);

    const dbBad = fakeDbReturning([{ local_date: "2026-08-17", activities: "strength" }]);
    await expect(
      executeValidated(dbBad, sql`select 1`, trainingCalendarDayRowSchema, "trainingCalendarDays"),
    ).rejects.toThrow(RawSqlValidationError);
  });

  it("muscleSplit: validates a good row and rejects a row missing primary_muscles", async () => {
    const goodRow = { weight_kg: "100.00", reps: 10, primary_muscles: ["quads"] };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(dbGood, sql`select 1`, muscleSplitRowSchema, "muscleSplit"),
    ).resolves.toEqual([goodRow]);

    const { primary_muscles: _dropped, ...malformedRow } = goodRow;
    const dbBad = fakeDbReturning([malformedRow]);
    await expect(
      executeValidated(dbBad, sql`select 1`, muscleSplitRowSchema, "muscleSplit"),
    ).rejects.toThrow(RawSqlValidationError);
  });

  it("readyToProgress: validates a good row and rejects a row missing exercise_id", async () => {
    const goodRow = { exercise_id: randomUUID(), exercise_name: "Bench Press" };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(dbGood, sql`select 1`, readyToProgressRowSchema, "readyToProgress"),
    ).resolves.toEqual([goodRow]);

    const { exercise_id: _dropped, ...malformedRow } = goodRow;
    const dbBad = fakeDbReturning([malformedRow]);
    await expect(
      executeValidated(dbBad, sql`select 1`, readyToProgressRowSchema, "readyToProgress"),
    ).rejects.toThrow(RawSqlValidationError);
  });

  it("firstCompletedSessionLocalDate: validates a null local_date and rejects local_date sent as a number", async () => {
    const goodRow = { local_date: null };
    const dbGood = fakeDbReturning([goodRow]);
    await expect(
      executeValidated(
        dbGood,
        sql`select 1`,
        firstCompletedSessionRowSchema,
        "firstCompletedSessionLocalDate",
      ),
    ).resolves.toEqual([goodRow]);

    const dbBad = fakeDbReturning([{ local_date: 20260817 }]);
    await expect(
      executeValidated(
        dbBad,
        sql`select 1`,
        firstCompletedSessionRowSchema,
        "firstCompletedSessionLocalDate",
      ),
    ).rejects.toThrow(RawSqlValidationError);
  });
});
