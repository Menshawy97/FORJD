import { refoldForge, ForgeRefoldTarget } from "./refold";

describe("refoldForge", () => {
  it("refolds every stale athlete, one at a time, and totals the weeks rewritten", async () => {
    const target: ForgeRefoldTarget = {
      staleUserIds: jest.fn().mockResolvedValue(["a", "b"]),
      refoldUser: jest.fn().mockResolvedValueOnce({ weeks: 20 }).mockResolvedValueOnce({ weeks: 5 }),
    };

    const summary = await refoldForge(target);

    expect(target.refoldUser).toHaveBeenNthCalledWith(1, "a");
    expect(target.refoldUser).toHaveBeenNthCalledWith(2, "b");
    expect(summary).toEqual({ athletes: 2, weeks: 25 });
  });

  it("does nothing when no athlete is stale, so running it on every deploy is safe", async () => {
    const target: ForgeRefoldTarget = {
      staleUserIds: jest.fn().mockResolvedValue([]),
      refoldUser: jest.fn(),
    };

    expect(await refoldForge(target)).toEqual({ athletes: 0, weeks: 0 });
    expect(target.refoldUser).not.toHaveBeenCalled();
  });

  it("stops at the first athlete that fails rather than reporting a partial run as done", async () => {
    const target: ForgeRefoldTarget = {
      staleUserIds: jest.fn().mockResolvedValue(["a", "b"]),
      refoldUser: jest.fn().mockRejectedValueOnce(new RangeError("bad total")),
    };

    await expect(refoldForge(target)).rejects.toThrow("bad total");
    expect(target.refoldUser).toHaveBeenCalledTimes(1);
  });
});
