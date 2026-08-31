import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CreateExerciseRequest } from "@forjd/contracts";
import { Exercise, User } from "@forjd/domain";

import { encodeExerciseCursor } from "./exercise-cursor";
import {
  CreateCustomExerciseInput,
  ExercisePage,
  ExercisesRepository,
  ListExercisesFilter,
  UpdateCustomExerciseInput,
} from "./exercises.repository";
import { ExercisesService } from "./exercises.service";

/**
 * Every branch of the read policy, in isolation, against a fake repository -- the
 * `AthletesService` precedent, and the reason this file carries a 100% coverage pin in
 * `apps/api/package.json`. The repository's own behaviour is proven against real Postgres in
 * `exercises.repository.spec.ts`; what is proven here is the decision the service makes with
 * what the repository returns, which is where a refusal turns into a 404 and a storage key
 * turns into a URL.
 */
describe("ExercisesService", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const viewer = { id: userId, email: "ada@example.com" } as User;
  const MEDIA_BASE = "https://media.example.com/exercise-media";

  const exercise = (overrides: Partial<Exercise> = {}): Exercise =>
    ({
      id: "22222222-2222-4222-8222-222222222222",
      ownerUserId: null,
      name: "Barbell Bench Press",
      slug: "barbell-bench-press",
      category: "strength",
      goal: "hypertrophy",
      measure: "weight",
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps"],
      equipment: ["barbell"],
      force: "push",
      level: "beginner",
      mechanic: "compound",
      instructions: ["Lie on the bench."],
      imageKeys: ["Barbell_Bench_Press/0.jpg", "Barbell_Bench_Press/1.jpg"],
      description: null,
      source: "free-exercise-db",
      sourceId: "Barbell_Bench_Press",
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    }) as Exercise;

  /** Captures the filter it was called with, so the service's translation can be asserted. */
  const makeRepository = (
    page: ExercisePage = { rows: [], hasMore: false },
    detail: { exercise: Exercise; isFavourite: boolean } | null = null,
  ) => {
    const calls: ListExercisesFilter[] = [];
    const repository = {
      calls,
      listExercises: (filter: ListExercisesFilter) => {
        calls.push(filter);
        return Promise.resolve(page);
      },
      findByIdForUser: () => Promise.resolve(detail),
    };
    return repository as unknown as ExercisesRepository & { calls: ListExercisesFilter[] };
  };

  const makeService = (
    repository: ExercisesRepository,
    // Explicitly `null` for "not configured", never `undefined`: passing `undefined` to a
    // parameter with a default silently selects the default, and the two tests that assert
    // unconfigured media would have been asserting the configured path instead.
    mediaBaseUrl: string | null = MEDIA_BASE,
  ) =>
    new ExercisesService(repository, {
      get: () => mediaBaseUrl ?? undefined,
    } as unknown as ConfigService);

  describe("list", () => {
    it("returns an envelope with items and a null cursor when there is no next page", async () => {
      const repository = makeRepository({
        rows: [{ exercise: exercise(), isFavourite: false }],
        hasMore: false,
      });

      const result = await makeService(repository).list(viewer, { limit: 50 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("returns an empty envelope rather than an error when nothing matches", async () => {
      const result = await makeService(makeRepository()).list(viewer, { limit: 50 });

      expect(result).toEqual({ items: [], nextCursor: null });
    });

    /** The cursor names the last row of *this* page, which is where the next one resumes. */
    it("mints a cursor from the last row when more results exist", async () => {
      const last = exercise({ id: "33333333-3333-4333-8333-333333333333", name: "Zercher Squat" });
      const repository = makeRepository({
        rows: [
          { exercise: exercise(), isFavourite: false },
          { exercise: last, isFavourite: false },
        ],
        hasMore: true,
      });

      const result = await makeService(repository).list(viewer, { limit: 2 });

      expect(result.nextCursor).toBe(encodeExerciseCursor({ name: last.name, id: last.id }));
    });

    it("passes a decoded cursor to the repository as the keyset position", async () => {
      const repository = makeRepository();
      const cursor = encodeExerciseCursor({ name: "Front Squat", id: exercise().id });

      await makeService(repository).list(viewer, { limit: 50, cursor });

      expect(repository.calls[0]?.after).toEqual({ name: "Front Squat", id: exercise().id });
    });

    /**
     * A cursor the server did not mint is a client bug, and 400 says so. Silently ignoring it
     * would restart the list from the top, which a paging loop reads as "more results" -- and
     * it would page forever.
     */
    it("refuses an unreadable cursor rather than silently starting over", async () => {
      const service = makeService(makeRepository());

      await expect(service.list(viewer, { limit: 50, cursor: "tampered" })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("passes every filter through to the repository", async () => {
      const repository = makeRepository();

      await makeService(repository).list(viewer, {
        limit: 25,
        q: "bench",
        category: "strength",
        muscle: "chest",
        equipment: "barbell",
        favourite: true,
      });

      expect(repository.calls[0]).toMatchObject({
        userId,
        limit: 25,
        q: "bench",
        category: "strength",
        muscle: "chest",
        equipment: "barbell",
        favouriteOnly: true,
      });
    });

    /**
     * `favourite=false` means "do not filter", not "show me things I have not starred". The
     * repository takes a boolean, so the distinction has to be made here or the query would
     * silently narrow to favourites -- see the contract's own note on `z.coerce.boolean()`.
     */
    it("treats favourite=false as no favourites filter", async () => {
      const repository = makeRepository();

      await makeService(repository).list(viewer, { limit: 50, favourite: false });

      expect(repository.calls[0]?.favouriteOnly).toBeFalsy();
    });

    it("scopes the query to the calling user", async () => {
      const repository = makeRepository();

      await makeService(repository).list(viewer, { limit: 50 });

      expect(repository.calls[0]?.userId).toBe(userId);
    });

    it("projects a summary with the first image resolved to a URL", async () => {
      const repository = makeRepository({
        rows: [{ exercise: exercise(), isFavourite: true }],
        hasMore: false,
      });

      const [item] = (await makeService(repository).list(viewer, { limit: 50 })).items;

      expect(item).toEqual({
        id: "22222222-2222-4222-8222-222222222222",
        name: "Barbell Bench Press",
        slug: "barbell-bench-press",
        category: "strength",
        measure: "weight",
        primaryMuscles: ["chest"],
        equipment: ["barbell"],
        imageUrl: `${MEDIA_BASE}/Barbell_Bench_Press/0.jpg`,
        isCustom: false,
        isFavourite: true,
      });
    });

    it("reports a custom exercise as custom", async () => {
      const repository = makeRepository({
        rows: [{ exercise: exercise({ ownerUserId: userId, imageKeys: [] }), isFavourite: false }],
        hasMore: false,
      });

      const [item] = (await makeService(repository).list(viewer, { limit: 50 })).items;

      expect(item?.isCustom).toBe(true);
      expect(item?.imageUrl).toBeNull();
    });

    /**
     * Phase F mirrors the media and sets the base URL. Until then the column holds keys that
     * resolve to nothing, and a half-built URL rendered as a broken image is worse than no
     * image: `expo-image` cannot tell "not configured" from "404".
     */
    it("returns a null image when no media base URL is configured", async () => {
      const repository = makeRepository({
        rows: [{ exercise: exercise(), isFavourite: false }],
        hasMore: false,
      });

      const [item] = (await makeService(repository, null).list(viewer, { limit: 50 })).items;

      expect(item?.imageUrl).toBeNull();
    });

    it("does not double the separator when the base URL ends in a slash", async () => {
      const repository = makeRepository({
        rows: [{ exercise: exercise(), isFavourite: false }],
        hasMore: false,
      });

      const [item] = (await makeService(repository, `${MEDIA_BASE}/`).list(viewer, { limit: 50 }))
        .items;

      expect(item?.imageUrl).toBe(`${MEDIA_BASE}/Barbell_Bench_Press/0.jpg`);
    });
  });

  describe("getCatalogue", () => {
    const makeSyncRepository = (rows: ReturnType<typeof exercise>[]) => {
      const withFavourite = rows.map((row) => ({ exercise: row, isFavourite: false }));
      return {
        listForSync: () => Promise.resolve(withFavourite),
      } as unknown as ExercisesRepository;
    };

    it("returns every row as a full detail, not a summary", async () => {
      const repository = makeSyncRepository([exercise()]);

      const result = await makeService(repository).getCatalogue(viewer);

      expect(result.exercises[0]).toHaveProperty("instructions");
      expect(result.exercises[0]).toHaveProperty("imageUrls");
    });

    it("returns an empty catalogue with a version rather than throwing", async () => {
      const repository = makeSyncRepository([]);

      const result = await makeService(repository).getCatalogue(viewer);

      expect(result.exercises).toEqual([]);
      expect(typeof result.catalogueVersion).toBe("string");
      expect(result.catalogueVersion.length).toBeGreaterThan(0);
    });

    it("returns the same version for the same set of rows, called twice", async () => {
      const rows = [exercise()];
      const repository = makeSyncRepository(rows);
      const service = makeService(repository);

      const first = await service.getCatalogue(viewer);
      const second = await service.getCatalogue(viewer);

      expect(first.catalogueVersion).toBe(second.catalogueVersion);
    });

    it("changes the version when a row's updatedAt changes", async () => {
      const repositoryBefore = makeSyncRepository([exercise({ updatedAt: new Date("2026-01-01") })]);
      const repositoryAfter = makeSyncRepository([exercise({ updatedAt: new Date("2026-06-01") })]);

      const before = await makeService(repositoryBefore).getCatalogue(viewer);
      const after = await makeService(repositoryAfter).getCatalogue(viewer);

      expect(before.catalogueVersion).not.toBe(after.catalogueVersion);
    });

    it("changes the version when a row is added or removed", async () => {
      const one = exercise({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      const two = exercise({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });

      const withOne = await makeService(makeSyncRepository([one])).getCatalogue(viewer);
      const withBoth = await makeService(makeSyncRepository([one, two])).getCatalogue(viewer);

      expect(withOne.catalogueVersion).not.toBe(withBoth.catalogueVersion);
    });

    /**
     * Deliberate: hashing `isFavourite` in would force a full re-sync of the whole catalogue
     * on every star tap. The mobile store is expected to write a favourite toggle into its
     * own local mirror directly after the favourite endpoint succeeds, not wait for this.
     */
    it("does not change the version when only favourite status differs", async () => {
      const row = exercise();
      const favourited = { listForSync: () => Promise.resolve([{ exercise: row, isFavourite: true }]) } as unknown as ExercisesRepository;
      const unfavourited = { listForSync: () => Promise.resolve([{ exercise: row, isFavourite: false }]) } as unknown as ExercisesRepository;

      const a = await makeService(favourited).getCatalogue(viewer);
      const b = await makeService(unfavourited).getCatalogue(viewer);

      expect(a.catalogueVersion).toBe(b.catalogueVersion);
    });
  });

  describe("getById", () => {
    it("returns the full exercise with every image resolved", async () => {
      const repository = makeRepository(undefined, {
        exercise: exercise(),
        isFavourite: true,
      });

      const result = await makeService(repository).getById(viewer, exercise().id);

      expect(result).toEqual({
        id: "22222222-2222-4222-8222-222222222222",
        name: "Barbell Bench Press",
        slug: "barbell-bench-press",
        category: "strength",
        goal: "hypertrophy",
        measure: "weight",
        primaryMuscles: ["chest"],
        secondaryMuscles: ["triceps"],
        equipment: ["barbell"],
        force: "push",
        level: "beginner",
        mechanic: "compound",
        instructions: ["Lie on the bench."],
        imageUrls: [
          `${MEDIA_BASE}/Barbell_Bench_Press/0.jpg`,
          `${MEDIA_BASE}/Barbell_Bench_Press/1.jpg`,
        ],
        description: null,
        isCustom: false,
        isFavourite: true,
      });
    });

    it("returns an empty image list when no media base URL is configured", async () => {
      const repository = makeRepository(undefined, { exercise: exercise(), isFavourite: false });

      const result = await makeService(repository, null).getById(viewer, exercise().id);

      expect(result.imageUrls).toEqual([]);
    });

    it("reports the caller's own exercise as custom", async () => {
      const repository = makeRepository(undefined, {
        exercise: exercise({ ownerUserId: userId }),
        isFavourite: false,
      });

      const result = await makeService(repository).getById(viewer, exercise().id);

      expect(result.isCustom).toBe(true);
    });

    /**
     * 404, never 403 -- the `AthletesService` precedent. A 403 would confirm that an id names
     * a real exercise somebody else authored, making the endpoint an oracle for enumerating
     * other users' private content.
     */
    it("refuses with a 404 when the repository returns nothing", async () => {
      const service = makeService(makeRepository(undefined, null));

      await expect(service.getById(viewer, exercise().id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * A malformed id would reach a `uuid` column and raise a Postgres cast error, surfacing
     * as a 500 -- a third, distinguishable response, which is exactly what one refusal shape
     * exists to prevent.
     */
    it("refuses a malformed id without querying the database at all", async () => {
      const repository = makeRepository(undefined, { exercise: exercise(), isFavourite: false });
      let queried = false;
      (repository as unknown as { findByIdForUser: () => unknown }).findByIdForUser = () => {
        queried = true;
        return Promise.resolve(null);
      };

      await expect(makeService(repository).getById(viewer, "not-a-uuid")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(queried).toBe(false);
    });

    it("uses the same message for a missing exercise as for a malformed id", async () => {
      const service = makeService(makeRepository(undefined, null));

      const missing = await service.getById(viewer, exercise().id).catch((error: Error) => error);
      const malformed = await service.getById(viewer, "not-a-uuid").catch((error: Error) => error);

      expect((missing as Error).message).toBe((malformed as Error).message);
    });
  });

  describe("create", () => {
    const body: CreateExerciseRequest = {
      name: "Landmine Press",
      category: "strength",
      measure: "weight",
      primaryMuscles: ["shoulders"],
      equipment: ["barbell"],
      description: "Brace the core.",
    };

    /** Records the exact input passed through, so the goal-derivation call can be asserted. */
    const makeCreateRepository = (created: Exercise) => {
      const calls: Array<{ ownerUserId: string; input: CreateCustomExerciseInput }> = [];
      const repository = {
        calls,
        createCustomExercise: (ownerUserId: string, input: CreateCustomExerciseInput) => {
          calls.push({ ownerUserId, input });
          return Promise.resolve(created);
        },
      };
      return repository as unknown as ExercisesRepository & { calls: typeof calls };
    };

    it("derives hypertrophy for a weight-measured exercise, never trusting a client-sent goal", async () => {
      const repository = makeCreateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).create(viewer, body);

      expect(repository.calls[0]?.input.goal).toBe("hypertrophy");
    });

    it("derives muscular_endurance for a non-weight measure", async () => {
      const repository = makeCreateRepository(exercise({ ownerUserId: userId, measure: "time" }));

      await makeService(repository).create(viewer, { ...body, measure: "time" });

      expect(repository.calls[0]?.input.goal).toBe("muscular_endurance");
    });

    it("passes ownerUserId as the viewer's own id", async () => {
      const repository = makeCreateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).create(viewer, body);

      expect(repository.calls[0]?.ownerUserId).toBe(userId);
    });

    it("defaults an absent description to null", async () => {
      const repository = makeCreateRepository(exercise({ ownerUserId: userId }));
      const withoutDescription: CreateExerciseRequest = {
        name: body.name,
        category: body.category,
        measure: body.measure,
        primaryMuscles: body.primaryMuscles,
        equipment: body.equipment,
      };

      await makeService(repository).create(viewer, withoutDescription);

      expect(repository.calls[0]?.input.description).toBeNull();
    });

    it("returns the created exercise as never-yet-favourited, without querying for it", async () => {
      const created = exercise({ ownerUserId: userId });
      const repository = makeCreateRepository(created);

      const result = await makeService(repository).create(viewer, body);

      expect(result.isFavourite).toBe(false);
      expect(result.isCustom).toBe(true);
    });

    /** A duplicate name is the repository's job (the partial unique index); the service just relays it. */
    it("propagates a duplicate-name rejection from the repository", async () => {
      const repository = {
        createCustomExercise: () => Promise.reject(new ConflictException("An exercise with that name already exists")),
      } as unknown as ExercisesRepository;

      await expect(makeService(repository).create(viewer, body)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("update", () => {
    const makeUpdateRepository = (
      updated: Exercise | null,
      favourite = false,
    ) => {
      const calls: Array<{ id: string; ownerUserId: string; patch: UpdateCustomExerciseInput }> = [];
      const repository = {
        calls,
        updateCustomExercise: (id: string, ownerUserId: string, patch: UpdateCustomExerciseInput) => {
          calls.push({ id, ownerUserId, patch });
          return Promise.resolve(updated);
        },
        isFavourite: () => Promise.resolve(favourite),
      };
      return repository as unknown as ExercisesRepository & { calls: typeof calls };
    };

    it("refuses a malformed id without querying the repository", async () => {
      let called = false;
      const repository = {
        updateCustomExercise: () => {
          called = true;
          return Promise.resolve(null);
        },
      } as unknown as ExercisesRepository;

      await expect(makeService(repository).update(viewer, "not-a-uuid", {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(called).toBe(false);
    });

    it("refuses when the repository finds nothing to update -- unknown id or someone else's exercise", async () => {
      const repository = makeUpdateRepository(null);

      await expect(
        makeService(repository).update(viewer, exercise().id, { name: "New Name" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("only sends the fields present in the patch", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { name: "New Name" });

      expect(repository.calls[0]?.patch).toEqual({ name: "New Name" });
    });

    it("passes category through when present in the patch", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { category: "mobility" });

      expect(repository.calls[0]?.patch).toEqual({ category: "mobility" });
    });

    it("passes primaryMuscles through when present in the patch", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { primaryMuscles: ["core"] });

      expect(repository.calls[0]?.patch).toEqual({ primaryMuscles: ["core"] });
    });

    it("passes equipment through when present in the patch", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { equipment: ["kettlebell"] });

      expect(repository.calls[0]?.patch).toEqual({ equipment: ["kettlebell"] });
    });

    it("re-derives goal when measure changes", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { measure: "distance" });

      expect(repository.calls[0]?.patch).toEqual({ measure: "distance", goal: "muscular_endurance" });
    });

    it("leaves goal untouched when measure is not part of the patch", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { name: "New Name" });

      expect(repository.calls[0]?.patch).not.toHaveProperty("goal");
    });

    it("converts an explicit null description in the patch to null, not undefined", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }));

      await makeService(repository).update(viewer, exercise().id, { description: null });

      expect(repository.calls[0]?.patch).toEqual({ description: null });
    });

    it("looks up the current favourite status rather than assuming it", async () => {
      const repository = makeUpdateRepository(exercise({ ownerUserId: userId }), true);

      const result = await makeService(repository).update(viewer, exercise().id, { name: "New Name" });

      expect(result.isFavourite).toBe(true);
    });
  });

  describe("delete", () => {
    it("refuses a malformed id without querying the repository", async () => {
      let called = false;
      const repository = {
        softDeleteCustomExercise: () => {
          called = true;
          return Promise.resolve(false);
        },
      } as unknown as ExercisesRepository;

      await expect(makeService(repository).delete(viewer, "not-a-uuid")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(called).toBe(false);
    });

    it("refuses when the repository deleted nothing -- unknown id or someone else's exercise", async () => {
      const repository = {
        softDeleteCustomExercise: () => Promise.resolve(false),
      } as unknown as ExercisesRepository;

      await expect(
        makeService(repository).delete(viewer, exercise().id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("resolves with no value when the repository confirms a delete", async () => {
      const repository = {
        softDeleteCustomExercise: () => Promise.resolve(true),
      } as unknown as ExercisesRepository;

      await expect(makeService(repository).delete(viewer, exercise().id)).resolves.toBeUndefined();
    });
  });

  describe("setFavourite", () => {
    it("refuses a malformed id without querying the repository", async () => {
      let called = false;
      const repository = {
        findByIdForUser: () => {
          called = true;
          return Promise.resolve(null);
        },
      } as unknown as ExercisesRepository;

      await expect(
        makeService(repository).setFavourite(viewer, "not-a-uuid", true),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(called).toBe(false);
    });

    /**
     * The existence-and-visibility check every other write in this file relies on -- skipping
     * it would let a bogus id reach the `exercise_favourites` foreign key and surface as a
     * raw 500 instead of this clean 404.
     */
    it("refuses a favourite on an exercise the viewer cannot see", async () => {
      const repository = {
        findByIdForUser: () => Promise.resolve(null),
      } as unknown as ExercisesRepository;

      await expect(
        makeService(repository).setFavourite(viewer, exercise().id, true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("calls addFavourite when favouriting", async () => {
      let called: [string, string] | null = null;
      const repository = {
        findByIdForUser: () => Promise.resolve({ exercise: exercise(), isFavourite: false }),
        addFavourite: (userId2: string, exerciseId: string) => {
          called = [userId2, exerciseId];
          return Promise.resolve();
        },
      } as unknown as ExercisesRepository;

      await makeService(repository).setFavourite(viewer, exercise().id, true);

      expect(called).toEqual([userId, exercise().id]);
    });

    it("calls removeFavourite when unfavouriting", async () => {
      let called: [string, string] | null = null;
      const repository = {
        findByIdForUser: () => Promise.resolve({ exercise: exercise(), isFavourite: true }),
        removeFavourite: (userId2: string, exerciseId: string) => {
          called = [userId2, exerciseId];
          return Promise.resolve();
        },
      } as unknown as ExercisesRepository;

      await makeService(repository).setFavourite(viewer, exercise().id, false);

      expect(called).toEqual([userId, exercise().id]);
    });
  });
});
