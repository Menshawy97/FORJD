import {
  createWorkoutTemplateRequestSchema,
  updateWorkoutTemplateRequestSchema,
  workoutTemplateListQuerySchema,
} from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { WorkoutsController } from "./workouts.controller";
import { WorkoutsService } from "./workouts.service";

describe("WorkoutsController", () => {
  let service: jest.Mocked<WorkoutsService>;
  let controller: WorkoutsController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<WorkoutsService>;
    controller = new WorkoutsController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(WorkoutsController)).toContain(JwtAuthGuard);
  });

  it("binds list's query to workoutTemplateListQuerySchema", () => {
    expect(getQuerySchema(WorkoutsController, "list")).toBe(workoutTemplateListQuerySchema);
  });

  it("binds create's body to createWorkoutTemplateRequestSchema", () => {
    expect(getBodySchema(WorkoutsController, "create")).toBe(createWorkoutTemplateRequestSchema);
  });

  it("binds update's body to updateWorkoutTemplateRequestSchema", () => {
    expect(getBodySchema(WorkoutsController, "update")).toBe(updateWorkoutTemplateRequestSchema);
  });

  it("list forwards request.user and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { limit: 20 } as never;

    await controller.list(request, query);

    expect(service.list).toHaveBeenCalledWith(request.user, query);
  });

  it("getById passes request.user and the path id, not the id alone", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    await controller.getById(request, id);

    expect(service.getById).toHaveBeenCalledWith(request.user, id);
  });

  it("create forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { name: "Push Day" } as never;

    await controller.create(request, body);

    expect(service.create).toHaveBeenCalledWith(request.user, body);
  });

  it("update passes request.user, the path id, and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const body = { name: "Pull Day" } as never;

    await controller.update(request, id, body);

    expect(service.update).toHaveBeenCalledWith(request.user, id, body);
  });

  it("delete passes request.user and the path id", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    await controller.delete(request, id);

    expect(service.delete).toHaveBeenCalledWith(request.user, id);
  });
});
