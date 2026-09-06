import { User } from "@forjd/domain";

import { ProgressRepository, ProgressStrengthRow } from "./progress.repository";
import { ProgressService } from "./progress.service";

/**
 * The service's only real jobs -- scoping the read to the caller, converting `Date`s to ISO
 * strings, and calling `evaluateInsight` with what the repository computed -- against a fake
 * repository. `ProgressRepository`'s own SQL is proven against real Postgres in
 * `progress.repository.spec.ts`.
 */
describe("ProgressService", () => {
  const viewer = { id: "11111111-1111-4111-8111-111111111111", email: "ada@example.com" } as User;

  const emptyRow = (): ProgressStrengthRow => ({
    personalRecords: [],
    oneRepMaxTrend: [],
    weeklyVolumeKg: Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, volumeKg: 0 })),
    trainingCalendar: { month: "2026-08", days: [], daysTrained: 0 },
    muscleSplit: [],
    readyToProgress: null,
    volumeKgThisWeek: 0,
    volumeKgLastWeek: 0,
    sessionsThisWeek: 0,
    weeksOfHistory: 0,
  });

  const makeService = (row: ProgressStrengthRow) => {
    const repository = {
      progressStrengthForUser: jest.fn().mockResolvedValue(row),
    } as unknown as ProgressRepository;
    return { service: new ProgressService(repository), repository };
  };

  it("scopes the read to the caller's own id", async () => {
    const { service, repository } = makeService(emptyRow());

    await service.strength(viewer, { timeZone: "UTC" });

    expect(repository.progressStrengthForUser).toHaveBeenCalledWith(viewer.id, "UTC", expect.any(Date));
  });

  it("turns personal-record dates into ISO strings", async () => {
    const row = emptyRow();
    row.personalRecords = [
      {
        exerciseId: "22222222-2222-4222-8222-222222222222",
        exerciseName: "Back Squat",
        weightKg: 140,
        reps: 1,
        achievedAt: new Date("2026-08-19T09:00:00.000Z"),
        deltaKgSinceLastMonth: 7.5,
      },
    ];
    const { service } = makeService(row);

    const result = await service.strength(viewer, { timeZone: "UTC" });

    expect(result.personalRecords[0]?.achievedAt).toBe("2026-08-19T09:00:00.000Z");
  });

  it("returns a null insight for an honest-empty account rather than manufacturing one", async () => {
    const { service } = makeService(emptyRow());

    const result = await service.strength(viewer, { timeZone: "UTC" });

    expect(result.insight).toBeNull();
  });

  it("passes readyToProgress through to evaluateInsight so its headline names the exercise", async () => {
    const row = emptyRow();
    row.weeksOfHistory = 4;
    row.sessionsThisWeek = 3;
    row.readyToProgress = {
      exerciseId: "22222222-2222-4222-8222-222222222222",
      exerciseName: "Back Squat",
    };
    const { service } = makeService(row);

    const result = await service.strength(viewer, { timeZone: "UTC" });

    expect(result.insight?.headline).toContain("Back Squat");
  });

  it("passes through the muscle split and weekly volume untouched", async () => {
    const row = emptyRow();
    row.muscleSplit = [{ bucket: "legs", percent: 100 }];
    row.weeklyVolumeKg = [{ dayOfWeek: 1, volumeKg: 500 }];
    const { service } = makeService(row);

    const result = await service.strength(viewer, { timeZone: "UTC" });

    expect(result.muscleSplit).toEqual([{ bucket: "legs", percent: 100 }]);
    expect(result.weeklyVolumeKg).toEqual([{ dayOfWeek: 1, volumeKg: 500 }]);
  });
});
