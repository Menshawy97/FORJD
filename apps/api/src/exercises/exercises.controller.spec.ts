import { createExerciseRequestSchema, exerciseListQuerySchema, updateExerciseRequestSchema } from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { ExercisesController } from "./exercises.controller";
import { ExercisesService } from "./exercises.service";

describe("ExercisesController", () => {
  let service: jest.Mocked<ExercisesService>;
  let controller: ExercisesController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getCatalogue: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      setFavourite: jest.fn(),
    } as unknown as jest.Mocked<ExercisesService>;
    controller = new ExercisesController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(ExercisesController)).toContain(JwtAuthGuard);
  });

  describe("Zod schema wiring", () => {
    it("binds list's query to exerciseListQuerySchema", () => {
      expect(getQuerySchema(ExercisesController, "list")).toBe(exerciseListQuerySchema);
    });

    it("binds create's body to createExerciseRequestSchema", () => {
      expect(getBodySchema(ExercisesController, "create")).toBe(createExerciseRequestSchema);
    });

    it("binds update's body to updateExerciseRequestSchema", () => {
      expect(getBodySchema(ExercisesController, "update")).toBe(updateExerciseRequestSchema);
    });
  });

  it("list forwards request.user and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { limit: 20 } as never;

    await controller.list(request, query);

    expect(service.list).toHaveBeenCalledWith(request.user, query);
  });

  it("getCatalogue scopes by request.user only", async () => {
    const request = fakeAuthenticatedRequest();
    await controller.getCatalogue(request);
    expect(service.getCatalogue).toHaveBeenCalledWith(request.user);
  });

  it("getById passes request.user and the path id -- the service enforces ownership, not the controller", async () => {
    const request = fakeAuthenticatedRequest();
    const someExerciseId = "44444444-4444-4444-8444-444444444444";

    await controller.getById(request, someExerciseId);

    expect(service.getById).toHaveBeenCalledWith(request.user, someExerciseId);
  });

  it("create forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { name: "Back Squat" } as never;

    await controller.create(request, body);

    expect(service.create).toHaveBeenCalledWith(request.user, body);
  });

  it("update passes request.user, the path id, and the validated body -- never trusting the id alone", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "55555555-5555-4555-8555-555555555555";
    const body = { name: "Front Squat" } as never;

    await controller.update(request, id, body);

    expect(service.update).toHaveBeenCalledWith(request.user, id, body);
  });

  it("delete passes request.user and the path id", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "66666666-6666-4666-8666-666666666666";

    await controller.delete(request, id);

    expect(service.delete).toHaveBeenCalledWith(request.user, id);
  });

  it("addFavourite/removeFavourite scope by request.user, not the path alone", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "77777777-7777-4777-8777-777777777777";

    await controller.addFavourite(request, id);
    expect(service.setFavourite).toHaveBeenCalledWith(request.user, id, true);

    await controller.removeFavourite(request, id);
    expect(service.setFavourite).toHaveBeenCalledWith(request.user, id, false);
  });
});
