import { FORGE_LADDERS } from "@forjd/domain";
import { eq, inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { forgeRewards, forgeUserLadders, forgeWeeks } from "../database/schema/forge.schema";
import { preferences } from "../database/schema/preferences.schema";
import { users } from "../database/schema/users.schema";
import { ForgeEvaluationService } from "./forge-evaluation.service";
import { ForgeStateRepository } from "./forge-state.repository";
import { ForgeTotalsRepository } from "./forge-totals.repository";

/**
 * Against real Postgres, with the real service and totals on top: the claims are enrolment
 * idempotency, what one evaluated week writes, and that two evaluations of one athlete at the same
 * moment -- the hourly job and a `GET /forge` -- write the week once, which only a real row lock
 * can prove.
 */
describe("ForgeStateRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ForgeStateRepository;
  let service: ForgeEvaluationService;
  const emails: string[] = [];

  const makeUser = async (label: string, timeZone: string | null = "Africa/Cairo"): Promise<string> => {
    const email = `forge-state-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    emails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (timeZone !== null) await db.insert(preferences).values({ userId: row!.id, timezone: timeZone });
    return row!.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString, max: 6 });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new ForgeStateRepository(db as unknown as Database);
    service = new ForgeEvaluationService(repository, new ForgeTotalsRepository(db as unknown as Database));
  });

  afterAll(async () => {
    if (emails.length > 0) await db.delete(users).where(inArray(users.email, emails));
    await pool.end();
  });

  it("reads the athlete's stored time zone, or null without a preferences row", async () => {
    expect(await repository.timeZoneOf(await makeUser("tz", "Asia/Dubai"))).toBe("Asia/Dubai");
    expect(await repository.timeZoneOf(await makeUser("no-tz", null))).toBeNull();
  });

  it("enrols every ladder at level 1 once, however many times it is asked", async () => {
    const userId = await makeUser("enrol");

    await repository.enroll(userId, "2026-09-26");
    await repository.enroll(userId, "2026-10-03");

    const rows = await db.select().from(forgeUserLadders).where(eq(forgeUserLadders.userId, userId));
    expect(rows.map((row) => row.ladderKey).sort()).toEqual([...FORGE_LADDERS].sort());
    expect(rows.every((row) => row.level === 1 && row.enrolledWeek === "2026-09-26")).toBe(true);
    expect(await repository.enrolledUserIds()).toContain(userId);
  });

  it("writes nothing when the plan has nothing to evaluate", async () => {
    const userId = await makeUser("nothing");
    await repository.enroll(userId, "2026-09-26");

    expect(await repository.lockAndApply(userId, async () => null)).toBeNull();
    expect(await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId))).toEqual([]);
  });

  it("writes the week's locked results, the new state and the ledger in one go", async () => {
    const userId = await makeUser("write");
    await service.ensureEnrolled(userId, new Date("2026-09-27T09:00:00Z"));

    await service.evaluateDue(userId, new Date("2026-10-03T00:00:00Z"));

    const weeks = await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId));
    expect(weeks).toHaveLength(FORGE_LADDERS.length);
    expect(weeks.every((w) => w.weekStart === "2026-09-26" && w.outcome === "miss" && w.total === "0.00")).toBe(true);
    expect(weeks[0]?.closesAt.toISOString()).toBe("2026-10-02T21:00:00.000Z");

    const states = await db.select().from(forgeUserLadders).where(eq(forgeUserLadders.userId, userId));
    expect(states.every((s) => s.lastEvaluatedWeek === "2026-09-26" && s.missStreak === 1)).toBe(true);
  });

  it("appends a reward to the ledger and skips it, never duplicating, if the same reward comes again", async () => {
    const userId = await makeUser("ledger");
    await repository.enroll(userId, "2026-09-26");
    const reward = { type: "forge_mark" as const, level: 2, band: "ore" as const };
    const planFor = (weekStart: string) => async () => ({
      weekStart,
      timeZone: "Africa/Cairo",
      closesAt: new Date("2026-10-02T21:00:00Z"),
      rulesVersion: 1,
      totals: { consistency: 0, volume: 2000, distance: 0, minutes: 0, nourish: 0 },
      results: [
        {
          ladder: "volume" as const,
          result: {
            outcome: "hit" as const,
            target: 2000,
            levelBefore: 1,
            levelAfter: 2,
            bandBefore: "ore" as const,
            bandAfter: "ore" as const,
            rewards: [reward],
            next: { level: 2, bestLevel: 2, missStreak: 0, temperedHoldWeeks: 0, forgedStreak: 0, bestForgedStreak: 0 },
          },
        },
      ],
    });

    await repository.lockAndApply(userId, planFor("2026-09-26"));
    await repository.lockAndApply(userId, planFor("2026-10-03"));

    const ledger = await db.select().from(forgeRewards).where(eq(forgeRewards.userId, userId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ ladderKey: "volume", type: "forge_mark", level: 2, weekStart: "2026-09-26" });
  });

  it("writes a week once when two evaluations of one athlete run at the same moment", async () => {
    const userId = await makeUser("race");
    await repository.enroll(userId, "2026-09-26");
    const now = new Date("2026-10-10T00:00:00Z");

    const counts = await Promise.all([service.evaluateDue(userId, now), service.evaluateDue(userId, now)]);

    expect(counts.reduce((a, b) => a + b, 0)).toBe(2); // two closed weeks, evaluated once in total
    const weeks = await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId));
    expect(weeks).toHaveLength(2 * FORGE_LADDERS.length);
  });

  it("is a no-op when the job runs again after catching up", async () => {
    const userId = await makeUser("rerun");
    await repository.enroll(userId, "2026-09-26");
    const now = new Date("2026-10-10T00:00:00Z");
    await service.evaluateDue(userId, now);
    const before = await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId));

    expect(await service.evaluateDue(userId, now)).toBe(0);
    expect(await db.select().from(forgeWeeks).where(eq(forgeWeeks.userId, userId))).toEqual(before);
  });
});
