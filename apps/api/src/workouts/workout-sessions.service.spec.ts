import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { WorkoutSessionUploadRequest } from "@forjd/contracts";
import { Exercise, User, WorkoutSession } from "@forjd/domain";

import { encodeWorkoutSessionCursor } from "./workout-cursor";
import { WorkoutSessionsService } from "./workout-sessions.service";
import {
  CreateWorkoutSessionInput,
  ListWorkoutSessionsFilter,
  WorkoutSessionPage,
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

  const makeService = (
    workoutsRepository: WorkoutsRepository,
    exercisesRepository = makeExercisesRepository(),
  ) => new WorkoutSessionsService(workoutsRepository, exercisesRepository);

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
    it("uploads a session when every referenced exercise is visible, snapshotting each measure server-side", async () => {
      const repository = makeWorkoutsRepository({ upsertResult: session() });

      const result = await makeService(repository).upload(owner, validBody);

      expect(result.id).toBe(session().id);
      expect(repository.upsertCalls[0]?.exercises[0]?.measure).toBe("weight");
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
        city: "Alexandria",
        citySlug: "alexandria",
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
        city: "Alexandria",
        citySlug: "alexandria",
      });
      expect(repository.upsertCalls[0]?.exercises[0]).toMatchObject({
        notes: "explosive tempo",
      });
      expect(repository.upsertCalls[0]?.exercises[0]?.sets[0]).toMatchObject({
        restSeconds: 90,
        completedAt: new Date("2026-09-02T09:05:00.000Z"),
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
