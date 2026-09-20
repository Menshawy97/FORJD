import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { leaderboardRankSnapshots } from "./leaderboards.schema";
import { users } from "./users.schema";

/**
 * Against real Postgres, like the other schema specs: the claims are the table's own constraints
 * (one row per athlete, city, metric, period and week; deleted with the account) and its indexes,
 * which a mock would only prove the author's assumptions about.
 */
describe("leaderboard_rank_snapshots (migration 0021, Phase 10J)", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  const createdEmails: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `lbsnap-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const snapshot = (userId: string, over: Partial<typeof leaderboardRankSnapshots.$inferInsert> = {}) => ({
    userId,
    citySlug: `test-city-${randomUUID()}`,
    metric: "activity",
    period: "month",
    weekStart: "2026-09-21",
    rank: 3,
    score: "87.4",
    cohortSize: 12,
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

  it("stores a rank and score for an athlete in a city for a week, and stamps when it was captured", async () => {
    const userId = await makeUser("store");
    const row = snapshot(userId);

    const [saved] = await db.insert(leaderboardRankSnapshots).values(row).returning();

    expect(saved).toMatchObject({ userId, rank: 3, score: "87.4", cohortSize: 12, weekStart: "2026-09-21" });
    expect(saved?.capturedAt).toBeInstanceOf(Date);
    expect(saved?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("allows one row per athlete, city, metric, period and week, and refuses a duplicate", async () => {
    const userId = await makeUser("unique");
    const row = snapshot(userId);
    await db.insert(leaderboardRankSnapshots).values(row);

    await expect(db.insert(leaderboardRankSnapshots).values({ ...row, rank: 9 })).rejects.toThrow();
  });

  it("allows the same athlete another week, another period, another metric or another city", async () => {
    const userId = await makeUser("variants");
    const row = snapshot(userId);
    await db.insert(leaderboardRankSnapshots).values([
      row,
      { ...row, weekStart: "2026-09-28" },
      { ...row, period: "all_time" },
      { ...row, metric: "strength" },
      { ...row, citySlug: `${row.citySlug}-other` },
    ]);

    const rows = await db.select().from(leaderboardRankSnapshots).where(eq(leaderboardRankSnapshots.userId, userId));
    expect(rows).toHaveLength(5);
  });

  it("is deleted with the account, so a deleted athlete leaves no rank history behind", async () => {
    const userId = await makeUser("cascade");
    await db.insert(leaderboardRankSnapshots).values(snapshot(userId));

    await db.delete(users).where(eq(users.id, userId));

    const rows = await db.select().from(leaderboardRankSnapshots).where(eq(leaderboardRankSnapshots.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("keeps a score with one decimal place, the precision the screen shows", async () => {
    const userId = await makeUser("precision");
    const [saved] = await db.insert(leaderboardRankSnapshots).values(snapshot(userId, { score: "100.0" })).returning();
    expect(saved?.score).toBe("100.0");
  });

  describe("indexes", () => {
    const definitions = async (): Promise<string[]> => {
      const result = await db.execute(
        sql`select indexdef from pg_indexes where tablename = 'leaderboard_rank_snapshots'`,
      );
      return (result.rows as Array<{ indexdef: string }>).map((row) => row.indexdef);
    };

    it("has the unique key that makes a week's rows one per athlete", async () => {
      const found = (await definitions()).find((d) => d.includes("UNIQUE") && d.includes("(user_id, city_slug, metric, period, week_start)"));
      expect(found).toBeDefined();
    });

    it("has a lookup index shaped like the read: one city, metric and period across weeks", async () => {
      const found = (await definitions()).find((d) => !d.includes("UNIQUE") && d.includes("(city_slug, metric, period, week_start)"));
      expect(found).toBeDefined();
    });
  });
});
