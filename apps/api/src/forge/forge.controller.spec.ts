import { timeZoneUpdateRequestSchema } from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { FeatureFlagsController } from "../feature-flags/feature-flags.controller";
import { FeatureFlagsRepository } from "../feature-flags/feature-flags.repository";
import { getBodySchema, getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { ForgeController } from "./forge.controller";
import { ForgeService } from "./forge.service";
import { TimeZoneController } from "./time-zone.controller";

describe("Weekly Forge controllers", () => {
  let service: jest.Mocked<ForgeService>;

  beforeEach(() => {
    service = {
      getForge: jest.fn(),
      pendingWeeks: jest.fn(),
      acknowledge: jest.fn(),
      setTimeZone: jest.fn(),
    } as unknown as jest.Mocked<ForgeService>;
  });

  it("carries JwtAuthGuard at the class level on every controller, so no Forge route is public", () => {
    expect(getClassGuards(ForgeController)).toContain(JwtAuthGuard);
    expect(getClassGuards(TimeZoneController)).toContain(JwtAuthGuard);
    expect(getClassGuards(FeatureFlagsController)).toContain(JwtAuthGuard);
  });

  it("binds the time-zone body to timeZoneUpdateRequestSchema, which refuses anything but an IANA zone", () => {
    expect(getBodySchema(TimeZoneController, "update")).toBe(timeZoneUpdateRequestSchema);
  });

  it("reads only the authenticated caller's own ladders, weeks and acknowledgements", async () => {
    const controller = new ForgeController(service);
    const request = fakeAuthenticatedRequest();

    await controller.get(request);
    await controller.pending(request);
    await controller.acknowledge(request, { weekStart: "2026-09-19" });

    expect(service.getForge).toHaveBeenCalledWith(request.user.id, expect.any(Date));
    expect(service.pendingWeeks).toHaveBeenCalledWith(request.user.id, expect.any(Date));
    expect(service.acknowledge).toHaveBeenCalledWith(request.user.id, "2026-09-19");
  });

  it("stores the caller's time zone, and only the caller's", async () => {
    const controller = new TimeZoneController(service);
    const request = fakeAuthenticatedRequest();

    await controller.update(request, { timeZone: "Africa/Cairo" });

    expect(service.setTimeZone).toHaveBeenCalledWith(request.user.id, "Africa/Cairo");
  });

  it("lists the enabled flag keys", async () => {
    const flags = { enabledKeys: jest.fn().mockResolvedValue(["weekly_forge"]) };
    const controller = new FeatureFlagsController(flags as unknown as FeatureFlagsRepository);

    await expect(controller.list()).resolves.toEqual({ enabled: ["weekly_forge"] });
  });
});
