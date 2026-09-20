import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { leaderboardRankSnapshots } from "../database/schema/leaderboards.schema";
import { privacySettings } from "../database/schema/privacy-settings.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions } from "../database/schema/workouts.schema";
import { WorkoutsRepository } from "../workouts/workouts.repository";
import { LeaderboardSnapshotRepository } from "./leaderboard-snapshot.repository";

/**
 * Against real Postgres: the claims are that a week is replaced wholesale and never patched
 * (CLAUDE.md rule 9), that the baseline read finds the right week, and that "which cities are
 * worth snapshotting" applies the same eligibility rule as the board itself.
 */
describe("LeaderboardSnapshotRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: LeaderboardSnapshotRepository;
  let workoutsRepository: WorkoutsRepository;
  const createdEmails: string[] = [];
  const createdSessionIds: string[] = [];
  const SLUG = `snap-city-${randomUUID()}`;

  const makeUser = async (label: string, options: { optIn?: boolean; location?: boolean } = {}): Promise<string> => {
    const email = `lbsnaprepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    await db.insert(privacySettings).values({
      userId: row.id,
      leaderboardOptIn: options.optIn ?? true,
      locationForLeaderboard: options.location ?? true,
    });
    return row.id;
  };

  const train = async (userId: string, citySlug: string, over: { isLiveTracked?: boolean } = {}) => {
    const saved = await workoutsRepository.upsertSession({
      id: randomUUID(),
      userId,
      templateId: null,
      name: "Session",
      activity: "strength",
      status: "completed",
      startedAt: new Date("2026-09-05T10:00:00Z"),
      endedAt: new Date("2026-09-05T10:45:00Z"),
      durationSeconds: 2700,
      perceivedEffort: null,
      notes: null,
      city: "Test",
      citySlug,
      isLiveTracked: over.isLiveTracked ?? true,
      exercises: [],
    });
    createdSessionIds.push(saved.id);
  };

  const row = (userId: string, rank: number, score = 50) => ({ userId, rank, score, cohortSize: 3 });

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new LeaderboardSnapshotRepository(db as unknown as Database);
    workoutsRepository = new WorkoutsRepository(db);
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    if (createdEmails.length > 0) await db.delete(users).where(inArray(users.email, createdEmails));
    await pool.end();
  });

  describe("eligibleCities", () => {
    it("lists a city with enough eligible athletes, and only that city", async () => {
      const enough = `${SLUG}-enough`;
      const tooFew = `${SLUG}-few`;
      for (let n = 0; n < 5; n += 1) await train(await makeUser(`e${n}`), enough);
      for (let n = 0; n < 4; n += 1) await train(await makeUser(`f${n}`), tooFew);

      const cities = await repository.eligibleCities(5);

      expect(cities).toContain(enough);
      expect(cities).not.toContain(tooFew);
    });

    it("does not count athletes who are not opted in, did not allow location, or trained outside the runner", async () => {
      const slug = `${SLUG}-mixed`;
      for (let n = 0; n < 3; n += 1) await train(await makeUser(`m${n}`), slug);
      await train(await makeUser("out", { optIn: false }), slug);
      await train(await makeUser("noloc", { location: false }), slug);
      await train(await makeUser("manual"), slug, { isLiveTracked: false });

      expect(await repository.eligibleCities(5)).not.toContain(slug);
      expect(await repository.eligibleCities(3)).toContain(slug);
    });
  });

  describe("replaceWeek", () => {
    const rowsOf = (slug: string, period = "month") =>
      db
        .select()
        .from(leaderboardRankSnapshots)
        .where(eq(leaderboardRankSnapshots.citySlug, slug))
        .then((all) => all.filter((r) => r.period === period));

    it("writes a row per athlete with the rank, score and cohort size", async () => {
      const slug = `${SLUG}-write`;
      const [a, b] = [await makeUser("wa"), await makeUser("wb")];

      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 1, 91.5), row(b, 2, 40)]);

      const saved = await rowsOf(slug);
      expect(saved.map((r) => [r.userId, r.rank, r.score, r.cohortSize, r.weekStart]).sort()).toEqual(
        [
          [a, 1, "91.5", 3, "2026-09-21"],
          [b, 2, "40.0", 3, "2026-09-21"],
        ].sort(),
      );
    });

    it("replaces a re-run of the same week rather than duplicating it, and drops athletes who left the board", async () => {
      const slug = `${SLUG}-rerun`;
      const [a, b] = [await makeUser("ra"), await makeUser("rb")];
      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 1), row(b, 2)]);

      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(b, 1)]);

      const saved = await rowsOf(slug);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ userId: b, rank: 1 });
    });

    it("leaves other weeks, periods and metrics of the same city alone", async () => {
      const slug = `${SLUG}-others`;
      const a = await makeUser("oa");
      await repository.replaceWeek(slug, "activity", "month", "2026-09-14", [row(a, 4)]);
      await repository.replaceWeek(slug, "activity", "all_time", "2026-09-21", [row(a, 5)]);
      await repository.replaceWeek(slug, "strength", "month", "2026-09-21", [row(a, 6)]);

      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 1)]);

      const all = await db.select().from(leaderboardRankSnapshots).where(eq(leaderboardRankSnapshots.citySlug, slug));
      expect(all).toHaveLength(4);
    });

    it("is atomic: a failing insert leaves the previous week's rows in place", async () => {
      const slug = `${SLUG}-atomic`;
      const a = await makeUser("aa");
      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 1)]);

      // The same athlete twice violates the unique key partway through the insert.
      await expect(
        repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 2), row(a, 3)]),
      ).rejects.toThrow();

      expect((await rowsOf(slug))[0]).toMatchObject({ userId: a, rank: 1 });
    });

    it("writes nothing for an empty week", async () => {
      const slug = `${SLUG}-empty`;
      await expect(repository.replaceWeek(slug, "activity", "month", "2026-09-21", [])).resolves.toBeUndefined();
      expect(await rowsOf(slug)).toHaveLength(0);
    });
  });

  describe("baselineRanks", () => {
    it("returns each athlete's rank from the snapshot of exactly that week", async () => {
      const slug = `${SLUG}-base`;
      const [a, b] = [await makeUser("ba"), await makeUser("bb")];
      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 2), row(b, 7)]);

      const ranks = await repository.baselineRanks(slug, "activity", "month", "2026-09-21", "2026-09-01");

      expect(ranks.get(a)).toBe(2);
      expect(ranks.get(b)).toBe(7);
    });

    it("falls back to the latest earlier week when this week has not been captured yet", async () => {
      const slug = `${SLUG}-fallback`;
      const a = await makeUser("fa");
      await repository.replaceWeek(slug, "activity", "month", "2026-09-07", [row(a, 9)]);
      await repository.replaceWeek(slug, "activity", "month", "2026-09-14", [row(a, 5)]);

      const ranks = await repository.baselineRanks(slug, "activity", "month", "2026-09-21", "2026-09-01");

      expect(ranks.get(a)).toBe(5);
    });

    it("does not go back past the floor: too old to be this week's baseline", async () => {
      const slug = `${SLUG}-floor`;
      const a = await makeUser("ha");
      await repository.replaceWeek(slug, "activity", "month", "2026-08-31", [row(a, 3)]);

      expect((await repository.baselineRanks(slug, "activity", "month", "2026-09-21", "2026-09-01")).size).toBe(0);
      expect((await repository.baselineRanks(slug, "activity", "month", "2026-09-21", "2026-08-31")).get(a)).toBe(3);
    });

    it("never looks forward: a later week is not a baseline", async () => {
      const slug = `${SLUG}-forward`;
      const a = await makeUser("ga");
      await repository.replaceWeek(slug, "activity", "month", "2026-09-28", [row(a, 1)]);

      expect((await repository.baselineRanks(slug, "activity", "month", "2026-09-21", "2026-09-01")).size).toBe(0);
    });

    it("is empty for a city, metric or period nothing was captured for", async () => {
      const slug = `${SLUG}-nothing`;
      const a = await makeUser("na");
      await repository.replaceWeek(slug, "activity", "month", "2026-09-21", [row(a, 1)]);

      expect((await repository.baselineRanks(`${slug}-x`, "activity", "month", "2026-09-21", "2026-09-01")).size).toBe(0);
      expect((await repository.baselineRanks(slug, "strength", "month", "2026-09-21", "2026-09-01")).size).toBe(0);
      expect((await repository.baselineRanks(slug, "activity", "all_time", "2026-09-21", "2026-09-01")).size).toBe(0);
    });
  });
});
