import { formatForgeSummary, ForgeJobDeps, runForgeEvaluation } from "./evaluate";

const NOW = new Date("2026-10-03T00:10:00Z");

function deps(over: Partial<{ enabled: boolean; users: string[]; evaluate: (userId: string) => Promise<number> }> = {}) {
  const evaluateDue = jest.fn((userId: string) => (over.evaluate ?? (async () => 1))(userId));
  const built: ForgeJobDeps = {
    flags: { isEnabled: jest.fn(async () => over.enabled ?? true) },
    users: { enrolledUserIds: jest.fn(async () => over.users ?? ["a", "b"]) },
    service: { evaluateDue },
  };
  return { built, evaluateDue };
}

describe("runForgeEvaluation", () => {
  it("does nothing while the weekly_forge flag is off, so the feature stays dark", async () => {
    const { built, evaluateDue } = deps({ enabled: false });

    const summary = await runForgeEvaluation(built, NOW);

    expect(summary).toEqual({ skipped: true, users: 0, weeks: 0, failures: [] });
    expect(built.flags.isEnabled).toHaveBeenCalledWith("weekly_forge");
    expect(evaluateDue).not.toHaveBeenCalled();
  });

  it("evaluates every enrolled athlete at the run's moment and counts the weeks written", async () => {
    const { built, evaluateDue } = deps({ evaluate: async (userId) => (userId === "a" ? 2 : 0) });

    const summary = await runForgeEvaluation(built, NOW);

    expect(evaluateDue).toHaveBeenCalledWith("a", NOW);
    expect(evaluateDue).toHaveBeenCalledWith("b", NOW);
    expect(summary).toEqual({ skipped: false, users: 2, weeks: 2, failures: [] });
  });

  it("keeps going past an athlete whose evaluation fails, and reports them", async () => {
    const { built } = deps({
      users: ["a", "b", "c"],
      evaluate: async (userId) => {
        if (userId === "b") throw new Error("boom");
        return 1;
      },
    });

    const summary = await runForgeEvaluation(built, NOW);

    expect(summary.weeks).toBe(2);
    expect(summary.failures).toEqual([{ userId: "b", message: expect.stringContaining("boom") }]);
  });
});

describe("formatForgeSummary", () => {
  it("says the run was skipped while the flag is off", () => {
    expect(formatForgeSummary({ skipped: true, users: 0, weeks: 0, failures: [] })).toBe(
      "weekly_forge is off: nothing evaluated\n",
    );
  });

  it("gives one line for a clean run and one more per failure", () => {
    expect(formatForgeSummary({ skipped: false, users: 3, weeks: 4, failures: [] })).toBe(
      "evaluated 4 weeks for 3 athletes\n",
    );
    expect(
      formatForgeSummary({ skipped: false, users: 3, weeks: 2, failures: [{ userId: "b", message: "boom" }] }),
    ).toBe("evaluated 2 weeks for 3 athletes, 1 failed:\n  b: boom\n");
  });
});
