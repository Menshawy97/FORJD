import { eq, inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { forgeRewards, forgeUserLadders, forgeWeeks } from "../database/schema/forge.schema";
import { preferences } from "../database/schema/preferences.schema";
import { users } from "../database/schema/users.schema";
import { ForgeReadRepository, PENDING_WEEK_LIMIT } from "./forge-read.repository";

/** Against real Postgres: per-athlete scoping, the unseen-week read, and the two small writes. */
describe("ForgeReadRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ForgeReadRepository;
  const emails: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `forge-read-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    emails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    return row!.id;
  };

  const week = (userId: string, weekStart: string, ladderKey = "volume") => ({
    userId,
    ladderKey,
    weekStart,
    timeZone: "Africa/Cairo",
    closesAt: new Date(`${weekStart}T21:00:00Z`),
    total: "2100.00",
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
  });

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new ForgeReadRepository(db as unknown as Database);
  });

  afterAll(async () => {
    if (emails.length > 0) await db.delete(users).where(inArray(users.email, emails));
    await pool.end();
  });

  it("reads the athlete's ladders and band badges, and nobody else's", async () => {
    const userId = await makeUser("ladders");
    const other = await makeUser("other");
    await db.insert(forgeUserLadders).values([
      { userId, ladderKey: "volume", level: 7, bestLevel: 7, enrolledWeek: "2026-09-19" },
      { userId: other, ladderKey: "volume", level: 3, bestLevel: 3, enrolledWeek: "2026-09-19" },
    ]);
    await db.insert(forgeRewards).values([
      { userId, ladderKey: "volume", type: "band_badge", level: 7, band: "ember", weekStart: "2026-09-19" },
      { userId, ladderKey: "volume", type: "forge_mark", level: 7, band: "ember", weekStart: "2026-09-19" },
    ]);

    expect(await repository.ladders(userId)).toEqual([
      { ladder: "volume", level: 7, missStreak: 0, temperedHoldWeeks: 0, forgedStreak: 0, bestForgedStreak: 0 },
    ]);
    expect(await repository.badges(userId)).toEqual([{ ladder: "volume", band: "ember" }]);
  });

  it("returns unseen closed weeks oldest first, with each ladder's rewards, and forgets acknowledged ones", async () => {
    const userId = await makeUser("pending");
    await db
      .insert(forgeWeeks)
      .values([week(userId, "2026-09-12"), week(userId, "2026-09-19"), week(userId, "2026-09-19", "minutes")]);
    await db
      .insert(forgeRewards)
      .values({ userId, ladderKey: "volume", type: "forge_mark", level: 2, band: "ore", weekStart: "2026-09-19" });

    const pending = await repository.pendingWeeks(userId);
    expect(pending.map((w) => w.weekStart)).toEqual(["2026-09-12", "2026-09-19"]);
    const latest = pending[1]!;
    expect(latest.ladders.map((l) => l.ladder)).toEqual(["minutes", "volume"]);
    expect(latest.ladders[1]).toMatchObject({
      total: 2100,
      target: 2000,
      rewards: [{ type: "forge_mark", level: 2, band: "ore" }],
    });

    await repository.acknowledge(userId, "2026-09-12");
    await repository.acknowledge(userId, "2026-09-12");

    expect((await repository.pendingWeeks(userId)).map((w) => w.weekStart)).toEqual(["2026-09-19"]);
  });

  it("caps the unseen weeks at the most recent few", async () => {
    const userId = await makeUser("cap");
    const weeks = Array.from({ length: PENDING_WEEK_LIMIT + 2 }, (_, i) =>
      week(userId, new Date(Date.UTC(2026, 0, 3 + 7 * i)).toISOString().slice(0, 10)),
    );
    await db.insert(forgeWeeks).values(weeks);

    const pending = await repository.pendingWeeks(userId);
    expect(pending).toHaveLength(PENDING_WEEK_LIMIT);
    expect(pending[pending.length - 1]?.weekStart).toBe(weeks[weeks.length - 1]!.weekStart);
  });

  it("knows which weeks the athlete has, and returns nothing pending for a new athlete", async () => {
    const userId = await makeUser("has");
    await db.insert(forgeWeeks).values(week(userId, "2026-09-19"));

    expect(await repository.hasWeek(userId, "2026-09-19")).toBe(true);
    expect(await repository.hasWeek(userId, "2026-09-12")).toBe(false);
    expect(await repository.pendingWeeks(await makeUser("new"))).toEqual([]);
  });

  it("stores the time zone, creating the preferences row or updating it", async () => {
    const userId = await makeUser("tz");

    await repository.setTimeZone(userId, "Africa/Cairo");
    await repository.setTimeZone(userId, "Asia/Dubai");

    const rows = await db.select().from(preferences).where(eq(preferences.userId, userId));
    expect(rows.map((r) => r.timezone)).toEqual(["Asia/Dubai"]);
  });
});
