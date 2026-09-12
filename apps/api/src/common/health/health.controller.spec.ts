import { ServiceUnavailableException } from "@nestjs/common";

import { getClassGuards } from "../../test-support/controller-metadata";
import { HealthController } from "./health.controller";

/**
 * `HealthController` is a public liveness probe (`GET /api/v1/health`) with no
 * authentication, no path/query params, and no Zod-validated body -- so unlike every other
 * controller covered by R16, there is no guard, no `request.user`, and no schema for this spec
 * to assert. What is left to prove is its own actual surface: it reports up/down honestly and
 * never lets a database error escape as an unhandled 500.
 */
describe("HealthController", () => {
  let db: { execute: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    db = { execute: jest.fn() };
    controller = new HealthController(db as never);
  });

  it("carries no guard -- this is an intentionally public liveness probe", () => {
    expect(getClassGuards(HealthController)).toEqual([]);
  });

  it("reports ok when the database ping succeeds", async () => {
    db.execute.mockResolvedValue(undefined);

    await expect(controller.check()).resolves.toEqual({ status: "ok", database: "up" });
  });

  it("reports service-unavailable, not a raw 500, when the database ping fails", async () => {
    db.execute.mockRejectedValue(new Error("connection refused"));

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
