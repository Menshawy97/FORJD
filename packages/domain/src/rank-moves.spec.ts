import { rankMoves } from "./rank-moves";

// Phase 12F slice 6. Who moved on a city's board between two weekly snapshots: only people ranked in both (a new arrival has
// nothing to move from), up when the rank number got smaller, nothing when it did not change.
describe("rankMoves", () => {
  const previous = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
    ["d", 4],
  ]);

  it("says who went up and who went down", () => {
    expect(
      rankMoves(previous, [
        { userId: "b", rank: 1 },
        { userId: "a", rank: 2 },
        { userId: "c", rank: 3 },
        { userId: "d", rank: 4 },
      ]),
    ).toEqual([
      { userId: "b", direction: "up" },
      { userId: "a", direction: "down" },
    ]);
  });

  it("leaves out people who were not ranked before, and people who left", () => {
    expect(rankMoves(previous, [{ userId: "new", rank: 1 }, { userId: "a", rank: 2 }])).toEqual([{ userId: "a", direction: "down" }]);
  });

  it("is empty with no earlier standings", () => {
    expect(rankMoves(new Map(), [{ userId: "a", rank: 1 }])).toEqual([]);
  });
});
