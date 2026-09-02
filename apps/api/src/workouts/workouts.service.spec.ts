import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CreateWorkoutTemplateRequest } from "@forjd/contracts";
import { User, WorkoutTemplate } from "@forjd/domain";

import { encodeWorkoutTemplateCursor } from "./workout-cursor";
import {
  ListWorkoutTemplatesFilter,
  UpdateWorkoutTemplateInput,
  WorkoutTemplatePage,
  WorkoutsRepository,
} from "./workouts.repository";
import { WorkoutsService } from "./workouts.service";

/**
 * Every branch of the service's own policy, in isolation, against fake repositories -- the
 * `ExercisesService` precedent, and the reason this file carries a 100% coverage pin in
 * `apps/api/package.json`. `WorkoutsRepository`'s own behaviour is proven against real
 * Postgres in `workouts.repository.spec.ts`; what is proven here is the decision the service
 * makes with what the repository returns -- a `null` becomes a 404, an unreadable cursor
 * becomes a 400, an unknown exercise reference becomes a 400.
 */
describe("WorkoutsService", () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const owner = { id: ownerId, email: "ada@example.com" } as User;

  const template = (overrides: Partial<WorkoutTemplate> = {}): WorkoutTemplate =>
    ({
      id: "22222222-2222-4222-8222-222222222222",
      ownerUserId: ownerId,
      name: "Upper Push",
      activity: "strength",
      basedOnTemplateId: null,
      notes: null,
      estimatedDurationMinutes: 52,
      blocks: [],
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    }) as WorkoutTemplate;

  const makeWorkoutsRepository = (options: {
    page?: WorkoutTemplatePage;
    detail?: WorkoutTemplate | null;
    createResult?: WorkoutTemplate;
    updateResult?: WorkoutTemplate | null;
    softDeleteResult?: boolean;
  } = {}) => {
    const listCalls: ListWorkoutTemplatesFilter[] = [];
    const updateCalls: UpdateWorkoutTemplateInput[] = [];
    const createCalls: import("./workouts.repository").CreateWorkoutTemplateInput[] = [];
    const repository = {
      listCalls,
      updateCalls,
      createCalls,
      listForUser: (filter: ListWorkoutTemplatesFilter) => {
        listCalls.push(filter);
        return Promise.resolve(options.page ?? { rows: [], hasMore: false });
      },
      findByIdForUser: () => Promise.resolve(options.detail ?? null),
      createTemplate: (
        _ownerUserId: string,
        input: import("./workouts.repository").CreateWorkoutTemplateInput,
      ) => {
        createCalls.push(input);
        return Promise.resolve(options.createResult ?? template());
      },
      updateTemplate: (_id: string, _ownerUserId: string, patch: UpdateWorkoutTemplateInput) => {
        updateCalls.push(patch);
        return Promise.resolve("updateResult" in options ? options.updateResult : template());
      },
      softDeleteTemplate: () => Promise.resolve(options.softDeleteResult ?? true),
    };
    return repository as unknown as WorkoutsRepository & {
      listCalls: ListWorkoutTemplatesFilter[];
      updateCalls: UpdateWorkoutTemplateInput[];
      createCalls: import("./workouts.repository").CreateWorkoutTemplateInput[];
    };
  };

  /** `visible` defaults to "every id the caller passes in is visible" -- the common case. */
  const makeExercisesRepository = (visible?: Set<string>) => {
    const repository = {
      findVisibleIds: (ids: string[]) => Promise.resolve(visible ?? new Set(ids)),
    };
    return repository as unknown as import("../exercises/exercises.repository").ExercisesRepository;
  };

  const makeService = (
    workoutsRepository: WorkoutsRepository,
    exercisesRepository = makeExercisesRepository(),
  ) => new WorkoutsService(workoutsRepository, exercisesRepository);

  const validCreateBody: CreateWorkoutTemplateRequest = {
    name: "Upper Push",
    activity: "strength",
    blocks: [
      {
        type: "straight_sets",
        exercises: [
          {
            exerciseId: "33333333-3333-4333-8333-333333333333",
            setCount: 4,
            targetReps: 8,
            targetWeightKg: 80,
          },
        ],
      },
    ],
  };

  describe("list", () => {
    it("returns an envelope with items and a null cursor when there is no next page", async () => {
      const repository = makeWorkoutsRepository({
        page: {
          rows: [
            {
              id: template().id,
              ownerUserId: null,
              name: "Upper Push",
              activity: "strength",
              estimatedDurationMinutes: 52,
              exerciseCount: 6,
              basedOnTemplateId: null,
            },
          ],
          hasMore: false,
        },
      });

      const result = await makeService(repository).list(owner, { limit: 50 });

      expect(result.nextCursor).toBeNull();
      expect(result.items).toEqual([
        {
          id: template().id,
          name: "Upper Push",
          activity: "strength",
          estimatedDurationMinutes: 52,
          exerciseCount: 6,
          isCustom: false,
          basedOnTemplateId: null,
        },
      ]);
    });

    it("mints a cursor from the last row when another page exists", async () => {
      const lastRow = {
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: ownerId,
        name: "Zzz Last",
        activity: "strength" as const,
        estimatedDurationMinutes: null,
        exerciseCount: 3,
        basedOnTemplateId: null,
      };
      const repository = makeWorkoutsRepository({ page: { rows: [lastRow], hasMore: true } });

      const result = await makeService(repository).list(owner, { limit: 1 });

      expect(result.nextCursor).toBe(
        encodeWorkoutTemplateCursor({ name: lastRow.name, id: lastRow.id }),
      );
      expect(result.items[0]?.isCustom).toBe(true);
    });

    it("decodes a cursor and forwards it to the repository", async () => {
      const repository = makeWorkoutsRepository();
      const cursor = encodeWorkoutTemplateCursor({ name: "Upper Push", id: template().id });

      await makeService(repository).list(owner, { cursor, limit: 50 });

      expect(repository.listCalls[0]?.after).toEqual({ name: "Upper Push", id: template().id });
    });

    it("rejects an unreadable cursor with a 400, never reaching the repository", async () => {
      const repository = makeWorkoutsRepository();

      await expect(makeService(repository).list(owner, { cursor: "garbage", limit: 50 })).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.listCalls).toHaveLength(0);
    });
  });

  describe("getById", () => {
    it("returns the full detail for a visible template", async () => {
      const repository = makeWorkoutsRepository({
        detail: template({
          blocks: [
            {
              id: "b1",
              templateId: template().id,
              type: "straight_sets",
              orderIndex: 0,
              name: null,
              rounds: null,
              workSeconds: null,
              restSeconds: null,
              capSeconds: null,
              exercises: [
                {
                  id: "e1",
                  blockId: "b1",
                  exerciseId: "33333333-3333-4333-8333-333333333333",
                  orderIndex: 0,
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
        }),
      });

      const result = await makeService(repository).getById(owner, template().id);

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]?.exercises[0]?.targetWeightKg).toBe(80);
      expect(result.isCustom).toBe(true);
    });

    it("throws a 404 for a malformed id, never reaching the repository", async () => {
      const repository = makeWorkoutsRepository();

      await expect(makeService(repository).getById(owner, "not-a-uuid")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws a 404 when the repository returns null", async () => {
      const repository = makeWorkoutsRepository({ detail: null });

      await expect(makeService(repository).getById(owner, template().id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("creates a template with a visible basedOnTemplateId, forwarding it to the repository", async () => {
      const repository = makeWorkoutsRepository({
        detail: template({ id: "source-template" }),
        createResult: template({ basedOnTemplateId: "source-template" }),
      });

      const result = await makeService(repository).create(owner, {
        ...validCreateBody,
        basedOnTemplateId: "source-template",
      });

      expect(result.basedOnTemplateId).toBe("source-template");
      expect(repository.createCalls[0]?.basedOnTemplateId).toBe("source-template");
    });

    it("rejects with a 400 when basedOnTemplateId is not visible to the caller", async () => {
      const repository = makeWorkoutsRepository({ detail: null });

      await expect(
        makeService(repository).create(owner, { ...validCreateBody, basedOnTemplateId: "unknown" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates a template when every referenced exercise is visible", async () => {
      const repository = makeWorkoutsRepository({ createResult: template() });

      const result = await makeService(repository).create(owner, validCreateBody);

      expect(result.id).toBe(template().id);
    });

    it("rejects with a 400 when a referenced exercise is not visible", async () => {
      const repository = makeWorkoutsRepository();
      const exercisesRepository = makeExercisesRepository(new Set());

      await expect(
        makeService(repository, exercisesRepository).create(owner, validCreateBody),
      ).rejects.toThrow(BadRequestException);
    });

    it("forwards every optional field when the client supplies all of them", async () => {
      const repository = makeWorkoutsRepository({ createResult: template() });

      await makeService(repository).create(owner, {
        name: "Full Body",
        activity: "strength",
        notes: "leg day",
        estimatedDurationMinutes: 60,
        blocks: [
          {
            type: "interval",
            name: "Block A",
            rounds: 8,
            workSeconds: 30,
            restSeconds: 30,
            capSeconds: 720,
            exercises: [
              {
                exerciseId: "33333333-3333-4333-8333-333333333333",
                setCount: 4,
                targetReps: 8,
                targetRepsMax: 10,
                targetWeightKg: 80,
                targetSeconds: 45,
                targetDistanceMeters: 2000,
                restSeconds: 90,
                notes: "explosive tempo",
              },
            ],
          },
        ],
      });

      expect(repository.createCalls[0]).toEqual({
        name: "Full Body",
        activity: "strength",
        notes: "leg day",
        basedOnTemplateId: null,
        estimatedDurationMinutes: 60,
        blocks: [
          {
            type: "interval",
            name: "Block A",
            rounds: 8,
            workSeconds: 30,
            restSeconds: 30,
            capSeconds: 720,
            exercises: [
              {
                exerciseId: "33333333-3333-4333-8333-333333333333",
                setCount: 4,
                targetReps: 8,
                targetRepsMax: 10,
                targetWeightKg: 80,
                targetSeconds: 45,
                targetDistanceMeters: 2000,
                restSeconds: 90,
                notes: "explosive tempo",
              },
            ],
          },
        ],
      });
    });

    it("defaults setCount, targetReps, and targetWeightKg to null when the client omits them", async () => {
      const repository = makeWorkoutsRepository({ createResult: template() });

      await makeService(repository).create(owner, {
        name: "Bodyweight Circuit",
        activity: "strength",
        blocks: [
          {
            type: "straight_sets",
            exercises: [{ exerciseId: "33333333-3333-4333-8333-333333333333" }],
          },
        ],
      });

      expect(repository.createCalls[0]?.blocks[0]?.exercises[0]).toMatchObject({
        setCount: null,
        targetReps: null,
        targetWeightKg: null,
      });
    });

    it("skips the visibility check when a template has no blocks", async () => {
      const repository = makeWorkoutsRepository({ createResult: template({ blocks: [] }) });
      let called = false;
      const exercisesRepository = {
        findVisibleIds: () => {
          called = true;
          return Promise.resolve(new Set<string>());
        },
      } as unknown as import("../exercises/exercises.repository").ExercisesRepository;

      await makeService(repository, exercisesRepository).create(owner, {
        name: "Empty",
        activity: "strength",
        blocks: [],
      });

      expect(called).toBe(false);
    });
  });

  describe("update", () => {
    it("updates simple fields without checking exercise visibility when blocks is omitted", async () => {
      const repository = makeWorkoutsRepository({ updateResult: template({ name: "Renamed" }) });
      let called = false;
      const exercisesRepository = {
        findVisibleIds: () => {
          called = true;
          return Promise.resolve(new Set<string>());
        },
      } as unknown as import("../exercises/exercises.repository").ExercisesRepository;

      const result = await makeService(repository, exercisesRepository).update(owner, template().id, {
        name: "Renamed",
      });

      expect(result.name).toBe("Renamed");
      expect(called).toBe(false);
      expect(repository.updateCalls[0]).toEqual({ name: "Renamed" });
    });

    it("forwards activity, notes, and estimatedDurationMinutes when present in the patch", async () => {
      const repository = makeWorkoutsRepository();

      await makeService(repository).update(owner, template().id, {
        activity: "running",
        notes: "back to base",
        estimatedDurationMinutes: 40,
      });

      expect(repository.updateCalls[0]).toEqual({
        activity: "running",
        notes: "back to base",
        estimatedDurationMinutes: 40,
      });
    });

    it("checks exercise visibility when blocks is present, and forwards the mapped patch", async () => {
      const repository = makeWorkoutsRepository();

      await makeService(repository).update(owner, template().id, {
        blocks: validCreateBody.blocks,
      });

      expect(repository.updateCalls[0]?.blocks).toHaveLength(1);
    });

    it("rejects with a 400 when an updated block references an invisible exercise", async () => {
      const repository = makeWorkoutsRepository();
      const exercisesRepository = makeExercisesRepository(new Set());

      await expect(
        makeService(repository, exercisesRepository).update(owner, template().id, {
          blocks: validCreateBody.blocks,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws a 404 for a malformed id", async () => {
      const repository = makeWorkoutsRepository();

      await expect(
        makeService(repository).update(owner, "not-a-uuid", { name: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws a 404 when the repository returns null", async () => {
      const repository = makeWorkoutsRepository({ updateResult: null });

      await expect(
        makeService(repository).update(owner, template().id, { name: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("delete", () => {
    it("deletes the caller's own template", async () => {
      const repository = makeWorkoutsRepository({ softDeleteResult: true });

      await expect(makeService(repository).delete(owner, template().id)).resolves.toBeUndefined();
    });

    it("throws a 404 for a malformed id", async () => {
      const repository = makeWorkoutsRepository();

      await expect(makeService(repository).delete(owner, "not-a-uuid")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws a 404 when the repository reports nothing was deleted", async () => {
      const repository = makeWorkoutsRepository({ softDeleteResult: false });

      await expect(makeService(repository).delete(owner, template().id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
