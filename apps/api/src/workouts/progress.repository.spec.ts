import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { MuscleGroup } from "@forjd/domain";

import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions, workoutTemplates } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { ProgressRepository } from "./progress.repository";
import {
  CreateWorkoutSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutTemplateInput,
  WorkoutsRepository,
} from "./workouts.repository";

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
