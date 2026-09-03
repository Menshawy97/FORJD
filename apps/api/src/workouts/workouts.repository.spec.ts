import { ConflictException } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions, workoutTemplates } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import {
  CreateWorkoutSessionExerciseInput,
  CreateWorkoutSessionInput,
  CreateWorkoutTemplateInput,
  WorkoutsRepository,
} from "./workouts.repository";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is the database's
 * own cascade/FK actions and the multi-table transaction, which a mock would only prove the
 * test author's assumptions about. Same rationale as ExercisesRepository.spec.ts.
 */
describe("WorkoutsRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: WorkoutsRepository;
  let exercisesRepository: ExercisesRepository;
  const createdUserEmails: string[] = [];
  const createdExerciseIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdSessionIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `wkoutrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const makeExercise = async (label: string): Promise<string> => {
    const exercise = await exercisesRepository.upsertCatalogueExercise({
      source: "test",
      sourceId: `wkoutrepo-${label}-${randomUUID()}`,
      name: `Test ${label} ${randomUUID()}`,
      slug: `test-${label}-${randomUUID()}`,
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

  const minimalTemplate = (exerciseId: string, name: string): CreateWorkoutTemplateInput => ({
    name,
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
            setCount: 4,
            targetReps: 8,
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
    repository = new WorkoutsRepository(db);
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

  describe("createTemplate", () => {
    it("persists a template with a nested block and exercise, ordered from zero", async () => {
      const owner = await makeUser("create-owner");
      const exerciseId = await makeExercise("create");

      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Upper Push"),
      );
      createdTemplateIds.push(created.id);

      expect(created.name).toBe("Upper Push");
      expect(created.ownerUserId).toBe(owner);
      expect(created.basedOnTemplateId).toBeNull();
      expect(created.blocks).toHaveLength(1);
      expect(created.blocks[0]?.orderIndex).toBe(0);
      expect(created.blocks[0]?.exercises).toHaveLength(1);
      expect(created.blocks[0]?.exercises[0]?.orderIndex).toBe(0);
      expect(created.blocks[0]?.exercises[0]?.targetWeightKg).toBe(80);
    });

    it("persists a template with multiple blocks and exercises in the order given", async () => {
      const owner = await makeUser("create-multi");
      const exerciseA = await makeExercise("multi-a");
      const exerciseB = await makeExercise("multi-b");

      const created = await repository.createTemplate(owner, {
        name: "Full Body",
        activity: "strength",
        notes: "leg day",
        estimatedDurationMinutes: 60,
        basedOnTemplateId: null,
        blocks: [
          {
            type: "straight_sets",
            name: "Block A",
            rounds: null,
            workSeconds: null,
            restSeconds: null,
            capSeconds: null,
            exercises: [
              {
                exerciseId: exerciseA,
                setCount: 3,
                targetReps: 10,
                targetRepsMax: null,
                targetWeightKg: null,
                targetSeconds: null,
                targetDistanceMeters: null,
                restSeconds: 60,
                notes: null,
              },
            ],
          },
          {
            type: "interval",
            name: "Block B",
            rounds: 8,
            workSeconds: 30,
            restSeconds: 30,
            capSeconds: null,
            exercises: [
              {
                exerciseId: exerciseB,
                setCount: null,
                targetReps: null,
                targetRepsMax: null,
                targetWeightKg: null,
                targetSeconds: null,
                targetDistanceMeters: null,
                restSeconds: null,
                notes: null,
              },
            ],
          },
        ],
      });
      createdTemplateIds.push(created.id);

      expect(created.blocks).toHaveLength(2);
      expect(created.blocks[0]?.name).toBe("Block A");
      expect(created.blocks[0]?.orderIndex).toBe(0);
      expect(created.blocks[1]?.name).toBe("Block B");
      expect(created.blocks[1]?.orderIndex).toBe(1);
      expect(created.blocks[1]?.type).toBe("interval");
      expect(created.blocks[1]?.rounds).toBe(8);
    });

    it("persists a template with no blocks", async () => {
      const owner = await makeUser("create-empty");

      const created = await repository.createTemplate(owner, {
        name: "Empty Shell",
        activity: "strength",
        notes: null,
        estimatedDurationMinutes: null,
        basedOnTemplateId: null,
        blocks: [],
      });
      createdTemplateIds.push(created.id);

      expect(created.blocks).toEqual([]);
    });
  });

  describe("findByIdForUser", () => {
    it("returns the caller's own template with its blocks and exercises", async () => {
      const owner = await makeUser("find-own");
      const exerciseId = await makeExercise("find");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Find Me"),
      );
      createdTemplateIds.push(created.id);

      const found = await repository.findByIdForUser(created.id, owner);

      expect(found?.id).toBe(created.id);
      expect(found?.blocks[0]?.exercises[0]?.exerciseId).toBe(exerciseId);
    });

    /** Null, not a row -- turning this into a 404 rather than a 403 is the service's job. */
    it("returns null for another user's template", async () => {
      const owner = await makeUser("find-owner");
      const stranger = await makeUser("find-stranger");
      const exerciseId = await makeExercise("find-stranger-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Private Template"),
      );
      createdTemplateIds.push(created.id);

      await expect(repository.findByIdForUser(created.id, stranger)).resolves.toBeNull();
    });

    it("returns null for a soft-deleted template", async () => {
      const owner = await makeUser("find-deleted");
      const exerciseId = await makeExercise("find-deleted-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Deleted Template"),
      );
      createdTemplateIds.push(created.id);
      await repository.softDeleteTemplate(created.id, owner);

      await expect(repository.findByIdForUser(created.id, owner)).resolves.toBeNull();
    });

    it("returns null for an unknown id", async () => {
      const owner = await makeUser("find-unknown");

      await expect(repository.findByIdForUser(randomUUID(), owner)).resolves.toBeNull();
    });
  });

  describe("listForUser", () => {
    it("reports the exercise count computed from the template's blocks", async () => {
      const owner = await makeUser("list-count");
      const exerciseA = await makeExercise("list-count-a");
      const exerciseB = await makeExercise("list-count-b");

      const created = await repository.createTemplate(owner, {
        name: `Zzz List Count ${randomUUID()}`,
        activity: "strength",
        notes: null,
        estimatedDurationMinutes: null,
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
                exerciseId: exerciseA,
                setCount: null,
                targetReps: null,
                targetRepsMax: null,
                targetWeightKg: null,
                targetSeconds: null,
                targetDistanceMeters: null,
                restSeconds: null,
                notes: null,
              },
              {
                exerciseId: exerciseB,
                setCount: null,
                targetReps: null,
                targetRepsMax: null,
                targetWeightKg: null,
                targetSeconds: null,
                targetDistanceMeters: null,
                restSeconds: null,
                notes: null,
              },
            ],
          },
        ],
      });
      createdTemplateIds.push(created.id);

      const page = await repository.listForUser({ userId: owner, limit: 50 });
      const row = page.rows.find((r) => r.id === created.id);

      expect(row?.exerciseCount).toBe(2);
    });

    it("never includes another user's template", async () => {
      const owner = await makeUser("list-owner");
      const stranger = await makeUser("list-stranger");
      const exerciseId = await makeExercise("list-stranger-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, `Stranger Only ${randomUUID()}`),
      );
      createdTemplateIds.push(created.id);

      const page = await repository.listForUser({ userId: stranger, limit: 50 });

      expect(page.rows.some((r) => r.id === created.id)).toBe(false);
    });

    it("paginates with a keyset cursor -- no repeat and no gap", async () => {
      const owner = await makeUser("list-paginate");
      const exerciseId = await makeExercise("list-paginate-ex");
      const prefix = `Zzz Page ${randomUUID()}`;
      const names = [`${prefix} A`, `${prefix} B`, `${prefix} C`];
      for (const name of names) {
        const created = await repository.createTemplate(owner, minimalTemplate(exerciseId, name));
        createdTemplateIds.push(created.id);
      }

      const firstPage = await repository.listForUser({ userId: owner, limit: 2 });
      const matchingFirst = firstPage.rows.filter((r) => r.name.startsWith(prefix));
      expect(matchingFirst.map((r) => r.name)).toEqual([names[0], names[1]]);
      expect(firstPage.hasMore).toBe(true);

      const last = firstPage.rows[firstPage.rows.length - 1]!;
      const secondPage = await repository.listForUser({
        userId: owner,
        after: { name: last.name, id: last.id },
        limit: 50,
      });
      const matchingSecond = secondPage.rows.filter((r) => r.name.startsWith(prefix));
      expect(matchingSecond.map((r) => r.name)).toEqual([names[2]]);
    });
  });

  describe("updateTemplate", () => {
    it("updates simple fields without touching blocks when blocks is omitted", async () => {
      const owner = await makeUser("update-simple");
      const exerciseId = await makeExercise("update-simple-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Before Rename"),
      );
      createdTemplateIds.push(created.id);

      const updated = await repository.updateTemplate(created.id, owner, { name: "After Rename" });

      expect(updated?.name).toBe("After Rename");
      expect(updated?.blocks).toHaveLength(1);
      expect(updated?.blocks[0]?.exercises[0]?.exerciseId).toBe(exerciseId);
    });

    it("replaces the whole block tree when blocks is present", async () => {
      const owner = await makeUser("update-replace");
      const exerciseA = await makeExercise("update-replace-a");
      const exerciseB = await makeExercise("update-replace-b");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseA, "Replace Me"),
      );
      createdTemplateIds.push(created.id);
      const oldBlockId = created.blocks[0]?.id;

      const updated = await repository.updateTemplate(created.id, owner, {
        blocks: [
          {
            type: "superset",
            name: "New Block",
            rounds: null,
            workSeconds: null,
            restSeconds: null,
            capSeconds: null,
            exercises: [
              {
                exerciseId: exerciseB,
                setCount: 3,
                targetReps: 12,
                targetRepsMax: null,
                targetWeightKg: null,
                targetSeconds: null,
                targetDistanceMeters: null,
                restSeconds: null,
                notes: null,
              },
            ],
          },
        ],
      });

      expect(updated?.blocks).toHaveLength(1);
      expect(updated?.blocks[0]?.id).not.toBe(oldBlockId);
      expect(updated?.blocks[0]?.name).toBe("New Block");
      expect(updated?.blocks[0]?.exercises[0]?.exerciseId).toBe(exerciseB);
    });

    it("returns null for another user's template", async () => {
      const owner = await makeUser("update-owner");
      const stranger = await makeUser("update-stranger");
      const exerciseId = await makeExercise("update-stranger-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Not Yours"),
      );
      createdTemplateIds.push(created.id);

      await expect(
        repository.updateTemplate(created.id, stranger, { name: "Hijacked" }),
      ).resolves.toBeNull();
    });

    it("returns null for a curated template with no owner", async () => {
      const owner = await makeUser("update-curated");
      const exerciseId = await makeExercise("update-curated-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Then Curated"),
      );
      createdTemplateIds.push(created.id);
      // Simulate a curated row directly -- createTemplate always sets a real owner, so the
      // only way to exercise the "no owner ever matches" path is to null it out afterwards.
      await db
        .update(workoutTemplates)
        .set({ ownerUserId: null })
        .where(inArray(workoutTemplates.id, [created.id]));

      await expect(
        repository.updateTemplate(created.id, owner, { name: "Hijacked" }),
      ).resolves.toBeNull();
    });
  });

  describe("softDeleteTemplate", () => {
    it("soft-deletes the caller's own template", async () => {
      const owner = await makeUser("delete-own");
      const exerciseId = await makeExercise("delete-own-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Delete Me"),
      );
      createdTemplateIds.push(created.id);

      await expect(repository.softDeleteTemplate(created.id, owner)).resolves.toBe(true);
      await expect(repository.findByIdForUser(created.id, owner)).resolves.toBeNull();
    });

    it("returns false for another user's template", async () => {
      const owner = await makeUser("delete-owner");
      const stranger = await makeUser("delete-stranger");
      const exerciseId = await makeExercise("delete-stranger-ex");
      const created = await repository.createTemplate(
        owner,
        minimalTemplate(exerciseId, "Not Deletable"),
      );
      createdTemplateIds.push(created.id);

      await expect(repository.softDeleteTemplate(created.id, stranger)).resolves.toBe(false);
    });
  });

  const minimalSession = (
    userId: string,
    exerciseId: string,
    overrides: Partial<CreateWorkoutSessionInput> = {},
  ): CreateWorkoutSessionInput => ({
    id: randomUUID(),
    userId,
    templateId: null,
    name: "Upper Push",
    activity: "strength",
    status: "completed",
    startedAt: new Date("2026-09-02T09:00:00.000Z"),
    endedAt: new Date("2026-09-02T09:30:00.000Z"),
    durationSeconds: 1800,
    perceivedEffort: "solid",
    notes: null,
    city: null,
    citySlug: null,
    isLiveTracked: false,
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
            reps: 8,
            durationSeconds: null,
            distanceMeters: null,
            restSeconds: 90,
            completedAt: new Date("2026-09-02T09:05:00.000Z"),
          },
        ],
      },
    ],
    ...overrides,
  });

  describe("upsertSession", () => {
    it("persists a session with a nested exercise and set, ordered from zero", async () => {
      const owner = await makeUser("session-create");
      const exerciseId = await makeExercise("session-create-ex");
      const input = minimalSession(owner, exerciseId);

      const created = await repository.upsertSession(input);
      createdSessionIds.push(created.id);

      expect(created.id).toBe(input.id);
      expect(created.userId).toBe(owner);
      expect(created.exercises).toHaveLength(1);
      expect(created.exercises[0]?.orderIndex).toBe(0);
      expect(created.exercises[0]?.sets[0]?.weightKg).toBe(100);
      expect(created.exercises[0]?.sets[0]?.reps).toBe(8);
    });

    it("is idempotent: replaying the same id returns the original session untouched, ignoring the retry's own payload", async () => {
      const owner = await makeUser("session-idempotent");
      const exerciseId = await makeExercise("session-idempotent-ex");
      const input = minimalSession(owner, exerciseId);

      const first = await repository.upsertSession(input);
      createdSessionIds.push(first.id);

      const retried = await repository.upsertSession({ ...input, name: "Hijacked Retry" });

      expect(retried.id).toBe(first.id);
      expect(retried.name).toBe("Upper Push");
      expect(retried.exercises).toHaveLength(1);

      const rows = await db.select().from(workoutSessions).where(inArray(workoutSessions.id, [input.id]));
      expect(rows).toHaveLength(1);
    });

    it("rejects a replayed id that belongs to a different user", async () => {
      const owner = await makeUser("session-collision-owner");
      const stranger = await makeUser("session-collision-stranger");
      const exerciseId = await makeExercise("session-collision-ex");
      const input = minimalSession(owner, exerciseId);

      const created = await repository.upsertSession(input);
      createdSessionIds.push(created.id);

      await expect(
        repository.upsertSession({ ...input, userId: stranger }),
      ).rejects.toThrow(ConflictException);
    });

    it("persists a session with no exercises", async () => {
      const owner = await makeUser("session-empty");
      const input = minimalSession(owner, "", { exercises: [] });

      const created = await repository.upsertSession(input);
      createdSessionIds.push(created.id);

      expect(created.exercises).toEqual([]);
    });
  });

  describe("findSessionByIdForUser", () => {
    it("returns the caller's own session with its exercises and sets", async () => {
      const owner = await makeUser("session-find-own");
      const exerciseId = await makeExercise("session-find-ex");
      const input = minimalSession(owner, exerciseId);
      const created = await repository.upsertSession(input);
      createdSessionIds.push(created.id);

      const found = await repository.findSessionByIdForUser(created.id, owner);

      expect(found?.id).toBe(created.id);
      expect(found?.exercises[0]?.exerciseId).toBe(exerciseId);
    });

    it("returns null for another user's session", async () => {
      const owner = await makeUser("session-find-owner");
      const stranger = await makeUser("session-find-stranger");
      const exerciseId = await makeExercise("session-find-stranger-ex");
      const created = await repository.upsertSession(minimalSession(owner, exerciseId));
      createdSessionIds.push(created.id);

      await expect(repository.findSessionByIdForUser(created.id, stranger)).resolves.toBeNull();
    });

    it("returns null for an unknown id", async () => {
      const owner = await makeUser("session-find-unknown");

      await expect(
        repository.findSessionByIdForUser(randomUUID(), owner),
      ).resolves.toBeNull();
    });
  });

  describe("listSessionsForUser", () => {
    it("orders sessions newest-first and paginates with a keyset cursor -- no repeat and no gap", async () => {
      const owner = await makeUser("session-list-paginate");
      const exerciseId = await makeExercise("session-list-paginate-ex");
      const base = new Date("2026-09-02T09:00:00.000Z").getTime();
      const sessions = [];
      for (let i = 0; i < 3; i += 1) {
        const input = minimalSession(owner, exerciseId, {
          startedAt: new Date(base + i * 60_000),
          endedAt: new Date(base + i * 60_000 + 1_800_000),
        });
        const created = await repository.upsertSession(input);
        createdSessionIds.push(created.id);
        sessions.push(created);
      }
      // Newest first: the third (latest startedAt) session should lead.
      const [oldest, middle, newest] = sessions;

      const firstPage = await repository.listSessionsForUser({ userId: owner, limit: 2 });
      expect(firstPage.rows.map((r) => r.id)).toEqual([newest!.id, middle!.id]);
      expect(firstPage.hasMore).toBe(true);

      const last = firstPage.rows[firstPage.rows.length - 1]!;
      const secondPage = await repository.listSessionsForUser({
        userId: owner,
        after: { startedAt: last.startedAt.toISOString(), id: last.id },
        limit: 50,
      });
      expect(secondPage.rows.map((r) => r.id)).toEqual([oldest!.id]);
    });

    it("never includes another user's session", async () => {
      const owner = await makeUser("session-list-owner");
      const stranger = await makeUser("session-list-stranger");
      const exerciseId = await makeExercise("session-list-stranger-ex");
      const created = await repository.upsertSession(minimalSession(owner, exerciseId));
      createdSessionIds.push(created.id);

      const page = await repository.listSessionsForUser({ userId: stranger, limit: 50 });

      expect(page.rows.some((r) => r.id === created.id)).toBe(false);
    });
  });

  /**
   * Phase 3J-c -- Home's stat strip, "This week" and "Recent PR".
   *
   * Every assertion here fixes a date deliberately rather than reading the clock. These are
   * calendar aggregates: a test that says "a session today" and runs at 23:58 in a zone the
   * server is not in tests something different the next minute.
   */
  /**
   * Phase 3J-d -- the exercise-detail screen's "Best set" and "Est. 1RM" tiles, its top-set
   * trend, and its History list, for one exercise.
   */
  describe("exerciseHistoryForUser", () => {
    const historySession = (
      userId: string,
      startedAt: Date,
      exercises: CreateWorkoutSessionExerciseInput[],
      overrides: Partial<CreateWorkoutSessionInput> = {},
    ): CreateWorkoutSessionInput => ({
      id: randomUUID(),
      userId,
      templateId: null,
      name: "Push Day",
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
      exercises,
      ...overrides,
    });

    const sets = (
      exerciseId: string,
      rows: Array<{ weightKg: number | null; reps: number | null; isCompleted?: boolean }>,
      completedAt: Date,
    ): CreateWorkoutSessionExerciseInput => ({
      exerciseId,
      measure: "weight",
      notes: null,
      sets: rows.map((row) => ({
        type: "working" as const,
        isCompleted: row.isCompleted ?? true,
        weightKg: row.weightKg,
        reps: row.reps,
        durationSeconds: null,
        distanceMeters: null,
        restSeconds: null,
        completedAt,
      })),
    });

    const store = async (input: CreateWorkoutSessionInput) => {
      const saved = await repository.upsertSession(input);
      createdSessionIds.push(saved.id);
      return saved;
    };

    it("reports nothing at all for an exercise never performed", async () => {
      const owner = await makeUser("hist-empty");
      const bench = await makeExercise("hist-empty");

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      // Not a zero-weight best set: there is no best set. Zeroes would read as a real, very
      // bad lift, which is exactly what the screen's empty state exists to avoid.
      expect(history.bestSet).toBeNull();
      expect(history.estimatedOneRepMaxKg).toBeNull();
      expect(history.sessions).toEqual([]);
    });

    it("finds the heaviest completed set across every session", async () => {
      const owner = await makeUser("hist-best");
      const bench = await makeExercise("hist-best");

      await store(
        historySession(owner, new Date("2026-08-01T10:00:00Z"), [
          sets(bench, [{ weightKg: 90, reps: 5 }], new Date("2026-08-01T10:20:00Z")),
        ]),
      );
      await store(
        historySession(owner, new Date("2026-08-08T10:00:00Z"), [
          sets(bench, [{ weightKg: 100, reps: 3 }], new Date("2026-08-08T10:20:00Z")),
        ]),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.bestSet?.weightKg).toBe(100);
      expect(history.bestSet?.reps).toBe(3);
      // Epley from 100x3: 100 * (1 + 2/30) = 106.7 -- and the design's own demo tile reads
      // "106 kg" beside a "100 kg x 3" best set, which is where that number comes from.
      expect(history.estimatedOneRepMaxKg).toBeCloseTo(106.7, 1);
    });

    // A set the athlete never ticked was never performed, and a record built on one would be a
    // claim about a lift that did not happen.
    it("ignores unticked sets when finding the best", async () => {
      const owner = await makeUser("hist-unticked");
      const bench = await makeExercise("hist-unticked");

      await store(
        historySession(owner, new Date("2026-08-01T10:00:00Z"), [
          sets(
            bench,
            [
              { weightKg: 200, reps: 1, isCompleted: false },
              { weightKg: 80, reps: 8 },
            ],
            new Date("2026-08-01T10:20:00Z"),
          ),
        ]),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.bestSet?.weightKg).toBe(80);
    });

    // Epley diverges past twelve reps, so `estimateOneRepMaxKg` refuses -- but the best set
    // itself is still real and still shown. The two fields are independent for this reason.
    it("reports a best set with no estimate when the rep count is past the formula's range", async () => {
      const owner = await makeUser("hist-norm");
      const bench = await makeExercise("hist-norm");

      await store(
        historySession(owner, new Date("2026-08-01T10:00:00Z"), [
          sets(bench, [{ weightKg: 60, reps: 20 }], new Date("2026-08-01T10:20:00Z")),
        ]),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.bestSet?.weightKg).toBe(60);
      expect(history.estimatedOneRepMaxKg).toBeNull();
    });

    it("returns one row per session, carrying that session's own heaviest set", async () => {
      const owner = await makeUser("hist-rows");
      const bench = await makeExercise("hist-rows");

      await store(
        historySession(owner, new Date("2026-08-01T10:00:00Z"), [
          sets(
            bench,
            [
              { weightKg: 80, reps: 8 },
              { weightKg: 85, reps: 6 },
              { weightKg: 80, reps: 8 },
            ],
            new Date("2026-08-01T10:20:00Z"),
          ),
        ]),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.sessions).toHaveLength(1);
      expect(history.sessions[0]?.weightKg).toBe(85);
      expect(history.sessions[0]?.reps).toBe(6);
      expect(history.sessions[0]?.sessionName).toBe("Push Day");
    });

    it("orders sessions newest first and honours the limit", async () => {
      const owner = await makeUser("hist-limit");
      const bench = await makeExercise("hist-limit");

      for (const day of ["2026-08-01", "2026-08-08", "2026-08-15"]) {
        await store(
          historySession(owner, new Date(`${day}T10:00:00Z`), [
            sets(bench, [{ weightKg: 80, reps: 5 }], new Date(`${day}T10:20:00Z`)),
          ]),
        );
      }

      const history = await repository.exerciseHistoryForUser(owner, bench, 2);

      expect(history.sessions).toHaveLength(2);
      expect(history.sessions[0]?.performedAt.toISOString()).toBe("2026-08-15T10:00:00.000Z");
      expect(history.sessions[1]?.performedAt.toISOString()).toBe("2026-08-08T10:00:00.000Z");
    });

    it("never mixes in another exercise performed in the same session", async () => {
      const owner = await makeUser("hist-other");
      const bench = await makeExercise("hist-other-bench");
      const squat = await makeExercise("hist-other-squat");

      await store(
        historySession(owner, new Date("2026-08-01T10:00:00Z"), [
          sets(bench, [{ weightKg: 80, reps: 5 }], new Date("2026-08-01T10:20:00Z")),
          sets(squat, [{ weightKg: 140, reps: 5 }], new Date("2026-08-01T10:40:00Z")),
        ]),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.bestSet?.weightKg).toBe(80);
      expect(history.sessions[0]?.weightKg).toBe(80);
    });

    it("never reports another athlete's history for the same exercise", async () => {
      const owner = await makeUser("hist-owner");
      const stranger = await makeUser("hist-stranger");
      const bench = await makeExercise("hist-shared");

      await store(
        historySession(stranger, new Date("2026-08-01T10:00:00Z"), [
          sets(bench, [{ weightKg: 300, reps: 1 }], new Date("2026-08-01T10:20:00Z")),
        ]),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.bestSet).toBeNull();
      expect(history.sessions).toEqual([]);
    });

    it("ignores a session that was never completed", async () => {
      const owner = await makeUser("hist-inprogress");
      const bench = await makeExercise("hist-inprogress");

      await store(
        historySession(
          owner,
          new Date("2026-08-01T10:00:00Z"),
          [sets(bench, [{ weightKg: 90, reps: 5 }], new Date("2026-08-01T10:20:00Z"))],
          { status: "in_progress" },
        ),
      );

      const history = await repository.exerciseHistoryForUser(owner, bench, 8);

      expect(history.bestSet).toBeNull();
      expect(history.sessions).toEqual([]);
    });
  });

  describe("statsForUser", () => {
    const ZONE = "UTC";
    // A Thursday. Every fixture below is positioned relative to this instant.
    const NOW = new Date("2026-09-03T12:00:00Z");

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

    const withSet = (
      exerciseId: string,
      weightKg: number | null,
      reps: number | null,
      completedAt: Date,
      isCompleted = true,
    ): CreateWorkoutSessionExerciseInput => ({
      exerciseId,
      measure: "weight",
      notes: null,
      sets: [
        {
          type: "working",
          isCompleted,
          weightKg,
          reps,
          durationSeconds: null,
          distanceMeters: null,
          restSeconds: null,
          completedAt,
        },
      ],
    });

    const save = async (input: CreateWorkoutSessionInput) => {
      const saved = await repository.upsertSession(input);
      createdSessionIds.push(saved.id);
      return saved;
    };

    it("counts nothing at all for an account that has never trained", async () => {
      const owner = await makeUser("stats-empty");

      const stats = await repository.statsForUser(owner, ZONE, NOW);

      expect(stats.totalSessions).toBe(0);
      expect(stats.sessionsThisMonth).toBe(0);
      expect(stats.weekStreak).toBe(0);
      expect(stats.thisWeek.sessionCount).toBe(0);
      expect(stats.thisWeek.trainedWeekdays).toEqual([]);
      // Not a zero-weight record: this athlete has no record at all.
      expect(stats.recentPersonalRecord).toBeNull();
    });

    it("counts only this user's sessions", async () => {
      const owner = await makeUser("stats-mine");
      const stranger = await makeUser("stats-theirs");
      await save(sessionAt(owner, new Date("2026-09-01T10:00:00Z")));
      await save(sessionAt(stranger, new Date("2026-09-01T10:00:00Z")));

      const stats = await repository.statsForUser(owner, ZONE, NOW);

      expect(stats.totalSessions).toBe(1);
    });

    // An in-progress or cancelled session is not a workout the athlete did. Counting one
    // inflates every figure on Home at once.
    it("counts completed sessions only", async () => {
      const owner = await makeUser("stats-status");
      await save(sessionAt(owner, new Date("2026-09-01T10:00:00Z")));
      await save(sessionAt(owner, new Date("2026-09-01T12:00:00Z"), { status: "in_progress" }));
      await save(sessionAt(owner, new Date("2026-09-01T14:00:00Z"), { status: "cancelled" }));

      const stats = await repository.statsForUser(owner, ZONE, NOW);

      expect(stats.totalSessions).toBe(1);
    });

    it("counts this month from the first of the local month, not the last thirty days", async () => {
      const owner = await makeUser("stats-month");
      await save(sessionAt(owner, new Date("2026-09-01T10:00:00Z")));
      await save(sessionAt(owner, new Date("2026-09-02T10:00:00Z")));
      // Six days earlier, but the previous month -- inside a rolling thirty days and outside
      // "this month", which is the distinction being pinned.
      await save(sessionAt(owner, new Date("2026-08-28T10:00:00Z")));

      const stats = await repository.statsForUser(owner, ZONE, NOW);

      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsThisMonth).toBe(2);
    });

    // The week runs Monday to Sunday, matching the mobile app's own WEEK_DAYS strip.
    it("reports this week's sessions and which weekdays they fell on", async () => {
      const owner = await makeUser("stats-week");
      // 2026-08-31 is a Monday; 2026-09-02 a Wednesday.
      await save(sessionAt(owner, new Date("2026-08-31T10:00:00Z")));
      await save(sessionAt(owner, new Date("2026-09-02T10:00:00Z")));
      // The Sunday before that Monday belongs to the previous week.
      await save(sessionAt(owner, new Date("2026-08-30T10:00:00Z")));

      const stats = await repository.statsForUser(owner, ZONE, NOW);

      expect(stats.thisWeek.sessionCount).toBe(2);
      // Indexed like Date#getDay(): Monday is 1, Wednesday 3.
      expect(stats.thisWeek.trainedWeekdays).toEqual([1, 3]);
    });

    it("lights a weekday once however many times it was trained", async () => {
      const owner = await makeUser("stats-twice");
      await save(sessionAt(owner, new Date("2026-09-02T08:00:00Z")));
      await save(sessionAt(owner, new Date("2026-09-02T18:00:00Z")));

      const stats = await repository.statsForUser(owner, ZONE, NOW);

      expect(stats.thisWeek.sessionCount).toBe(2);
      expect(stats.thisWeek.trainedWeekdays).toEqual([3]);
    });

    // The zone is the whole reason it is a parameter. 2026-09-01T02:00Z is still 31 August in
    // New York, so the same row falls in a different month depending on it.
    it("resolves the calendar in the caller's zone, not the server's", async () => {
      const owner = await makeUser("stats-zone");
      await save(sessionAt(owner, new Date("2026-09-01T02:00:00Z")));

      const utc = await repository.statsForUser(owner, "UTC", NOW);
      const newYork = await repository.statsForUser(owner, "America/New_York", NOW);

      expect(utc.sessionsThisMonth).toBe(1);
      expect(newYork.sessionsThisMonth).toBe(0);
    });

    describe("weekStreak", () => {
      it("counts consecutive weeks back from the current one", async () => {
        const owner = await makeUser("stats-streak");
        await save(sessionAt(owner, new Date("2026-09-02T10:00:00Z"))); // this week
        await save(sessionAt(owner, new Date("2026-08-26T10:00:00Z"))); // last week
        await save(sessionAt(owner, new Date("2026-08-19T10:00:00Z"))); // the week before

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.weekStreak).toBe(3);
      });

      it("stops at the first missed week", async () => {
        const owner = await makeUser("stats-streak-gap");
        await save(sessionAt(owner, new Date("2026-09-02T10:00:00Z")));
        // The week of 2026-08-24 is skipped entirely.
        await save(sessionAt(owner, new Date("2026-08-19T10:00:00Z")));

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.weekStreak).toBe(1);
      });

      // Measured on a Monday morning, a streak that required *this* week would reset every
      // week before the athlete had any chance to train.
      it("survives a current week with nothing in it yet", async () => {
        const owner = await makeUser("stats-streak-grace");
        await save(sessionAt(owner, new Date("2026-08-26T10:00:00Z")));
        await save(sessionAt(owner, new Date("2026-08-19T10:00:00Z")));

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.weekStreak).toBe(2);
      });

      it("is zero once even the previous week is empty", async () => {
        const owner = await makeUser("stats-streak-stale");
        await save(sessionAt(owner, new Date("2026-08-19T10:00:00Z")));

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.weekStreak).toBe(0);
      });
    });

    describe("recentPersonalRecord", () => {
      it("names the record whose achievement is most recent, not the heaviest ever", async () => {
        const owner = await makeUser("stats-pr");
        const deadlift = await makeExercise("pr-deadlift");
        const squat = await makeExercise("pr-squat");

        await save(
          sessionAt(owner, new Date("2026-06-01T10:00:00Z"), {
            exercises: [withSet(deadlift, 180, 3, new Date("2026-06-01T10:20:00Z"))],
          }),
        );
        await save(
          sessionAt(owner, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(squat, 140, 5, new Date("2026-09-01T10:20:00Z"))],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        // The deadlift is heavier, but the squat is the record they most recently set.
        expect(stats.recentPersonalRecord?.exerciseId).toBe(squat);
        expect(stats.recentPersonalRecord?.weightKg).toBe(140);
        expect(stats.recentPersonalRecord?.reps).toBe(5);
      });

      // Repeating a lift does not re-set the record. Dating it to the latest repeat would make
      // the card silently change for no reason.
      it("dates a record to the first time it was reached, not the last", async () => {
        const owner = await makeUser("stats-pr-first");
        const bench = await makeExercise("pr-bench");

        await save(
          sessionAt(owner, new Date("2026-08-01T10:00:00Z"), {
            exercises: [withSet(bench, 100, 5, new Date("2026-08-01T10:20:00Z"))],
          }),
        );
        await save(
          sessionAt(owner, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(bench, 100, 5, new Date("2026-09-01T10:20:00Z"))],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.recentPersonalRecord?.achievedAt.toISOString()).toBe(
          "2026-08-01T10:20:00.000Z",
        );
      });

      it("ignores a set that was never completed", async () => {
        const owner = await makeUser("stats-pr-unticked");
        const bench = await makeExercise("pr-unticked");

        await save(
          sessionAt(owner, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(bench, 200, 1, new Date("2026-09-01T10:20:00Z"), false)],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.recentPersonalRecord).toBeNull();
      });

      it("ignores sets with no weight, which cannot be ranked against a lift", async () => {
        const owner = await makeUser("stats-pr-bw");
        const dips = await makeExercise("pr-dips");

        await save(
          sessionAt(owner, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(dips, null, 12, new Date("2026-09-01T10:20:00Z"))],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.recentPersonalRecord).toBeNull();
      });

      // A record reads "100 kg × 5". A weighted set with no rep count is not a lift anyone
      // holds a record at, and "100 kg × —" would be worse than reporting the next-best set
      // that has both halves.
      it("ignores a weighted set with no rep count, preferring one that has both halves", async () => {
        const owner = await makeUser("stats-pr-noreps");
        const bench = await makeExercise("pr-noreps");

        await save(
          sessionAt(owner, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(bench, 200, null, new Date("2026-09-01T10:20:00Z"))],
          }),
        );
        await save(
          sessionAt(owner, new Date("2026-09-02T10:00:00Z"), {
            exercises: [withSet(bench, 90, 5, new Date("2026-09-02T10:20:00Z"))],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.recentPersonalRecord?.weightKg).toBe(90);
        expect(stats.recentPersonalRecord?.reps).toBe(5);
      });

      it("carries the exercise name, so the card needs no second lookup", async () => {
        const owner = await makeUser("stats-pr-name");
        const bench = await makeExercise("pr-named");

        await save(
          sessionAt(owner, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(bench, 100, 5, new Date("2026-09-01T10:20:00Z"))],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.recentPersonalRecord?.exerciseName).toContain("Test pr-named");
      });

      it("never reports another athlete's record", async () => {
        const owner = await makeUser("stats-pr-owner");
        const stranger = await makeUser("stats-pr-stranger");
        const bench = await makeExercise("pr-shared");

        await save(
          sessionAt(stranger, new Date("2026-09-01T10:00:00Z"), {
            exercises: [withSet(bench, 300, 1, new Date("2026-09-01T10:20:00Z"))],
          }),
        );

        const stats = await repository.statsForUser(owner, ZONE, NOW);

        expect(stats.recentPersonalRecord).toBeNull();
      });
    });
  });
});
