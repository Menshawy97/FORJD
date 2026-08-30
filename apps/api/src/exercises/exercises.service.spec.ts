import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Exercise, User } from "@forjd/domain";

import { encodeExerciseCursor } from "./exercise-cursor";
import { ExercisePage, ExercisesRepository, ListExercisesFilter } from "./exercises.repository";
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
});
