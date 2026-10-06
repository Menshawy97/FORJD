import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import type { WorkoutSessionUploadRequest } from "@forjd/contracts";
import { Exercise, PrivacySettings, User, WorkoutSession } from "@forjd/domain";

import type { CityResolverService, ResolvedCity } from "../cities/city-resolver.service";
import type { PrCelebrationService } from "./pr-celebration.service";
import type { PrivacyService } from "../privacy/privacy.service";
import { encodeWorkoutSessionCursor } from "./workout-cursor";
import { WorkoutSessionsService } from "./workout-sessions.service";
import {
  CreateWorkoutSessionInput,
  ListWorkoutSessionsFilter,
  WorkoutExerciseHistoryRow,
  WorkoutSessionPage,
  WorkoutStatsRow,
  WorkoutsRepository,
} from "./workouts.repository";

/**
 * Every branch of the service's own policy, in isolation, against fake repositories -- the
 * `WorkoutsService` precedent, and the reason this file carries a 100% coverage pin in
 * `apps/api/package.json`. `WorkoutsRepository`'s own session methods are proven against
 * real Postgres in `workouts.repository.spec.ts`.
 */
describe("WorkoutSessionsService", () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const owner = { id: ownerId, email: "ada@example.com" } as User;
  const exerciseId = "22222222-2222-4222-8222-222222222222";

  const session = (overrides: Partial<WorkoutSession> = {}): WorkoutSession =>
    ({
      id: "33333333-3333-4333-8333-333333333333",
      userId: ownerId,
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
      exercises: [],
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    }) as WorkoutSession;

  const exercise = (overrides: Partial<Exercise> = {}): Exercise =>
    ({
      id: exerciseId,
      ownerUserId: null,
      name: "Bench Press",
      slug: "bench-press",
      category: "strength",
      goal: "hypertrophy",
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
      source: null,
      sourceId: null,
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    }) as Exercise;

  const makeWorkoutsRepository = (options: {
    templateDetail?: object | null;
    sessionDetail?: WorkoutSession | null;
    upsertResult?: WorkoutSession;
    page?: WorkoutSessionPage;
  } = {}) => {
    const upsertCalls: CreateWorkoutSessionInput[] = [];
    const listCalls: ListWorkoutSessionsFilter[] = [];
    const repository = {
      upsertCalls,
      listCalls,
      findByIdForUser: () => Promise.resolve(options.templateDetail ?? null),
      findSessionByIdForUser: () => Promise.resolve(options.sessionDetail ?? null),
      upsertSession: (input: CreateWorkoutSessionInput) => {
        upsertCalls.push(input);
        return Promise.resolve(options.upsertResult ?? session());
      },
      listSessionsForUser: (filter: ListWorkoutSessionsFilter) => {
        listCalls.push(filter);
        return Promise.resolve(options.page ?? { rows: [], hasMore: false });
      },
    };
    return repository as unknown as WorkoutsRepository & {
      upsertCalls: CreateWorkoutSessionInput[];
      listCalls: ListWorkoutSessionsFilter[];
    };
  };

  const makeExercisesRepository = (visible?: Map<string, Exercise>) => {
    const repository = {
      findManyVisibleForUser: (ids: string[]) =>
        Promise.resolve(visible ?? new Map(ids.map((id) => [id, exercise({ id })]))),
    };
    return repository as unknown as import("../exercises/exercises.repository").ExercisesRepository;
  };

  const makePrivacyService = (over: Partial<PrivacySettings> = {}) => {
    const calls: string[] = [];
    const service = {
      get: (userId: string) => {
        calls.push(userId);
        return Promise.resolve({
          publicProfile: false,
          leaderboardOptIn: false,
          locationForLeaderboard: false,
          ...over,
        } as PrivacySettings);
      },
    };
    return Object.assign(service as unknown as PrivacyService, { calls });
  };

  const OPTED_IN = { leaderboardOptIn: true, locationForLeaderboard: true } as const;

  const makeCityResolver = (result: ResolvedCity | null | Error = null) => {
    const calls: Array<[number, number]> = [];
    const service = {
      resolve: (latitude: number, longitude: number) => {
        calls.push([latitude, longitude]);
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return Object.assign(service as unknown as CityResolverService, { calls });
  };

  const makeCelebration = () => {
    const celebrate = jest.fn(async () => undefined);
    return Object.assign({ celebrate } as unknown as PrCelebrationService, { celebrate });
  };

  const makeService = (
    workoutsRepository: WorkoutsRepository,
    exercisesRepository = makeExercisesRepository(),
    privacyService: PrivacyService = makePrivacyService(),
    cityResolver: CityResolverService = makeCityResolver(),
    celebration: PrCelebrationService = makeCelebration(),
  ) => new WorkoutSessionsService(workoutsRepository, exercisesRepository, privacyService, cityResolver, celebration);

  const ALEXANDRIA: ResolvedCity = {
    name: "Alexandria",
    slug: "alexandria-eg-361058",
    countryCode: "EG",
    timezone: "Africa/Cairo",
  };

  const validBody: WorkoutSessionUploadRequest = {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Upper Push",
    activity: "strength",
    status: "completed",
    startedAt: "2026-09-02T09:00:00.000Z",
    durationSeconds: 1800,
    isLiveTracked: false,
    exercises: [
      {
        exerciseId,
        sets: [{ type: "working", isCompleted: true, weightKg: 100, reps: 8 }],
      },
    ],
  };

  describe("upload", () => {
    it("hands the stored session to the PR celebrator with the exercise names, and answers the upload as before", async () => {
      const stored = session();
      const celebration = makeCelebration();

      const result = await makeService(makeWorkoutsRepository({ upsertResult: stored }), undefined, undefined, undefined, celebration).upload(owner, validBody);

      expect(celebration.celebrate).toHaveBeenCalledWith(stored, new Map([[exerciseId, "Bench Press"]]));
      expect(result.id).toBe(stored.id);
    });

    it("uploads a session when every referenced exercise is visible, snapshotting each measure server-side", async () => {
      const repository = makeWorkoutsRepository({ upsertResult: session() });

      const result = await makeService(repository).upload(owner, validBody);

      expect(result.id).toBe(session().id);
      expect(repository.upsertCalls[0]?.exercises[0]?.measure).toBe("weight");
    });

    describe("a run summary (ADR-050)", () => {
      const run: NonNullable<WorkoutSessionUploadRequest["run"]> = {
        distanceMeters: 5012.4,
        movingSeconds: 1500,
        elevationGainMeters: 24.5,
        avgHeartRateBpm: 152,
        caloriesKcal: 298,
        caloriesSource: "watch",
        splits: [
          { index: 1, distanceMeters: 1000, durationSeconds: 304, avgHeartRateBpm: 148 },
          { index: 2, distanceMeters: 1000, durationSeconds: 311, avgHeartRateBpm: null },
        ],
      };
      const runBody: WorkoutSessionUploadRequest = { ...validBody, activity: "running", isLiveTracked: true, run };

      it("passes the whole summary on when the person allowed health data", async () => {
        const repository = makeWorkoutsRepository();
        const privacy = makePrivacyService({ healthDataConsent: true });

        await makeService(repository, makeExercisesRepository(), privacy).upload(owner, runBody);

        expect(repository.upsertCalls[0]?.run).toEqual(run);
        expect(privacy.calls).toEqual([ownerId]);
      });

      it("keeps distance, time, elevation and split times but drops heart rate and calories without consent", async () => {
        const repository = makeWorkoutsRepository();
        const privacy = makePrivacyService({ healthDataConsent: false });

        await makeService(repository, makeExercisesRepository(), privacy).upload(owner, runBody);

        expect(repository.upsertCalls[0]?.run).toEqual({
          distanceMeters: 5012.4,
          movingSeconds: 1500,
          elevationGainMeters: 24.5,
          avgHeartRateBpm: null,
          caloriesKcal: null,
          caloriesSource: null,
          splits: [
            { index: 1, distanceMeters: 1000, durationSeconds: 304, avgHeartRateBpm: null },
            { index: 2, distanceMeters: 1000, durationSeconds: 311, avgHeartRateBpm: null },
          ],
        });
      });

      it("treats estimated calories the same way, so the server keeps no health figure without consent", async () => {
        const repository = makeWorkoutsRepository();
        const estimated = { ...run, caloriesSource: "estimate" as const, avgHeartRateBpm: null, splits: [] };

        await makeService(repository).upload(owner, { ...runBody, run: estimated });

        expect(repository.upsertCalls[0]?.run?.caloriesKcal).toBeNull();
        expect(repository.upsertCalls[0]?.run?.caloriesSource).toBeNull();
      });

      it("fails closed when consent cannot be read, and still stores the run", async () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const repository = makeWorkoutsRepository();
        const privacy = { get: () => Promise.reject(new Error("db down")) } as unknown as PrivacyService;

        await makeService(repository, makeExercisesRepository(), privacy).upload(owner, runBody);

        expect(repository.upsertCalls[0]?.run?.avgHeartRateBpm).toBeNull();
        expect(repository.upsertCalls[0]?.run?.caloriesKcal).toBeNull();
        expect(repository.upsertCalls[0]?.run?.distanceMeters).toBe(5012.4);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
      });

      it("also fails closed when the consent read throws something that is not an Error", async () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const repository = makeWorkoutsRepository();
        const privacy = { get: () => Promise.reject("connection lost") } as unknown as PrivacyService;

        await makeService(repository, makeExercisesRepository(), privacy).upload(owner, runBody);

        expect(repository.upsertCalls[0]?.run?.avgHeartRateBpm).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("connection lost"));
        warn.mockRestore();
      });

      it("does not read consent for a run with no health figures in it", async () => {
        const repository = makeWorkoutsRepository();
        const privacy = makePrivacyService();
        const bare = {
          distanceMeters: 3000,
          movingSeconds: 1000,
          elevationGainMeters: null,
          avgHeartRateBpm: null,
          caloriesKcal: null,
          caloriesSource: null,
          splits: [{ index: 1, distanceMeters: 1000, durationSeconds: 300, avgHeartRateBpm: null }],
        };

        await makeService(repository, makeExercisesRepository(), privacy).upload(owner, { ...runBody, run: bare });

        expect(repository.upsertCalls[0]?.run).toEqual(bare);
        expect(privacy.calls).toEqual([]);
      });

      it("sends no summary for a session that had none", async () => {
        const repository = makeWorkoutsRepository();
        const privacy = makePrivacyService();

        await makeService(repository, makeExercisesRepository(), privacy).upload(owner, validBody);

        expect(repository.upsertCalls[0]?.run ?? null).toBeNull();
        expect(privacy.calls).toEqual([]);
      });
    });

    it("rejects with a 400 when a referenced exercise is not visible", async () => {
      const repository = makeWorkoutsRepository();
      const exercisesRepository = makeExercisesRepository(new Map());

      await expect(
        makeService(repository, exercisesRepository).upload(owner, validBody),
      ).rejects.toThrow(BadRequestException);
    });

    it("defaults weightKg and reps to null when the client omits them, and maps a still-in-progress session's null endedAt/completedAt through", async () => {
      const repository = makeWorkoutsRepository({
        upsertResult: session({
          endedAt: null,
          exercises: [
            {
              id: "ex-1",
              sessionId: session().id,
              exerciseId,
              orderIndex: 0,
              measure: "time",
              notes: null,
              sets: [
                {
                  id: "set-1",
                  sessionExerciseId: "ex-1",
                  setIndex: 0,
                  type: "working",
                  isCompleted: false,
                  weightKg: null,
                  reps: null,
                  durationSeconds: 45,
                  distanceMeters: null,
                  restSeconds: null,
                  completedAt: null,
                },
              ],
            },
          ],
        }) as unknown as WorkoutSession,
      });

      const result = await makeService(repository).upload(owner, {
        ...validBody,
        exercises: [{ exerciseId, sets: [{ type: "working", isCompleted: false }] }],
      });

      expect(result.endedAt).toBeNull();
      expect(result.exercises[0]?.sets[0]?.weightKg).toBeNull();
      expect(result.exercises[0]?.sets[0]?.completedAt).toBeNull();
      expect(repository.upsertCalls[0]?.exercises[0]?.sets[0]).toMatchObject({
        weightKg: null,
        reps: null,
      });
    });

    it("accepts a session with no exercises", async () => {
      const repository = makeWorkoutsRepository({ upsertResult: session({ exercises: [] }) });
      const exercisesRepository = makeExercisesRepository(new Map());

      await expect(
        makeService(repository, exercisesRepository).upload(owner, { ...validBody, exercises: [] }),
      ).resolves.toMatchObject({ id: session().id });
    });

    it("accepts a templateId the caller can see, and forwards it to the repository", async () => {
      const repository = makeWorkoutsRepository({
        templateDetail: { id: "template-1" },
        upsertResult: session({ templateId: "template-1" }),
      });

      await makeService(repository).upload(owner, { ...validBody, templateId: "template-1" });

      expect(repository.upsertCalls[0]?.templateId).toBe("template-1");
    });

    it("rejects with a 400 when templateId is not visible to the caller", async () => {
      const repository = makeWorkoutsRepository({ templateDetail: null });

      await expect(
        makeService(repository).upload(owner, { ...validBody, templateId: "template-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("forwards optional fields when the client supplies all of them", async () => {
      const repository = makeWorkoutsRepository();

      await makeService(repository).upload(owner, {
        ...validBody,
        endedAt: "2026-09-02T09:30:00.000Z",
        perceivedEffort: "solid",
        notes: "felt strong",
        exercises: [
          {
            exerciseId,
            notes: "explosive tempo",
            sets: [
              {
                type: "working",
                isCompleted: true,
                weightKg: 100,
                reps: 8,
                durationSeconds: 4,
                distanceMeters: 0,
                restSeconds: 90,
                completedAt: "2026-09-02T09:05:00.000Z",
              },
            ],
          },
        ],
      });

      expect(repository.upsertCalls[0]).toMatchObject({
        endedAt: new Date("2026-09-02T09:30:00.000Z"),
        perceivedEffort: "solid",
        notes: "felt strong",
      });
      expect(repository.upsertCalls[0]?.exercises[0]).toMatchObject({
        notes: "explosive tempo",
      });
      expect(repository.upsertCalls[0]?.exercises[0]?.sets[0]).toMatchObject({
        restSeconds: 90,
        completedAt: new Date("2026-09-02T09:05:00.000Z"),
      });
    });

    describe("city (Phase 10, ADR-048): derived on the server, never taken from the client", () => {
      const at = { latitude: 31.2, longitude: 29.92 };

      it("resolves the city from the start position for an athlete who opted in to both", async () => {
        const repository = makeWorkoutsRepository();
        const resolver = makeCityResolver(ALEXANDRIA);

        await makeService(repository, undefined, makePrivacyService(OPTED_IN), resolver).upload(owner, {
          ...validBody,
          startLocation: at,
        });

        expect(resolver.calls).toEqual([[31.2, 29.92]]);
        expect(repository.upsertCalls[0]).toMatchObject({ city: "Alexandria", citySlug: "alexandria-eg-361058" });
      });

      it("ignores a city and slug the client sends, because the slug is a ranking key", async () => {
        const repository = makeWorkoutsRepository();

        await makeService(repository, undefined, makePrivacyService(OPTED_IN), makeCityResolver(ALEXANDRIA)).upload(
          owner,
          { ...validBody, startLocation: at, city: "Hacker Town", citySlug: "hacker-town" },
        );

        expect(repository.upsertCalls[0]).toMatchObject({ city: "Alexandria", citySlug: "alexandria-eg-361058" });
      });

      it("stores no city when the client sends only its own city and no position", async () => {
        const repository = makeWorkoutsRepository();

        await makeService(repository, undefined, makePrivacyService(OPTED_IN)).upload(owner, {
          ...validBody,
          city: "Hacker Town",
          citySlug: "hacker-town",
        });

        expect(repository.upsertCalls[0]).toMatchObject({ city: null, citySlug: null });
      });

      it("does not read privacy or resolve anything when there is no position", async () => {
        const repository = makeWorkoutsRepository();
        const privacy = makePrivacyService(OPTED_IN);
        const resolver = makeCityResolver(ALEXANDRIA);

        await makeService(repository, undefined, privacy, resolver).upload(owner, validBody);
        await makeService(repository, undefined, privacy, resolver).upload(owner, { ...validBody, startLocation: null });

        expect(privacy.calls).toEqual([]);
        expect(resolver.calls).toEqual([]);
      });

      it("stores no city for an athlete who has not joined leaderboards, and does not resolve", async () => {
        const repository = makeWorkoutsRepository();
        const resolver = makeCityResolver(ALEXANDRIA);

        await makeService(repository, undefined, makePrivacyService(), resolver).upload(owner, {
          ...validBody,
          startLocation: at,
        });

        expect(resolver.calls).toEqual([]);
        expect(repository.upsertCalls[0]).toMatchObject({ city: null, citySlug: null });
      });

      it("stores no city when the athlete joined leaderboards but did not allow location", async () => {
        const repository = makeWorkoutsRepository();
        const resolver = makeCityResolver(ALEXANDRIA);

        await makeService(
          repository,
          undefined,
          makePrivacyService({ leaderboardOptIn: true, locationForLeaderboard: false }),
          resolver,
        ).upload(owner, { ...validBody, startLocation: at });

        expect(resolver.calls).toEqual([]);
        expect(repository.upsertCalls[0]).toMatchObject({ city: null, citySlug: null });
      });

      it("stores no city when no city is within reach of the position", async () => {
        const repository = makeWorkoutsRepository();

        await makeService(repository, undefined, makePrivacyService(OPTED_IN), makeCityResolver(null)).upload(owner, {
          ...validBody,
          startLocation: { latitude: 0, longitude: -30 },
        });

        expect(repository.upsertCalls[0]).toMatchObject({ city: null, citySlug: null });
      });

      it("reads the athlete's consent on every upload rather than remembering it", async () => {
        const repository = makeWorkoutsRepository();
        const privacy = makePrivacyService(OPTED_IN);
        const service = makeService(repository, undefined, privacy, makeCityResolver(ALEXANDRIA));

        await service.upload(owner, { ...validBody, startLocation: at });
        await service.upload(owner, { ...validBody, startLocation: at });

        expect(privacy.calls).toEqual([owner.id, owner.id]);
      });

      it("never writes the coordinates anywhere: only the city reaches the repository", async () => {
        const repository = makeWorkoutsRepository();

        await makeService(repository, undefined, makePrivacyService(OPTED_IN), makeCityResolver(ALEXANDRIA)).upload(
          owner,
          { ...validBody, startLocation: { latitude: 31.2017, longitude: 29.9158 } },
        );

        const stored = JSON.stringify(repository.upsertCalls);
        expect(stored).not.toContain("31.2017");
        expect(stored).not.toContain("29.9158");
        expect(repository.upsertCalls[0]).not.toHaveProperty("startLocation");
      });

      it("still saves the workout when the city lookup fails, with no city, and logs it without the position", async () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const repository = makeWorkoutsRepository();

        const saved = await makeService(
          repository,
          undefined,
          makePrivacyService(OPTED_IN),
          makeCityResolver(new Error("snapshot missing")),
        ).upload(owner, { ...validBody, startLocation: { latitude: 31.2017, longitude: 29.9158 } });

        expect(saved).toBeDefined();
        expect(repository.upsertCalls).toHaveLength(1);
        expect(repository.upsertCalls[0]).toMatchObject({ city: null, citySlug: null });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("snapshot missing");
        expect(String(warn.mock.calls[0]?.[0])).not.toContain("31.2017");
        warn.mockRestore();
      });

      it("also saves the workout when the consent read fails, rather than losing it", async () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const repository = makeWorkoutsRepository();
        const failing = { get: () => Promise.reject(new Error("db down")) } as unknown as PrivacyService;

        await makeService(repository, undefined, failing, makeCityResolver(ALEXANDRIA)).upload(owner, {
          ...validBody,
          startLocation: at,
        });

        expect(repository.upsertCalls[0]).toMatchObject({ city: null, citySlug: null });
        expect(String(warn.mock.calls[0]?.[0])).toContain("db down");
        warn.mockRestore();
      });

      it("logs a non-Error failure too", async () => {
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const failing = { get: () => Promise.reject("boom") } as unknown as PrivacyService;

        await makeService(makeWorkoutsRepository(), undefined, failing).upload(owner, { ...validBody, startLocation: at });

        expect(String(warn.mock.calls[0]?.[0])).toContain("boom");
        warn.mockRestore();
      });
    });
  });

  describe("getById", () => {
    it("returns the full detail for the caller's own session", async () => {
      const repository = makeWorkoutsRepository({
        sessionDetail: session({
          exercises: [
            {
              id: "ex-1",
              sessionId: session().id,
              exerciseId,
              orderIndex: 0,
              measure: "weight",
              notes: null,
              sets: [
                {
                  id: "set-1",
                  sessionExerciseId: "ex-1",
                  setIndex: 0,
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
        }) as unknown as WorkoutSession,
      });

      const result = await makeService(repository).getById(owner, session().id);

      expect(result.exercises).toHaveLength(1);
      expect(result.exercises[0]?.sets[0]?.weightKg).toBe(100);
      expect(result.exercises[0]?.sets[0]?.completedAt).toBe("2026-09-02T09:05:00.000Z");
    });

    it("throws a 404 for a malformed id, never reaching the repository", async () => {
      const repository = makeWorkoutsRepository();

      await expect(makeService(repository).getById(owner, "not-a-uuid")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws a 404 when the repository returns null", async () => {
      const repository = makeWorkoutsRepository({ sessionDetail: null });

      await expect(makeService(repository).getById(owner, session().id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // Phase 3J-c. The arithmetic itself lives in the repository and is proven against real
  // Postgres; what is tested here is the service's own small job -- passing the caller's zone
  // and identity through, and turning `Date`s into the ISO strings the contract declares.
  describe("stats", () => {
    const statsRow: WorkoutStatsRow = {
      totalSessions: 42,
      sessionsThisMonth: 6,
      weekStreak: 3,
      thisWeek: { sessionCount: 2, trainedWeekdays: [1, 3] },
      recentPersonalRecord: {
        exerciseId,
        exerciseName: "Bench Press",
        weightKg: 100,
        reps: 5,
        achievedAt: new Date("2026-09-01T09:05:00.000Z"),
      },
    };

    const makeStatsRepository = (row = statsRow) => {
      const calls: Array<{ userId: string; timeZone: string }> = [];
      const repository = {
        statsForUser: (userId: string, timeZone: string) => {
          calls.push({ userId, timeZone });
          return Promise.resolve(row);
        },
      };
      return Object.assign(repository as unknown as WorkoutsRepository, { statsCalls: calls });
    };

    it("serialises the record's achievedAt as an ISO string, per the contract", async () => {
      const repository = makeStatsRepository();

      const result = await makeService(repository).stats(owner, { timeZone: "Africa/Cairo" });

      expect(result.recentPersonalRecord?.achievedAt).toBe("2026-09-01T09:05:00.000Z");
      expect(result.totalSessions).toBe(42);
      expect(result.thisWeek).toEqual({ sessionCount: 2, trainedWeekdays: [1, 3] });
    });

    // The zone decides which month, week and weekday every figure falls in -- dropping it here
    // would silently answer in UTC for everyone.
    it("passes the caller's zone and only the caller's own id to the repository", async () => {
      const repository = makeStatsRepository();

      await makeService(repository).stats(owner, { timeZone: "Africa/Cairo" });

      expect(repository.statsCalls).toEqual([{ userId: ownerId, timeZone: "Africa/Cairo" }]);
    });

    it("carries a null record through rather than inventing an empty one", async () => {
      const repository = makeStatsRepository({ ...statsRow, recentPersonalRecord: null });

      const result = await makeService(repository).stats(owner, { timeZone: "UTC" });

      expect(result.recentPersonalRecord).toBeNull();
    });
  });

  // Phase 3J-d. The SQL is proven against real Postgres in `workouts.repository.spec.ts`;
  // what is tested here is this service's own two jobs -- refusing a malformed id before it
  // becomes a query, and serialising as ISO strings the `Date`s the contract declares.
  describe("exerciseHistory", () => {
    const historyRow: WorkoutExerciseHistoryRow = {
      bestSet: { weightKg: 100, reps: 3, achievedAt: new Date("2026-08-08T10:20:00.000Z") },
      // Standard Epley, 100 x 3: 100 * (1 + 3/30) = 110 (ADR-038, R29 audit remediation).
      estimatedOneRepMaxKg: 110,
      sessions: [
        {
          sessionId: "33333333-3333-4333-8333-333333333333",
          sessionName: "Push Day",
          performedAt: new Date("2026-08-08T10:00:00.000Z"),
          weightKg: 100,
          reps: 3,
        },
      ],
    };

    const makeHistoryRepository = (row = historyRow) => {
      const calls: Array<{ userId: string; exerciseId: string; limit: number }> = [];
      const repository = {
        exerciseHistoryForUser: (userId: string, exId: string, limit: number) => {
          calls.push({ userId, exerciseId: exId, limit });
          return Promise.resolve(row);
        },
      };
      return Object.assign(repository as unknown as WorkoutsRepository, { historyCalls: calls });
    };

    it("serialises both timestamps as ISO strings, per the contract", async () => {
      const repository = makeHistoryRepository();

      const result = await makeService(repository).exerciseHistory(owner, exerciseId, { limit: 8 });

      expect(result.bestSet?.achievedAt).toBe("2026-08-08T10:20:00.000Z");
      expect(result.sessions[0]?.performedAt).toBe("2026-08-08T10:00:00.000Z");
      expect(result.estimatedOneRepMaxKg).toBe(110);
    });

    it("scopes the read to the caller and forwards the limit", async () => {
      const repository = makeHistoryRepository();

      await makeService(repository).exerciseHistory(owner, exerciseId, { limit: 3 });

      expect(repository.historyCalls).toEqual([{ userId: ownerId, exerciseId, limit: 3 }]);
    });

    // A best set can exist while its estimate does not -- Epley refuses past twelve reps. The
    // two fields are independent, and the screen renders an em dash for the missing one.
    it("carries a null estimate through beside a real best set", async () => {
      const repository = makeHistoryRepository({ ...historyRow, estimatedOneRepMaxKg: null });

      const result = await makeService(repository).exerciseHistory(owner, exerciseId, { limit: 8 });

      expect(result.bestSet).not.toBeNull();
      expect(result.estimatedOneRepMaxKg).toBeNull();
    });

    it("reports an exercise never performed as empty rather than inventing zeroes", async () => {
      const repository = makeHistoryRepository({
        bestSet: null,
        estimatedOneRepMaxKg: null,
        sessions: [],
      });

      const result = await makeService(repository).exerciseHistory(owner, exerciseId, { limit: 8 });

      expect(result.bestSet).toBeNull();
      expect(result.sessions).toEqual([]);
    });

    // Same guard as `getById`: a malformed id is refused here and never becomes a query.
    it("refuses a malformed exercise id before it reaches Postgres", async () => {
      const repository = makeHistoryRepository();

      await expect(
        makeService(repository).exerciseHistory(owner, "not-a-uuid", { limit: 8 }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.historyCalls).toEqual([]);
    });
  });

  describe("list", () => {
    it("returns an envelope with items and a null cursor when there is no next page", async () => {
      const repository = makeWorkoutsRepository({
        page: {
          rows: [
            {
              id: session().id,
              name: "Upper Push",
              activity: "strength",
              status: "completed",
              startedAt: new Date("2026-09-02T09:00:00.000Z"),
              endedAt: new Date("2026-09-02T09:30:00.000Z"),
              durationSeconds: 1800,
              perceivedEffort: "solid",
            },
          ],
          hasMore: false,
        },
      });

      const result = await makeService(repository).list(owner, { limit: 50 });

      expect(result.nextCursor).toBeNull();
      expect(result.items[0]).toEqual({
        id: session().id,
        name: "Upper Push",
        activity: "strength",
        status: "completed",
        startedAt: "2026-09-02T09:00:00.000Z",
        endedAt: "2026-09-02T09:30:00.000Z",
        durationSeconds: 1800,
        perceivedEffort: "solid",
      });
    });

    it("mints a cursor from the last row when another page exists", async () => {
      const lastRow = {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Zzz Last",
        activity: "strength" as const,
        status: "completed" as const,
        startedAt: new Date("2026-08-01T09:00:00.000Z"),
        endedAt: null,
        durationSeconds: 600,
        perceivedEffort: null,
      };
      const repository = makeWorkoutsRepository({ page: { rows: [lastRow], hasMore: true } });

      const result = await makeService(repository).list(owner, { limit: 1 });

      expect(result.nextCursor).toBe(
        encodeWorkoutSessionCursor({
          startedAt: lastRow.startedAt.toISOString(),
          id: lastRow.id,
        }),
      );
      expect(result.items[0]?.endedAt).toBeNull();
    });

    it("decodes a cursor and forwards it to the repository", async () => {
      const repository = makeWorkoutsRepository();
      const cursor = encodeWorkoutSessionCursor({
        startedAt: "2026-09-02T09:00:00.000Z",
        id: session().id,
      });

      await makeService(repository).list(owner, { cursor, limit: 50 });

      expect(repository.listCalls[0]?.after).toEqual({
        startedAt: "2026-09-02T09:00:00.000Z",
        id: session().id,
      });
    });

    it("rejects an unreadable cursor with a 400, never reaching the repository", async () => {
      const repository = makeWorkoutsRepository();

      await expect(
        makeService(repository).list(owner, { cursor: "garbage", limit: 50 }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.listCalls).toHaveLength(0);
    });
  });
});
