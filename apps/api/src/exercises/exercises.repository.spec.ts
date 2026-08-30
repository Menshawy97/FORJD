import { ConflictException } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { Equipment, MuscleGroup } from "@forjd/domain";

import { exerciseFavourites, exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import { ExercisesRepository, UpsertCatalogueExerciseInput } from "./exercises.repository";

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

  /**
   * Browse, search and paginate -- Phase E's read path.
   *
   * **Isolation.** These run against whatever is in the database, which is an empty
   * `exercises` table in CI and a fully loaded 873-row catalogue on a developer machine that
   * has run `exercises:load`. Every assertion therefore filters by a per-test marker token
   * embedded in the seeded names, so a test asserting "three results, in this order" means
   * three of *its own* rows rather than three of whatever happened to sort first. The one
   * thing that cannot be isolated that way is `q` itself, which is why the search tests seed
   * deliberately unusual names and search within the marker as well.
   */
  describe("listExercises", () => {
    /**
     * A token that appears in no real exercise name, so `q: marker` selects exactly the rows
     * a single test seeded. New per test, not per suite -- two tests seeding into a shared
     * marker would see each other's rows and the failure would look like a query bug.
     */
    const newMarker = (): string => `zqx${randomUUID().replace(/-/g, "").slice(0, 12)}`;

    const seedCatalogue = async (
      marker: string,
      name: string,
      overrides: Partial<UpsertCatalogueExerciseInput> = {},
    ) => {
      const exercise = await repository.upsertCatalogueExercise({
        ...catalogueInput(`list-${randomUUID()}`),
        name: `${marker} ${name}`,
        ...overrides,
      });
      createdExerciseIds.push(exercise.id);
      return exercise;
    };

    const seedCustom = async (ownerUserId: string, marker: string, name: string) => {
      const exercise = await repository.createCustomExercise(ownerUserId, {
        name: `${marker} ${name}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["dumbbell"],
        description: null,
      });
      createdExerciseIds.push(exercise.id);
      return exercise;
    };

    const names = (rows: { exercise: { name: string } }[]): string[] =>
      rows.map((row) => row.exercise.name);

    describe("visibility", () => {
      it("returns catalogue exercises", async () => {
        const userId = await makeUser("list-catalogue");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");

        const page = await repository.listExercises({ userId, q: marker, limit: 10 });

        expect(names(page.rows)).toEqual([`${marker} Alpha`]);
      });

      it("returns the caller's own custom exercises alongside the catalogue", async () => {
        const userId = await makeUser("list-own");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");
        await seedCustom(userId, marker, "Bravo");

        const page = await repository.listExercises({ userId, q: marker, limit: 10 });

        expect(names(page.rows)).toEqual([`${marker} Alpha`, `${marker} Bravo`]);
      });

      /**
       * The sharpest rule in the read path. A custom exercise is private to its author, and
       * the list is the one place a stranger's row could leak in bulk rather than one id at
       * a time.
       */
      it("never returns another user's custom exercise", async () => {
        const owner = await makeUser("list-owner");
        const stranger = await makeUser("list-stranger");
        const marker = newMarker();
        await seedCustom(owner, marker, "Private");

        const page = await repository.listExercises({ userId: stranger, q: marker, limit: 10 });

        expect(page.rows).toHaveLength(0);
      });

      it("excludes a soft-deleted exercise", async () => {
        const userId = await makeUser("list-deleted");
        const marker = newMarker();
        const kept = await seedCustom(userId, marker, "Kept");
        const removed = await seedCustom(userId, marker, "Removed");
        await repository.softDeleteCustomExercise(removed.id, userId);

        const page = await repository.listExercises({ userId, q: marker, limit: 10 });

        expect(names(page.rows)).toEqual([kept.name]);
      });
    });

    describe("favourites", () => {
      it("reports isFavourite per row for the calling user", async () => {
        const userId = await makeUser("list-fav");
        const marker = newMarker();
        const starred = await seedCatalogue(marker, "Alpha");
        await seedCatalogue(marker, "Bravo");
        await repository.addFavourite(userId, starred.id);

        const page = await repository.listExercises({ userId, q: marker, limit: 10 });

        expect(page.rows.map((row) => [row.exercise.name, row.isFavourite])).toEqual([
          [`${marker} Alpha`, true],
          [`${marker} Bravo`, false],
        ]);
      });

      /** A favourite is a fact about a (user, exercise) pair, not about the exercise. */
      it("does not report another user's favourite as the caller's", async () => {
        const owner = await makeUser("list-fav-owner");
        const other = await makeUser("list-fav-other");
        const marker = newMarker();
        const exercise = await seedCatalogue(marker, "Alpha");
        await repository.addFavourite(other, exercise.id);

        const page = await repository.listExercises({ userId: owner, q: marker, limit: 10 });

        expect(page.rows[0]?.isFavourite).toBe(false);
      });

      it("narrows to favourites only when asked", async () => {
        const userId = await makeUser("list-fav-only");
        const marker = newMarker();
        const starred = await seedCatalogue(marker, "Alpha");
        await seedCatalogue(marker, "Bravo");
        await repository.addFavourite(userId, starred.id);

        const page = await repository.listExercises({
          userId,
          q: marker,
          favouriteOnly: true,
          limit: 10,
        });

        expect(names(page.rows)).toEqual([`${marker} Alpha`]);
      });

      it("returns nothing for a favourites filter with nothing starred", async () => {
        const userId = await makeUser("list-fav-empty");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");

        const page = await repository.listExercises({
          userId,
          q: marker,
          favouriteOnly: true,
          limit: 10,
        });

        expect(page.rows).toHaveLength(0);
      });
    });

    describe("filters", () => {
      it("filters by category", async () => {
        const userId = await makeUser("list-category");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha", { category: "strength" });
        await seedCatalogue(marker, "Bravo", { category: "mobility" });

        const page = await repository.listExercises({
          userId,
          q: marker,
          category: "mobility",
          limit: 10,
        });

        expect(names(page.rows)).toEqual([`${marker} Bravo`]);
      });

      it("filters by equipment", async () => {
        const userId = await makeUser("list-equipment");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha", { equipment: ["barbell"] });
        await seedCatalogue(marker, "Bravo", { equipment: ["kettlebell", "dumbbell"] });

        const page = await repository.listExercises({
          userId,
          q: marker,
          equipment: "kettlebell",
          limit: 10,
        });

        expect(names(page.rows)).toEqual([`${marker} Bravo`]);
      });

      it("filters by primary muscle", async () => {
        const userId = await makeUser("list-muscle");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha", { primaryMuscles: ["chest"] });
        await seedCatalogue(marker, "Bravo", { primaryMuscles: ["quads", "glutes"] });

        const page = await repository.listExercises({
          userId,
          q: marker,
          muscle: "glutes",
          limit: 10,
        });

        expect(names(page.rows)).toEqual([`${marker} Bravo`]);
      });

      /**
       * Primary only, deliberately. Almost every pressing movement lists triceps and
       * shoulders as secondary, so including them would make the "Chest" chip return most of
       * the upper-body catalogue and the chip would stop meaning anything.
       */
      it("does not match on a secondary muscle", async () => {
        const userId = await makeUser("list-secondary");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha", {
          primaryMuscles: ["chest"],
          secondaryMuscles: ["triceps"],
        });

        const page = await repository.listExercises({
          userId,
          q: marker,
          muscle: "triceps",
          limit: 10,
        });

        expect(page.rows).toHaveLength(0);
      });

      it("applies every filter together rather than any of them", async () => {
        const userId = await makeUser("list-combined");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha", {
          category: "strength",
          primaryMuscles: ["chest"],
          equipment: ["barbell"],
        });
        await seedCatalogue(marker, "Bravo", {
          category: "strength",
          primaryMuscles: ["chest"],
          equipment: ["dumbbell"],
        });

        const page = await repository.listExercises({
          userId,
          q: marker,
          category: "strength",
          muscle: "chest",
          equipment: "dumbbell",
          limit: 10,
        });

        expect(names(page.rows)).toEqual([`${marker} Bravo`]);
      });
    });

    describe("search", () => {
      it("matches a whole word in the name", async () => {
        const userId = await makeUser("search-word");
        const marker = newMarker();
        await seedCatalogue(marker, "Bulgarian Split Squat");
        await seedCatalogue(marker, "Overhead Press");

        const page = await repository.listExercises({
          userId,
          q: `${marker} squat`,
          limit: 10,
        });

        expect(names(page.rows)).toEqual([`${marker} Bulgarian Split Squat`]);
      });

      /**
       * The trigram index exists for exactly this: somebody types four letters into the
       * search box and expects results before they finish the word. Full-text search alone
       * matches lexemes, so a prefix fragment finds nothing.
       */
      it("matches a partial word, which full-text search alone would miss", async () => {
        const userId = await makeUser("search-partial");
        const marker = newMarker();
        await seedCatalogue(marker, "Bulgarian Split Squat");

        const page = await repository.listExercises({ userId, q: "bulgar", limit: 100 });

        expect(names(page.rows)).toContain(`${marker} Bulgarian Split Squat`);
      });

      it("is case-insensitive", async () => {
        const userId = await makeUser("search-case");
        const marker = newMarker();
        await seedCatalogue(marker, `Bulgarian Split Squat`);

        const page = await repository.listExercises({
          userId,
          q: marker.toUpperCase(),
          limit: 10,
        });

        expect(names(page.rows)).toContain(`${marker} Bulgarian Split Squat`);
      });

      /**
       * `%` and `_` are wildcards to LIKE, and a search term reaches an ILIKE pattern. If the
       * term were interpolated rather than bound and escaped, searching for `%` would return
       * the entire catalogue.
       */
      it("treats a LIKE wildcard in the search term as a literal character", async () => {
        const userId = await makeUser("search-wildcard");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");

        const page = await repository.listExercises({ userId, q: "%", limit: 100 });

        expect(names(page.rows)).not.toContain(`${marker} Alpha`);
      });

      it("finds nothing for a term that matches nothing", async () => {
        const userId = await makeUser("search-miss");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");

        const page = await repository.listExercises({
          userId,
          q: `${marker} nonexistentterm`,
          limit: 10,
        });

        expect(page.rows).toHaveLength(0);
      });
    });

    describe("ordering and pagination", () => {
      it("orders by name", async () => {
        const userId = await makeUser("list-order");
        const marker = newMarker();
        await seedCatalogue(marker, "Charlie");
        await seedCatalogue(marker, "Alpha");
        await seedCatalogue(marker, "Bravo");

        const page = await repository.listExercises({ userId, q: marker, limit: 10 });

        expect(names(page.rows)).toEqual([
          `${marker} Alpha`,
          `${marker} Bravo`,
          `${marker} Charlie`,
        ]);
      });

      it("reports hasMore and returns exactly the requested number of rows", async () => {
        const userId = await makeUser("list-hasmore");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");
        await seedCatalogue(marker, "Bravo");
        await seedCatalogue(marker, "Charlie");

        const page = await repository.listExercises({ userId, q: marker, limit: 2 });

        expect(names(page.rows)).toEqual([`${marker} Alpha`, `${marker} Bravo`]);
        expect(page.hasMore).toBe(true);
      });

      it("reports hasMore false on the last page", async () => {
        const userId = await makeUser("list-lastpage");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");
        await seedCatalogue(marker, "Bravo");

        const page = await repository.listExercises({ userId, q: marker, limit: 2 });

        expect(page.rows).toHaveLength(2);
        expect(page.hasMore).toBe(false);
      });

      it("resumes after the cursor row, with no repeat and no gap", async () => {
        const userId = await makeUser("list-cursor");
        const marker = newMarker();
        await seedCatalogue(marker, "Alpha");
        const bravo = await seedCatalogue(marker, "Bravo");
        await seedCatalogue(marker, "Charlie");

        const second = await repository.listExercises({
          userId,
          q: marker,
          limit: 2,
          after: { name: bravo.name, id: bravo.id },
        });

        expect(names(second.rows)).toEqual([`${marker} Charlie`]);
        expect(second.hasMore).toBe(false);
      });

      /**
       * Two exercises can share a name -- a user is free to name a custom exercise exactly
       * what a catalogue row is called. With `name` alone as the sort key the pair has no
       * defined order, and a cursor pointing at the first of them would either skip the
       * second or return it forever. The id tiebreaker is what makes the keyset total.
       */
      it("paginates deterministically through rows that share a name", async () => {
        const userId = await makeUser("list-tie");
        const marker = newMarker();
        await seedCatalogue(marker, "Twin");
        await seedCatalogue(marker, "Twin");
        await seedCatalogue(marker, "Twin");

        const first = await repository.listExercises({ userId, q: marker, limit: 2 });
        const last = first.rows[first.rows.length - 1];
        if (!last) {
          throw new Error("expected a first page");
        }
        const second = await repository.listExercises({
          userId,
          q: marker,
          limit: 2,
          after: { name: last.exercise.name, id: last.exercise.id },
        });

        const seen = [...first.rows, ...second.rows].map((row) => row.exercise.id);
        expect(seen).toHaveLength(3);
        expect(new Set(seen).size).toBe(3);
      });

      it("keeps the filters applied across a cursor", async () => {
        const userId = await makeUser("list-cursor-filter");
        const marker = newMarker();
        const alpha = await seedCatalogue(marker, "Alpha", { category: "mobility" });
        await seedCatalogue(marker, "Bravo", { category: "strength" });
        await seedCatalogue(marker, "Charlie", { category: "mobility" });

        const page = await repository.listExercises({
          userId,
          q: marker,
          category: "mobility",
          limit: 10,
          after: { name: alpha.name, id: alpha.id },
        });

        expect(names(page.rows)).toEqual([`${marker} Charlie`]);
      });
    });
  });

  describe("findByIdForUser", () => {
    it("returns a catalogue exercise with its favourite state", async () => {
      const userId = await makeUser("detail-catalogue");
      const exercise = await repository.upsertCatalogueExercise(
        catalogueInput(`detail-${randomUUID()}`),
      );
      createdExerciseIds.push(exercise.id);
      await repository.addFavourite(userId, exercise.id);

      const found = await repository.findByIdForUser(exercise.id, userId);

      expect(found?.exercise.id).toBe(exercise.id);
      expect(found?.isFavourite).toBe(true);
    });

    it("reports isFavourite false when the caller has not starred it", async () => {
      const userId = await makeUser("detail-unstarred");
      const exercise = await repository.upsertCatalogueExercise(
        catalogueInput(`detail-${randomUUID()}`),
      );
      createdExerciseIds.push(exercise.id);

      const found = await repository.findByIdForUser(exercise.id, userId);

      expect(found?.isFavourite).toBe(false);
    });

    it("returns the caller's own custom exercise", async () => {
      const userId = await makeUser("detail-own");
      const created = await repository.createCustomExercise(userId, {
        name: `Own Exercise ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["dumbbell"],
        description: null,
      });
      createdExerciseIds.push(created.id);

      await expect(repository.findByIdForUser(created.id, userId)).resolves.toMatchObject({
        exercise: { id: created.id },
      });
    });

    /** Null, not a row -- turning this into a 404 rather than a 403 is the service's job. */
    it("returns null for another user's custom exercise", async () => {
      const owner = await makeUser("detail-owner");
      const stranger = await makeUser("detail-stranger");
      const created = await repository.createCustomExercise(owner, {
        name: `Private Exercise ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["dumbbell"],
        description: null,
      });
      createdExerciseIds.push(created.id);

      await expect(repository.findByIdForUser(created.id, stranger)).resolves.toBeNull();
    });

    it("returns null for a soft-deleted exercise", async () => {
      const userId = await makeUser("detail-deleted");
      const created = await repository.createCustomExercise(userId, {
        name: `Deleted Detail ${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["dumbbell"],
        description: null,
      });
      createdExerciseIds.push(created.id);
      await repository.softDeleteCustomExercise(created.id, userId);

      await expect(repository.findByIdForUser(created.id, userId)).resolves.toBeNull();
    });

    it("returns null for an unknown id", async () => {
      const userId = await makeUser("detail-unknown");

      await expect(repository.findByIdForUser(randomUUID(), userId)).resolves.toBeNull();
    });
  });
});
