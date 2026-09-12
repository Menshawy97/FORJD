import { createProgramRequestSchema, programListQuerySchema } from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { ProgramsController } from "./programs.controller";
import { ProgramsService } from "./programs.service";

describe("ProgramsController", () => {
  let service: jest.Mocked<ProgramsService>;
  let controller: ProgramsController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      getEnrollment: jest.fn(),
      stopFollowing: jest.fn(),
      getById: jest.fn(),
      enrol: jest.fn(),
    } as unknown as jest.Mocked<ProgramsService>;
    controller = new ProgramsController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(ProgramsController)).toContain(JwtAuthGuard);
  });

  it("binds list's query to programListQuerySchema", () => {
    expect(getQuerySchema(ProgramsController, "list")).toBe(programListQuerySchema);
  });

  it("binds create's body to createProgramRequestSchema", () => {
    expect(getBodySchema(ProgramsController, "create")).toBe(createProgramRequestSchema);
  });

  it("list forwards request.user and the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { mine: true } as never;

    await controller.list(request, query);

    expect(service.list).toHaveBeenCalledWith(request.user, query);
  });

  it("create forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { name: "My Program" } as never;

    await controller.create(request, body);

    expect(service.create).toHaveBeenCalledWith(request.user, body);
  });

  it("getEnrollment/stopFollowing scope by request.user only", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.getEnrollment(request);
    expect(service.getEnrollment).toHaveBeenCalledWith(request.user);

    await controller.stopFollowing(request);
    expect(service.stopFollowing).toHaveBeenCalledWith(request.user);
  });

  it("getById passes request.user and the path id, not the id alone", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await controller.getById(request, id);

    expect(service.getById).toHaveBeenCalledWith(request.user, id);
  });

  it("enrol passes request.user and the path id", async () => {
    const request = fakeAuthenticatedRequest();
    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await controller.enrol(request, id);

    expect(service.enrol).toHaveBeenCalledWith(request.user, id);
  });
});
