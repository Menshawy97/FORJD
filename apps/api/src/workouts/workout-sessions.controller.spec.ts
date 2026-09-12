import {
  exerciseHistoryQuerySchema,
  progressStrengthQuerySchema,
  workoutSessionListQuerySchema,
  workoutSessionUploadRequestSchema,
  workoutStatsQuerySchema,
} from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { ProgressService } from "./progress.service";
import { WorkoutSessionsController } from "./workout-sessions.controller";
import { WorkoutSessionsService } from "./workout-sessions.service";

describe("WorkoutSessionsController", () => {
  let sessionsService: jest.Mocked<WorkoutSessionsService>;
  let progressService: jest.Mocked<ProgressService>;
  let controller: WorkoutSessionsController;

  beforeEach(() => {
    sessionsService = {
      list: jest.fn(),
      stats: jest.fn(),
      exerciseHistory: jest.fn(),
      getById: jest.fn(),
      upload: jest.fn(),
    } as unknown as jest.Mocked<WorkoutSessionsService>;
    progressService = { strength: jest.fn() } as unknown as jest.Mocked<ProgressService>;
    controller = new WorkoutSessionsController(sessionsService, progressService);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(WorkoutSessionsController)).toContain(JwtAuthGuard);
  });

  describe("Zod schema wiring", () => {
    it("binds list's query to workoutSessionListQuerySchema", () => {
      expect(getQuerySchema(WorkoutSessionsController, "list")).toBe(workoutSessionListQuerySchema);
    });

    it("binds stats's query to workoutStatsQuerySchema", () => {
      expect(getQuerySchema(WorkoutSessionsController, "stats")).toBe(workoutStatsQuerySchema);
    });

    it("binds progressStrength's query to progressStrengthQuerySchema", () => {
      expect(getQuerySchema(WorkoutSessionsController, "progressStrength")).toBe(progressStrengthQuerySchema);
    });

    it("binds exerciseHistory's query to exerciseHistoryQuerySchema", () => {
      expect(getQuerySchema(WorkoutSessionsController, "exerciseHistory")).toBe(exerciseHistoryQuerySchema);
    });

    it("binds upload's body to workoutSessionUploadRequestSchema", () => {
      expect(getBodySchema(WorkoutSessionsController, "upload")).toBe(workoutSessionUploadRequestSchema);
    });
  });

  it("list forwards request.user and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { limit: 20 } as never;

    await controller.list(request, query);

    expect(sessionsService.list).toHaveBeenCalledWith(request.user, query);
  });

  it("stats forwards request.user and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { timeZone: "UTC" } as never;

    await controller.stats(request, query);

    expect(sessionsService.stats).toHaveBeenCalledWith(request.user, query);
  });

  it("progressStrength is routed to ProgressService, scoped by request.user", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { exerciseId: "ex-1" } as never;

    await controller.progressStrength(request, query);

    expect(progressService.strength).toHaveBeenCalledWith(request.user, query);
  });

  it("exerciseHistory passes request.user, the path exerciseId and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const exerciseId = "aaaa1111-1111-4111-8111-111111111111";
    const query = { limit: 10 } as never;

    await controller.exerciseHistory(request, exerciseId, query);

    expect(sessionsService.exerciseHistory).toHaveBeenCalledWith(request.user, exerciseId, query);
  });

  it("getById passes request.user and the path id, not the id alone", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "bbbb2222-2222-4222-8222-222222222222";

    await controller.getById(request, id);

    expect(sessionsService.getById).toHaveBeenCalledWith(request.user, id);
  });

  it("upload forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { startedAt: new Date().toISOString() } as never;

    await controller.upload(request, body);

    expect(sessionsService.upload).toHaveBeenCalledWith(request.user, body);
  });
});
