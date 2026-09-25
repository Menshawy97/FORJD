import type { User } from "@forjd/domain";

import type { BodyRepository } from "../body/body.repository";
import type { HealthDataRepository } from "../health-data/health-data.repository";
import type { UsersRepository } from "../users/users.repository";
import { MacroSuggestionService } from "./macro-suggestion.service";

describe("MacroSuggestionService", () => {
  const user = { id: "user-1", email: "a@b.c" } as User;
  const today = new Date("2026-09-25T12:00:00.000Z");

  function build() {
    const users = {
      findProfile: jest.fn().mockResolvedValue({
        activityLevel: "active",
        bodyGoal: "maintain",
        heightCm: 178,
        dateOfBirth: "1994-09-26",
        sex: "male",
      }),
    };
    const body = { listScansForUser: jest.fn().mockResolvedValue([]) };
    const health = {
      getObservationsForUser: jest.fn().mockResolvedValue([
        { metricType: "weight", value: 80, unit: "kg", startTime: new Date("2026-09-20T07:00:00.000Z") },
        { metricType: "weight", value: 190, unit: "lb", startTime: new Date("2026-09-24T07:00:00.000Z") },
      ]),
    };
    const service = new MacroSuggestionService(
      users as unknown as UsersRepository,
      body as unknown as BodyRepository,
      health as unknown as HealthDataRepository,
    );
    return { service, users, body, health };
  }

  it("reads only the caller's profile, scans and a bounded year of weights", async () => {
    const { service, users, body, health } = build();

    await service.getSuggestion(user, today);

    expect(users.findProfile).toHaveBeenCalledWith("user-1");
    expect(body.listScansForUser).toHaveBeenCalledWith("user-1");
    expect(health.getObservationsForUser).toHaveBeenCalledWith("user-1", {
      metricTypes: ["weight"],
      since: new Date("2025-09-25T12:00:00.000Z"),
      limit: 1000,
    });
  });

  it("uses kilogram weights only, never converting another unit", async () => {
    const { service } = build();

    const result = await service.getSuggestion(user, today);

    expect(result.basis).toMatchObject({ weightKg: 80, bmrSource: "estimate" });
  });
});
