import { ConflictException } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { Equipment, MuscleGroup } from "@forjd/domain";

import { exerciseFavourites, exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { ExercisesRepository } from "./exercises.repository";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is the database's
 * own conflict resolution (partial unique indexes, ON CONFLICT), which a mock would only
 * prove the test author's assumptions about. Same rationale as UsersRepository.spec.ts.
 */
describe("ExercisesRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ExercisesRepository;
  const createdUserEmails: string[] = [];
  const createdExerciseIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `exrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) {
      throw new Error("insert did not return a row");
    }
    return row.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new ExercisesRepository(db);
  });

  afterAll(async () => {
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    if (createdUserEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdUserEmails));
    }
    await pool.end();
  });

  const catalogueInput = (sourceId: string) => ({
    source: "free-exercise-db",
    sourceId,
    name: "Test Bench Press",
    slug: "test-bench-press",
    category: "strength" as const,
    goal: "hypertrophy" as const,
    measure: "weight" as const,
    primaryMuscles: ["chest"] as MuscleGroup[],
    secondaryMuscles: ["triceps"] as MuscleGroup[],
    equipment: ["barbell"] as Equipment[],
    force: "push" as const,
    level: "beginner" as const,
    mechanic: "compound" as const,
    instructions: ["Lie on the bench.", "Press the bar up."],
    imageKeys: [],
    description: null,
  });

  describe("upsertCatalogueExercise", () => {
    it("creates a catalogue exercise with ownerUserId null", async () => {
      const sourceId = `bench-${randomUUID()}`;

      const exercise = await repository.upsertCatalogueExercise(catalogueInput(sourceId));
      createdExerciseIds.push(exercise.id);

      expect(exercise.ownerUserId).toBeNull();
      expect(exercise.name).toBe("Test Bench Press");
      expect(exercise.primaryMuscles).toEqual(["chest"]);
      expect(exercise.source).toBe("free-exercise-db");
      expect(exercise.sourceId).toBe(sourceId);
    });

    it("is idempotent -- re-running against the same (source, sourceId) updates rather than duplicates", async () => {
      const sourceId = `bench-${randomUUID()}`;
      const first = await repository.upsertCatalogueExercise(catalogueInput(sourceId));
      createdExerciseIds.push(first.id);

      const second = await repository.upsertCatalogueExercise({
        ...catalogueInput(sourceId),
        description: "Updated on re-ingest",
      });

      expect(second.id).toBe(first.id);
      expect(second.description).toBe("Updated on re-ingest");
      await expect(
        db.select().from(exercises).where(eq(exercises.sourceId, sourceId)),
      ).resolves.toHaveLength(1);
    });
  });

  describe("findById", () => {
    it("returns the canonical Exercise shape for an existing row", async () => {
      const sourceId = `bench-${randomUUID()}`;
      const created = await repository.upsertCatalogueExercise(catalogueInput(sourceId));
      createdExerciseIds.push(created.id);

      const found = await repository.findById(created.id);

      expect(found).toMatchObject({ id: created.id, name: "Test Bench Press" });
    });

    it("returns null for an unknown id", async () => {
      await expect(repository.findById(randomUUID())).resolves.toBeNull();
    });

    it("returns null for a soft-deleted exercise", async () => {
      const userId = await makeUser("finddeleted");
      const created = await repository.createCustomExercise(userId, {
        name: `Deleted Exercise ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["dumbbell"],
        description: null,
      });
      createdExerciseIds.push(created.id);

      await repository.softDeleteCustomExercise(created.id, userId);

      await expect(repository.findById(created.id)).resolves.toBeNull();
    });
  });

  describe("createCustomExercise / updateCustomExercise / softDeleteCustomExercise", () => {
    it("creates a custom exercise owned by the given user", async () => {
      const userId = await makeUser("create");

      const exercise = await repository.createCustomExercise(userId, {
        name: `Landmine Press ${randomUUID()}`,
        category: "strength",
        goal: "hypertrophy",
        measure: "weight",
        primaryMuscles: ["shoulders"],
        equipment: ["barbell"],
        description: "Brace the core.",
      });
      createdExerciseIds.push(exercise.id);

      expect(exercise.ownerUserId).toBe(userId);
      expect(exercise.source).toBeNull();
      expect(exercise.sourceId).toBeNull();
    });

    /**
     * Mirrors `s_newExercise`'s duplicate-name toast
     * (docs/design/phase2-screen-specs.md #6.1) -- enforced here by the database's own
     * partial unique index, not only by a read-then-write check in a future service.
     */
    it("rejects a second custom exercise with the same name for the same owner, case-insensitively", async () => {
      const userId = await makeUser("dupe");
      const name = `Duplicate Test ${randomUUID()}`;

      const first = await repository.createCustomExercise(userId, {
        name,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(first.id);

      await expect(
        repository.createCustomExercise(userId, {
          name: name.toUpperCase(),
          category: "strength",
          goal: "strength",
          measure: "weight",
          primaryMuscles: ["chest"],
          equipment: ["barbell"],
          description: null,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("allows two different owners to use the same exercise name", async () => {
      const userA = await makeUser("owner-a");
      const userB = await makeUser("owner-b");
      const name = `Shared Name ${randomUUID()}`;

      const a = await repository.createCustomExercise(userA, {
        name,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(a.id);

      const b = await repository.createCustomExercise(userB, {
        name,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(b.id);

      expect(a.id).not.toBe(b.id);
    });

    it("allows re-using a name after the original is soft-deleted", async () => {
      const userId = await makeUser("reuse-name");
      const name = `Reusable Name ${randomUUID()}`;

      const first = await repository.createCustomExercise(userId, {
        name,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(first.id);
      await repository.softDeleteCustomExercise(first.id, userId);

      const second = await repository.createCustomExercise(userId, {
        name,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(second.id);

      expect(second.id).not.toBe(first.id);
    });

    it("updateCustomExercise returns null when the exercise is not owned by the caller", async () => {
      const owner = await makeUser("update-owner");
      const stranger = await makeUser("update-stranger");
      const exercise = await repository.createCustomExercise(owner, {
        name: `Owned Exercise ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(exercise.id);

      const result = await repository.updateCustomExercise(exercise.id, stranger, {
        description: "Hijacked",
      });

      expect(result).toBeNull();
      await expect(repository.findById(exercise.id)).resolves.toMatchObject({
        description: null,
      });
    });

    it("updateCustomExercise patches only the given fields", async () => {
      const userId = await makeUser("patch");
      const exercise = await repository.createCustomExercise(userId, {
        name: `Patch Target ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: "Original",
      });
      createdExerciseIds.push(exercise.id);

      const updated = await repository.updateCustomExercise(exercise.id, userId, {
        description: "Revised",
      });

      expect(updated?.description).toBe("Revised");
      expect(updated?.category).toBe("strength");
    });

    it("softDeleteCustomExercise returns false for a stranger's exercise and leaves it intact", async () => {
      const owner = await makeUser("delete-owner");
      const stranger = await makeUser("delete-stranger");
      const exercise = await repository.createCustomExercise(owner, {
        name: `Guarded Exercise ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        description: null,
      });
      createdExerciseIds.push(exercise.id);

      const result = await repository.softDeleteCustomExercise(exercise.id, stranger);

      expect(result).toBe(false);
      await expect(repository.findById(exercise.id)).resolves.not.toBeNull();
    });
  });

  describe("favourites", () => {
    it("addFavourite is idempotent -- adding the same favourite twice does not error", async () => {
      const userId = await makeUser("fav-idempotent");
      const exercise = await repository.upsertCatalogueExercise(catalogueInput(`fav-${randomUUID()}`));
      createdExerciseIds.push(exercise.id);

      await repository.addFavourite(userId, exercise.id);
      await repository.addFavourite(userId, exercise.id);

      await expect(
        db
          .select()
          .from(exerciseFavourites)
          .where(eq(exerciseFavourites.exerciseId, exercise.id)),
      ).resolves.toHaveLength(1);
    });

    it("isFavourite reflects add and remove", async () => {
      const userId = await makeUser("fav-toggle");
      const exercise = await repository.upsertCatalogueExercise(
        catalogueInput(`fav-toggle-${randomUUID()}`),
      );
      createdExerciseIds.push(exercise.id);

      await expect(repository.isFavourite(userId, exercise.id)).resolves.toBe(false);

      await repository.addFavourite(userId, exercise.id);
      await expect(repository.isFavourite(userId, exercise.id)).resolves.toBe(true);

      await repository.removeFavourite(userId, exercise.id);
      await expect(repository.isFavourite(userId, exercise.id)).resolves.toBe(false);
    });
  });
});
