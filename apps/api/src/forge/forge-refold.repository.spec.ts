import { FORGE_LADDERS, FORGE_RULES_VERSION, refoldLadder } from "@forjd/domain";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { forgeRewards, forgeUserLadders, forgeWeeks } from "../database/schema/forge.schema";
import { users } from "../database/schema/users.schema";
import { ForgeRefoldRepository } from "./forge-refold.repository";

/**
 * Against real Postgres: the claims are that a refold rewrites every stored week's judgement from
 * its locked total, leaves the totals alone, sets the ladder state to the fold's end, keeps every
 * reward already earned, and touches nobody else -- and that a second run finds nothing to do.
 */
describe("ForgeRefoldRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ForgeRefoldRepository;
  const emails: string[] = [];

  // Four Saturdays, oldest first.
  const WEEKS = ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"];
  // Volume totals judged under the old table; under the new one they climb 1 → 3 → 4 → 5 → 6.
  const VOLUME_TOTALS = [4000, 4000, 5500, 7500];

  const makeUser = async (label: string): Promise<string> => {
    const email = `forge-refold-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    emails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    await db
      .insert(forgeUserLadders)
      .values(FORGE_LADDERS.map((ladderKey) => ({ userId: row!.id, ladderKey, enrolledWeek: WEEKS[0]! })));
    return row!.id;
  };

  /** Stores volume weeks the way the old table judged them: levels in the twenties, version 1. */
  const storeOldVolumeWeeks = async (userId: string): Promise<void> => {
    await db.insert(forgeWeeks).values(
      VOLUME_TOTALS.map((total, index) => ({
        userId,
        ladderKey: "volume",
        weekStart: WEEKS[index]!,
        timeZone: "Africa/Cairo",
        closesAt: new Date(`${WEEKS[index]}T21:00:00Z`),
        total: total.toFixed(2),
        target: "99999.00",
        levelBefore: 20 + index,
        levelAfter: 21 + index,
        bandBefore: "anvil",
        bandAfter: "anvil",
        outcome: "hit",
        missStreakAfter: 0,
        temperedHoldWeeksAfter: 0,
        forgedStreakAfter: 0,
        rulesVersion: 1,
      })),
    );
    await db
      .update(forgeUserLadders)
      .set({ level: 24, bestLevel: 24, lastEvaluatedWeek: WEEKS[3]! })
      .where(and(eq(forgeUserLadders.userId, userId), eq(forgeUserLadders.ladderKey, "volume")));
    // A mark the old table awarded for a level the new one no longer has.
    await db.insert(forgeRewards).values({
      userId,
      ladderKey: "volume",
      weekStart: WEEKS[3]!,
      type: "forge_mark",
      level: 24,
      band: "anvil",
    });
  };

  beforeAll(() => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new ForgeRefoldRepository(db as unknown as Database);
  });

  afterAll(async () => {
    if (emails.length > 0) await db.delete(users).where(inArray(users.email, emails));
    await pool.end();
  });

  it("lists an athlete with a week below the current rules version as stale", async () => {
    const userId = await makeUser("stale");
    await storeOldVolumeWeeks(userId);

    expect(await repository.staleUserIds()).toContain(userId);
  });

  it("rewrites every stored week from its locked total, and leaves the totals alone", async () => {
    const userId = await makeUser("rewrite");
    await storeOldVolumeWeeks(userId);

    const summary = await repository.refoldUser(userId);

    const expected = refoldLadder("volume", VOLUME_TOTALS).results;
    const rows = await db
      .select()
      .from(forgeWeeks)
      .where(eq(forgeWeeks.userId, userId))
      .orderBy(forgeWeeks.weekStart);
    expect(summary).toEqual({ weeks: 4 });
    expect(rows.map((row) => Number(row.total))).toEqual(VOLUME_TOTALS);
    expect(
      rows.map((row) => ({
        levelBefore: row.levelBefore,
        levelAfter: row.levelAfter,
        bandAfter: row.bandAfter,
        outcome: row.outcome,
        target: Number(row.target),
        rulesVersion: row.rulesVersion,
      })),
    ).toEqual(
      expected.map((result) => ({
        levelBefore: result.levelBefore,
        levelAfter: result.levelAfter,
        bandAfter: result.bandAfter,
        outcome: result.outcome,
        target: result.target,
        rulesVersion: FORGE_RULES_VERSION,
      })),
    );
  });

  it("sets the ladder's state to where the fold ends, and keeps the last evaluated week", async () => {
    const userId = await makeUser("state");
    await storeOldVolumeWeeks(userId);

    await repository.refoldUser(userId);

    const [row] = await db
      .select()
      .from(forgeUserLadders)
      .where(and(eq(forgeUserLadders.userId, userId), eq(forgeUserLadders.ladderKey, "volume")));
    const { state } = refoldLadder("volume", VOLUME_TOTALS);
    expect(row).toMatchObject({ ...state, lastEvaluatedWeek: WEEKS[3] });
  });

  it("keeps every reward already earned and adds the new table's, without duplicates", async () => {
    const userId = await makeUser("rewards");
    await storeOldVolumeWeeks(userId);

    await repository.refoldUser(userId);
    await repository.refoldUser(userId);

    const rewards = await db.select().from(forgeRewards).where(eq(forgeRewards.userId, userId));
    expect(rewards).toContainEqual(expect.objectContaining({ type: "forge_mark", level: 24 }));
    expect(rewards).toContainEqual(expect.objectContaining({ type: "band_badge", band: "ember", level: 4 }));
    const marks = rewards.filter((reward) => reward.type === "forge_mark").map((reward) => reward.level);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("finds nothing stale once an athlete is refolded, and touches no one else", async () => {
    const userId = await makeUser("done");
    const bystander = await makeUser("bystander");
    await storeOldVolumeWeeks(userId);
    await storeOldVolumeWeeks(bystander);

    await repository.refoldUser(userId);

    const stale = await repository.staleUserIds();
    expect(stale).not.toContain(userId);
    expect(stale).toContain(bystander);
    const [untouched] = await db
      .select({ levelAfter: forgeWeeks.levelAfter })
      .from(forgeWeeks)
      .where(and(eq(forgeWeeks.userId, bystander), eq(forgeWeeks.weekStart, WEEKS[0]!)));
    expect(untouched!.levelAfter).toBe(21);
  });

  it("does nothing for an athlete with no stored weeks", async () => {
    const userId = await makeUser("empty");

    expect(await repository.refoldUser(userId)).toEqual({ weeks: 0 });
  });

  describe("refoldUserIfStale (the evaluation's backstop)", () => {
    it("refolds an athlete who still has a week on an older rules version", async () => {
      const userId = await makeUser("if-stale");
      await storeOldVolumeWeeks(userId);

      expect(await repository.refoldUserIfStale(userId)).toBe(true);
      expect(await repository.staleUserIds()).not.toContain(userId);
    });

    it("leaves an up-to-date athlete alone and reports that it did", async () => {
      const userId = await makeUser("current");
      await storeOldVolumeWeeks(userId);
      await repository.refoldUser(userId);
      const before = await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId));

      expect(await repository.refoldUserIfStale(userId)).toBe(false);
      expect(await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId))).toEqual(before);
    });
  });

  it("refuses to refold weeks for a ladder the athlete has no row for, rather than writing them unlocked", async () => {
    const userId = await makeUser("no-row");
    await storeOldVolumeWeeks(userId);
    await db
      .delete(forgeUserLadders)
      .where(and(eq(forgeUserLadders.userId, userId), eq(forgeUserLadders.ladderKey, "volume")));

    await expect(repository.refoldUser(userId)).rejects.toThrow(/volume/);
    const [week] = await db
      .select({ rulesVersion: forgeWeeks.rulesVersion })
      .from(forgeWeeks)
      .where(and(eq(forgeWeeks.userId, userId), eq(forgeWeeks.weekStart, WEEKS[0]!)));
    expect(week!.rulesVersion).toBe(1);
  });
});
