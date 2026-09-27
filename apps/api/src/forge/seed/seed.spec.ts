import { FORGE_LADDERS, FORGE_TIERS } from "@forjd/domain";

import { forgeSeedRows, ForgeSeedTarget, seedForge } from "./seed";

describe("forgeSeedRows", () => {
  const rows = forgeSeedRows();

  it("describes every ladder, in screen order, with its unit, top band and privacy", () => {
    expect(rows.ladders.map((ladder) => ladder.key)).toEqual([...FORGE_LADDERS]);
    expect(rows.ladders.find((ladder) => ladder.key === "volume")).toEqual({
      key: "volume",
      unit: "kg",
      maxBand: "forged",
      isPublic: true,
      sortOrder: 1,
    });
    expect(rows.ladders.find((ladder) => ladder.key === "nourish")).toMatchObject({
      maxBand: "anvil",
      isPublic: false,
    });
  });

  it("copies every tier from the domain table, and nothing else", () => {
    const expected = FORGE_LADDERS.flatMap((ladder) => FORGE_TIERS[ladder].map((tier) => ({ ladder, ...tier })));

    expect(rows.tiers).toHaveLength(expected.length);
    expect(rows.tiers.find((tier) => tier.ladderKey === "distance" && tier.level === 7)).toEqual({
      ladderKey: "distance",
      level: 7,
      band: "ember",
      target: "14.50",
    });
  });
});

describe("seedForge", () => {
  it("hands the whole table to the target in one call, so it is written in one transaction", async () => {
    const target: ForgeSeedTarget = { replaceAll: jest.fn().mockResolvedValue({ ladders: 5, tiers: 80, pruned: 0 }) };

    const summary = await seedForge(target);

    expect(target.replaceAll).toHaveBeenCalledTimes(1);
    expect(target.replaceAll).toHaveBeenCalledWith(forgeSeedRows());
    expect(summary).toEqual({ ladders: 5, tiers: 80, pruned: 0 });
  });
});
