import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { featureFlags } from "./feature-flags.schema";
import {
  forgeLadders,
  forgeRewards,
  forgeTiers,
  forgeUserLadders,
  forgeWeekAcks,
  forgeWeeks,
} from "./forge.schema";
import { users } from "./users.schema";

/**
 * Against real Postgres, like the other schema specs: the claims are the tables' own constraints
 * (one state row per athlete and ladder, one result per athlete, ladder and week, an append-only
 * ledger that refuses a duplicate reward, everything deleted with the account) and the migration's
 * seeded flag, which a mock would only prove the author's assumptions about (ADR-057).
 */
describe("Weekly Forge tables (ADR-057)", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  const createdEmails: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `forge-schema-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const state = (userId: string, over: Partial<typeof forgeUserLadders.$inferInsert> = {}) => ({
    userId,
    ladderKey: "volume",
    enrolledWeek: "2026-09-26",
    ...over,
  });

  const week = (userId: string, over: Partial<typeof forgeWeeks.$inferInsert> = {}) => ({
    userId,
    ladderKey: "volume",
    weekStart: "2026-09-26",
    timeZone: "Africa/Cairo",
    closesAt: new Date("2026-10-02T21:00:00Z"),
    total: "2150.00",
    target: "2000.00",
    levelBefore: 1,
    levelAfter: 2,
    bandBefore: "ore",
    bandAfter: "ore",
    outcome: "hit",
    missStreakAfter: 0,
    temperedHoldWeeksAfter: 0,
    forgedStreakAfter: 0,
    rulesVersion: 1,
    ...over,
  });

  const reward = (userId: string, over: Partial<typeof forgeRewards.$inferInsert> = {}) => ({
    userId,
    ladderKey: "volume",
    type: "forge_mark",
    level: 2,
    band: "ore",
    weekStart: "2026-09-26",
    ...over,
  });

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdEmails));
    }
    await pool.end();
  });

  describe("forge_user_ladders (current state)", () => {
    it("starts a ladder at level 1 with no streaks, from defaults", async () => {
      const userId = await makeUser("state-defaults");

      const [saved] = await db.insert(forgeUserLadders).values(state(userId)).returning();

      expect(saved).toMatchObject({
        level: 1,
        bestLevel: 1,
        missStreak: 0,
        temperedHoldWeeks: 0,
        forgedStreak: 0,
        bestForgedStreak: 0,
        lastEvaluatedWeek: null,
      });
    });

    it("holds one row per athlete and ladder", async () => {
      const userId = await makeUser("state-unique");
      await db.insert(forgeUserLadders).values(state(userId));

      await expect(db.insert(forgeUserLadders).values(state(userId))).rejects.toThrow();
      await db.insert(forgeUserLadders).values(state(userId, { ladderKey: "distance" }));
    });

    it("refuses a level below 1 or a negative streak", async () => {
      const userId = await makeUser("state-checks");

      await expect(db.insert(forgeUserLadders).values(state(userId, { level: 0 }))).rejects.toThrow();
      await expect(db.insert(forgeUserLadders).values(state(userId, { missStreak: -1 }))).rejects.toThrow();
    });
  });

  describe("forge_weeks (locked weekly results)", () => {
    it("stores the locked total and the result, keeping numeric precision", async () => {
      const userId = await makeUser("week-store");

      const [saved] = await db.insert(forgeWeeks).values(week(userId)).returning();

      expect(saved).toMatchObject({ total: "2150.00", target: "2000.00", outcome: "hit", levelAfter: 2 });
      expect(saved?.evaluatedAt).toBeInstanceOf(Date);
    });

    it("allows one result per athlete, ladder and week, so a re-run cannot add a second", async () => {
      const userId = await makeUser("week-unique");
      await db.insert(forgeWeeks).values(week(userId));

      await expect(db.insert(forgeWeeks).values(week(userId, { total: "9999.00" }))).rejects.toThrow();
      await db.insert(forgeWeeks).values([
        week(userId, { weekStart: "2026-10-03" }),
        week(userId, { ladderKey: "minutes" }),
      ]);
    });
  });

  describe("forge_rewards (append-only ledger)", () => {
    it("records a Forge mark once per athlete, ladder and level", async () => {
      const userId = await makeUser("mark-once");
      await db.insert(forgeRewards).values(reward(userId));

      const duplicate = await db
        .insert(forgeRewards)
        .values(reward(userId, { weekStart: "2026-10-03" }))
        .onConflictDoNothing()
        .returning();

      expect(duplicate).toEqual([]);
      const rows = await db.select().from(forgeRewards).where(eq(forgeRewards.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    });

    it("records a band badge once per athlete, ladder and band", async () => {
      const userId = await makeUser("badge-once");
      const badge = reward(userId, { type: "band_badge", level: 7, band: "ember" });
      await db.insert(forgeRewards).values(badge);

      await expect(db.insert(forgeRewards).values({ ...badge, weekStart: "2026-10-10" })).rejects.toThrow();
    });

    it("records Forged once per week, so every re-forge is its own row", async () => {
      const userId = await makeUser("forged-weeks");
      const forged = reward(userId, { ladderKey: "consistency", type: "forged", level: 6, band: "forged" });
      await db.insert(forgeRewards).values([forged, { ...forged, weekStart: "2026-11-28" }]);

      await expect(db.insert(forgeRewards).values(forged)).rejects.toThrow();
      const rows = await db
        .select()
        .from(forgeRewards)
        .where(and(eq(forgeRewards.userId, userId), eq(forgeRewards.type, "forged")));
      expect(rows).toHaveLength(2);
    });

    it("keeps a mark, a badge and Forged for the same level apart", async () => {
      const userId = await makeUser("reward-kinds");
      await db.insert(forgeRewards).values([
        reward(userId, { ladderKey: "consistency", level: 6, band: "forged" }),
        reward(userId, { ladderKey: "consistency", type: "band_badge", level: 6, band: "forged" }),
        reward(userId, { ladderKey: "consistency", type: "forged", level: 6, band: "forged" }),
      ]);

      const rows = await db.select().from(forgeRewards).where(eq(forgeRewards.userId, userId));
      expect(rows).toHaveLength(3);
    });
  });

  describe("forge_week_acks", () => {
    it("acknowledges a week once per athlete", async () => {
      const userId = await makeUser("ack-once");
      await db.insert(forgeWeekAcks).values({ userId, weekStart: "2026-09-26" });

      await expect(db.insert(forgeWeekAcks).values({ userId, weekStart: "2026-09-26" })).rejects.toThrow();
    });
  });

  it("deletes every per-athlete Forge row with the account", async () => {
    const userId = await makeUser("cascade");
    await db.insert(forgeUserLadders).values(state(userId));
    await db.insert(forgeWeeks).values(week(userId));
    await db.insert(forgeRewards).values(reward(userId));
    await db.insert(forgeWeekAcks).values({ userId, weekStart: "2026-09-26" });

    await db.delete(users).where(eq(users.id, userId));

    for (const [table, column] of [
      [forgeUserLadders, forgeUserLadders.userId],
      [forgeWeeks, forgeWeeks.userId],
      [forgeRewards, forgeRewards.userId],
      [forgeWeekAcks, forgeWeekAcks.userId],
    ] as const) {
      const rows = await db.select().from(table as never).where(eq(column as never, userId));
      expect(rows).toEqual([]);
    }
  });

  describe("reference tables", () => {
    it("ties a tier to a ladder and keys it by ladder and level", async () => {
      const key = `test-ladder-${Date.now()}`;
      await db.insert(forgeLadders).values({ key, unit: "kg", maxBand: "forged", isPublic: true, sortOrder: 99 });
      try {
        await db.insert(forgeTiers).values({ ladderKey: key, level: 1, band: "ore", target: "2000.00" });
        await expect(
          db.insert(forgeTiers).values({ ladderKey: key, level: 1, band: "ore", target: "2500.00" }),
        ).rejects.toThrow();
        await expect(
          db.insert(forgeTiers).values({ ladderKey: `${key}-missing`, level: 1, band: "ore", target: "1" }),
        ).rejects.toThrow();
      } finally {
        await db.delete(forgeLadders).where(eq(forgeLadders.key, key));
      }
      const orphans = await db.select().from(forgeTiers).where(eq(forgeTiers.ladderKey, key));
      expect(orphans).toEqual([]);
    });
  });

  // It shipped dark (0030) and migration 0031 switched it on everywhere (the user's call, 2026-09-27).
  it("has the weekly_forge flag, switched on by migration 0031", async () => {
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.key, "weekly_forge"));

    expect(flag).toMatchObject({ key: "weekly_forge", enabled: true });
  });

  it("indexes the per-week reads by athlete and week", async () => {
    const result = await db.execute(sql`select indexdef from pg_indexes where tablename = 'forge_weeks'`);
    const definitions = (result.rows as Array<{ indexdef: string }>).map((row) => row.indexdef);

    expect(definitions.some((d) => d.includes("UNIQUE") && d.includes("(user_id, ladder_key, week_start)"))).toBe(true);
    expect(definitions.some((d) => !d.includes("UNIQUE") && d.includes("(user_id, week_start)"))).toBe(true);
  });
});
