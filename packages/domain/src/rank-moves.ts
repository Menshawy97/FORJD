/**
 * Who moved on a city's board between two weekly snapshots (Phase 12F slice 6, docs/product/phase-12f-plan.md). Pure: the
 * snapshot job reads the earlier standings and computes the new ones, this compares. Only people ranked in both count (a new
 * arrival has nothing to move from); a smaller rank number is up; an unchanged rank is no move.
 */
export interface RankMove {
  userId: string;
  direction: "up" | "down";
}

export function rankMoves(
  previous: ReadonlyMap<string, number>,
  current: readonly { userId: string; rank: number }[],
): RankMove[] {
  const moves: RankMove[] = [];
  for (const entry of current) {
    const before = previous.get(entry.userId);
    if (before === undefined || before === entry.rank) continue;
    moves.push({ userId: entry.userId, direction: entry.rank < before ? "up" : "down" });
  }
  return moves;
}
