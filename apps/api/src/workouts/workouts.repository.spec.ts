import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { workoutTemplates } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { CreateWorkoutTemplateInput, WorkoutsRepository } from "./workouts.repository";

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
});
