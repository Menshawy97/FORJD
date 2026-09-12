import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { AthletesController } from "./athletes.controller";
import { AthletesService } from "./athletes.service";

describe("AthletesController", () => {
  let service: jest.Mocked<AthletesService>;
  let controller: AthletesController;

  beforeEach(() => {
    service = { getPublicProfile: jest.fn() } as unknown as jest.Mocked<AthletesService>;
    controller = new AthletesController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(AthletesController)).toContain(JwtAuthGuard);
  });

  it("passes request.user (never a client-supplied id) as the caller alongside the path userId", async () => {
    const request = fakeAuthenticatedRequest();
    const otherUserId = "22222222-2222-4222-8222-222222222222";

    await controller.getPublicProfile(request, otherUserId);

    expect(service.getPublicProfile).toHaveBeenCalledWith(request.user, otherUserId);
    expect(service.getPublicProfile).toHaveBeenCalledTimes(1);
  });

  it("never substitutes the path userId for the authenticated caller", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.getPublicProfile(request, request.user.id);

    const callerArg = service.getPublicProfile.mock.calls[0]?.[0];
    expect(callerArg).toBe(request.user);
  });
});
