import { leaderboardQuerySchema } from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getClassGuards, getQuerySchema } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { LeaderboardsController } from "./leaderboards.controller";
import { LeaderboardsService } from "./leaderboards.service";

describe("LeaderboardsController", () => {
  let service: jest.Mocked<LeaderboardsService>;
  let controller: LeaderboardsController;

  beforeEach(() => {
    service = { get: jest.fn() } as unknown as jest.Mocked<LeaderboardsService>;
    controller = new LeaderboardsController(service);
  });

  it("carries JwtAuthGuard at the class level, so no route here is public", () => {
    expect(getClassGuards(LeaderboardsController)).toContain(JwtAuthGuard);
  });

  it("binds the query to leaderboardQuerySchema, which bounds the window and rejects unknown metrics", () => {
    expect(getQuerySchema(LeaderboardsController, "get")).toBe(leaderboardQuerySchema);
  });

  it("passes the authenticated user, and only that user, with the validated query", async () => {
    const request = fakeAuthenticatedRequest();
    const query = { metric: "activity" as const, period: "month" as const, window: 3 };
    const response = { status: "ranked" } as never;
    service.get.mockResolvedValue(response);

    await expect(controller.get(request, query)).resolves.toBe(response);

    expect(service.get).toHaveBeenCalledWith(request.user, query);
  });
});
