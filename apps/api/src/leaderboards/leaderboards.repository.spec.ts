import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ACTIVITY_SESSION_CAP_SECONDS } from "@forjd/domain";

import { Database } from "../database/database.module";
import { exercises } from "../database/schema/exercises.schema";
import { privacySettings } from "../database/schema/privacy-settings.schema";
import { profiles } from "../database/schema/profiles.schema";
import { users } from "../database/schema/users.schema";
import { workoutSessions } from "../database/schema/workouts.schema";
import { ExercisesRepository } from "../exercises/exercises.repository";
import { CreateWorkoutSessionExerciseInput, CreateWorkoutSessionInput, WorkoutsRepository } from "../workouts/workouts.repository";
import { LeaderboardsRepository } from "./leaderboards.repository";

/**
 * Against real Postgres, like `progress.repository.spec.ts`: the behaviour under test is the
 * eligibility predicate and the aggregation across sessions, sets and consent, which a mock would
 * only prove the author's own assumptions about. Each case pins one rule of ADR-046: a session
 * counts only if it was run through the live runner, in this city, inside the window, by an
 * athlete who has joined leaderboards AND allowed location right now.
 */
describe("LeaderboardsRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: LeaderboardsRepository;
  let workoutsRepository: WorkoutsRepository;
  let exercisesRepository: ExercisesRepository;
  const createdUserEmails: string[] = [];
  const createdExerciseIds: string[] = [];
  const createdSessionIds: string[] = [];

  // A city slug unique to this run, so leftovers from another run can never be counted.
  const SLUG = `alexandria-eg-test-${randomUUID()}`;
  const OTHER_SLUG = `cairo-eg-test-${randomUUID()}`;
  const ZONE = "Africa/Cairo"; // UTC+3 in September 2026
  const WINDOW = {
    start: new Date("2026-08-31T21:00:00Z"), // 1 September 00:00 in Cairo
    end: new Date("2026-09-30T21:00:00Z"), // 1 October 00:00 in Cairo
  };
  let exerciseId: string;

  const makeUser = async (
    label: string,
    options: {
      optIn?: boolean;
      location?: boolean;
      publicProfile?: boolean;
      profile?: { displayName: string | null; username: string | null; avatarUrl: string | null } | null;
    } = {},
  ): Promise<string> => {
    const email = `lbrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    await db.insert(privacySettings).values({
      userId: row.id,
      leaderboardOptIn: options.optIn ?? true,
      locationForLeaderboard: options.location ?? true,
      publicProfile: options.publicProfile ?? false,
    });
    const profile = options.profile === undefined ? { displayName: `Athlete ${label}`, username: `ath_${label}`, avatarUrl: null } : options.profile;
    if (profile) await db.insert(profiles).values({ userId: row.id, ...profile });
    return row.id;
  };

  const setOf = (
    weightKg: number | null,
    reps: number | null,
    over: Partial<{ isCompleted: boolean; distanceMeters: number | null }> = {},
  ) => ({
    type: "working" as const,
    isCompleted: over.isCompleted ?? true,
    weightKg,
    reps,
    durationSeconds: null,
    distanceMeters: over.distanceMeters ?? null,
    restSeconds: null,
    completedAt: null,
  });

  const withSets = (sets: ReturnType<typeof setOf>[]): CreateWorkoutSessionExerciseInput[] => [
    { exerciseId, measure: "weight", notes: null, sets },
  ];

  const sessionFor = (
    userId: string,
    startedAt: string,
    over: Partial<CreateWorkoutSessionInput> = {},
  ): CreateWorkoutSessionInput => ({
    id: randomUUID(),
    userId,
    templateId: null,
    name: "Session",
    activity: "strength",
    status: "completed",
    startedAt: new Date(startedAt),
    endedAt: new Date(new Date(startedAt).getTime() + 45 * 60 * 1000),
    durationSeconds: 2700,
    perceivedEffort: null,
    notes: null,
    city: "Alexandria",
    citySlug: SLUG,
    isLiveTracked: true,
    exercises: [],
    ...over,
  });

  const save = async (input: CreateWorkoutSessionInput) => {
    const saved = await workoutsRepository.upsertSession(input);
    createdSessionIds.push(saved.id);
    return saved;
  };

  const athletes = (window: { start: Date; end: Date } | null = WINDOW, slug = SLUG) =>
    repository.cityAthletes(slug, ZONE, window);

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new LeaderboardsRepository(db as unknown as Database);
    workoutsRepository = new WorkoutsRepository(db);
    exercisesRepository = new ExercisesRepository(db);
    const exercise = await exercisesRepository.upsertCatalogueExercise({
      source: "test",
      sourceId: `lbrepo-${randomUUID()}`,
      name: `Test Bench ${randomUUID()}`,
      slug: `test-bench-${randomUUID()}`,
      category: "strength",
      goal: "strength",
      measure: "weight",
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: [],
      force: null,
      level: null,
      mechanic: null,
      instructions: [],
      imageKeys: [],
      description: null,
    });
    exerciseId = exercise.id;
    createdExerciseIds.push(exercise.id);
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    if (createdUserEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdUserEmails));
    }
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    await pool.end();
  });

  describe("cityAthletes: what is counted", () => {
    it("sums working time across sessions, capping each session, and reports the earliest start", async () => {
      const userId = await makeUser("time");
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { durationSeconds: 1800 }));
      await save(sessionFor(userId, "2026-09-03T10:00:00Z", { durationSeconds: 3600 }));
      // A nine-hour "session" left running counts for two hours, not nine.
      await save(sessionFor(userId, "2026-09-09T10:00:00Z", { durationSeconds: 9 * 3600 }));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.workingSeconds).toBe(1800 + 3600 + ACTIVITY_SESSION_CAP_SECONDS);
      expect(row?.firstStartedAt.toISOString()).toBe("2026-09-03T10:00:00.000Z");
    });

    it("sums volume as weight times reps over completed sets only, and distance in kilometres", async () => {
      const userId = await makeUser("volume");
      await save(
        sessionFor(userId, "2026-09-05T10:00:00Z", {
          exercises: withSets([
            setOf(100, 5), // 500
            setOf(60, 10), // 600
            setOf(200, 5, { isCompleted: false }), // not done: not counted
            setOf(null, 8), // no weight: not counted
            setOf(50, null), // no reps: not counted
            setOf(null, null, { distanceMeters: 2500 }),
            setOf(null, null, { distanceMeters: 1500, isCompleted: false }), // not done
          ]),
        }),
      );

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.volumeKg).toBeCloseTo(1100);
      expect(row?.distanceKm).toBeCloseTo(2.5);
    });

    it("counts a session with no sets for its time but not for volume", async () => {
      const userId = await makeUser("empty");
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { durationSeconds: 1200, exercises: [] }));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.workingSeconds).toBe(1200);
      expect(row?.volumeKg).toBe(0);
      expect(row?.strengthDays).toBe(0);
    });

    it("counts distinct local days that carry a completed weighted set", async () => {
      const userId = await makeUser("days");
      const weighted = withSets([setOf(80, 5)]);
      await save(sessionFor(userId, "2026-09-05T08:00:00Z", { exercises: weighted }));
      // Same local day: still one strength day.
      await save(sessionFor(userId, "2026-09-05T15:00:00Z", { exercises: weighted }));
      await save(sessionFor(userId, "2026-09-07T08:00:00Z", { exercises: weighted }));
      // A day with only bodyweight or distance work is not a strength day.
      await save(sessionFor(userId, "2026-09-08T08:00:00Z", { exercises: withSets([setOf(null, 20)]) }));
      // A day whose only weighted set was not completed is not a strength day either.
      await save(sessionFor(userId, "2026-09-09T08:00:00Z", { exercises: withSets([setOf(80, 5, { isCompleted: false })]) }));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.strengthDays).toBe(2);
    });

    it("dates a session by the CITY's calendar, so 23:30 UTC is already tomorrow in Cairo", async () => {
      const userId = await makeUser("zone");
      const weighted = withSets([setOf(80, 5)]);
      // 21:30 UTC on the 5th is 00:30 on the 6th in Cairo; 09:00 UTC on the 6th is the same local day.
      await save(sessionFor(userId, "2026-09-05T21:30:00Z", { exercises: weighted }));
      await save(sessionFor(userId, "2026-09-06T09:00:00Z", { exercises: weighted }));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.strengthDays).toBe(1);
    });
  });

  describe("cityAthletes: the window", () => {
    it("includes the first instant of the window and excludes its end", async () => {
      const userId = await makeUser("edges");
      await save(sessionFor(userId, WINDOW.start.toISOString(), { durationSeconds: 600 }));
      await save(sessionFor(userId, WINDOW.end.toISOString(), { durationSeconds: 700 }));
      await save(sessionFor(userId, new Date(WINDOW.start.getTime() - 1000).toISOString(), { durationSeconds: 800 }));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.workingSeconds).toBe(600);
    });

    it("counts every session when there is no window (all time)", async () => {
      const userId = await makeUser("alltime");
      await save(sessionFor(userId, "2025-01-05T10:00:00Z", { durationSeconds: 600 }));
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { durationSeconds: 900 }));

      const row = (await athletes(null)).find((r) => r.userId === userId);

      expect(row?.workingSeconds).toBe(1500);
      expect(row?.firstStartedAt.toISOString()).toBe("2025-01-05T10:00:00.000Z");
    });

    it("leaves out an athlete with nothing in the window", async () => {
      const userId = await makeUser("outside");
      await save(sessionFor(userId, "2026-07-05T10:00:00Z"));

      expect((await athletes()).find((r) => r.userId === userId)).toBeUndefined();
    });
  });

  describe("cityAthletes: what is never counted", () => {
    const expectNotCounted = async (label: string, over: Partial<CreateWorkoutSessionInput>) => {
      const userId = await makeUser(label);
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", over));
      expect((await athletes()).find((r) => r.userId === userId)).toBeUndefined();
    };

    it("a session that was not run through the live runner (typed in afterwards)", () =>
      expectNotCounted("notlive", { isLiveTracked: false }));

    it("a session in another city", () => expectNotCounted("othercity", { citySlug: OTHER_SLUG }));

    it("a session with no city", () => expectNotCounted("nocity", { city: null, citySlug: null }));

    it("a cancelled or unfinished session", async () => {
      await expectNotCounted("cancelled", { status: "cancelled" });
      await expectNotCounted("inprogress", { status: "in_progress", endedAt: null });
    });

    it("a session with no end time, even if marked completed", () => expectNotCounted("noend", { endedAt: null }));

    it("a soft-deleted session", async () => {
      const userId = await makeUser("deleted");
      const saved = await save(sessionFor(userId, "2026-09-05T10:00:00Z"));
      await db.update(workoutSessions).set({ deletedAt: new Date() }).where(inArray(workoutSessions.id, [saved.id]));

      expect((await athletes()).find((r) => r.userId === userId)).toBeUndefined();
    });

    it("an athlete who has not joined leaderboards", async () => {
      const userId = await makeUser("notopted", { optIn: false, location: false });
      await save(sessionFor(userId, "2026-09-05T10:00:00Z"));

      expect((await athletes()).find((r) => r.userId === userId)).toBeUndefined();
    });

    it("an athlete who joined but did not allow location", async () => {
      const userId = await makeUser("nolocation", { optIn: true, location: false });
      await save(sessionFor(userId, "2026-09-05T10:00:00Z"));

      expect((await athletes()).find((r) => r.userId === userId)).toBeUndefined();
    });

    it("an athlete who withdraws is gone on the very next read, with their sessions untouched", async () => {
      const userId = await makeUser("withdraws");
      await save(sessionFor(userId, "2026-09-05T10:00:00Z"));
      expect((await athletes()).find((r) => r.userId === userId)).toBeDefined();

      await db.update(privacySettings).set({ leaderboardOptIn: false, locationForLeaderboard: false }).where(inArray(privacySettings.userId, [userId]));

      expect((await athletes()).find((r) => r.userId === userId)).toBeUndefined();
    });
  });

  describe("cityAthletes: who is shown", () => {
    it("returns name, username, avatar and whether the profile is public", async () => {
      const userId = await makeUser("shown", {
        publicProfile: true,
        profile: { displayName: "James M.", username: "jamesm", avatarUrl: "https://example.com/a.png" },
      });
      await save(sessionFor(userId, "2026-09-05T10:00:00Z"));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row).toMatchObject({
        displayName: "James M.",
        username: "jamesm",
        avatarUrl: "https://example.com/a.png",
        isPublicProfile: true,
      });
    });

    it("keeps a private profile in the list, marked private, with its name", async () => {
      const userId = await makeUser("private", { publicProfile: false });
      await save(sessionFor(userId, "2026-09-05T10:00:00Z"));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row?.isPublicProfile).toBe(false);
      expect(row?.displayName).toBe("Athlete private");
    });

    it("returns nulls, not a failure, for an athlete who has no profile row", async () => {
      const userId = await makeUser("noprofile", { profile: null });
      await save(sessionFor(userId, "2026-09-05T10:00:00Z"));

      const row = (await athletes()).find((r) => r.userId === userId);

      expect(row).toMatchObject({ displayName: null, username: null, avatarUrl: null });
    });

    it("returns one row per athlete however many sessions they have", async () => {
      const userId = await makeUser("many");
      for (const day of ["03", "05", "07"]) await save(sessionFor(userId, `2026-09-${day}T10:00:00Z`));

      expect((await athletes()).filter((r) => r.userId === userId)).toHaveLength(1);
    });
  });

  describe("currentMembers (read live on every board request)", () => {
    it("returns each athlete still in, with their current name, photo and profile setting", async () => {
      const userId = await makeUser("member", {
        publicProfile: true,
        profile: { displayName: "Sara K.", username: "sarak", avatarUrl: "https://example.com/s.png" },
      });

      const members = await repository.currentMembers([userId]);

      expect(members.get(userId)).toEqual({
        displayName: "Sara K.",
        username: "sarak",
        avatarUrl: "https://example.com/s.png",
        isPublicProfile: true,
      });
    });

    it("leaves out an athlete who has withdrawn or not allowed location, the moment they do", async () => {
      const stays = await makeUser("stays");
      const withdraws = await makeUser("leaves");
      const noLocation = await makeUser("nolocmember", { location: false });

      await db.update(privacySettings).set({ leaderboardOptIn: false }).where(inArray(privacySettings.userId, [withdraws]));
      const members = await repository.currentMembers([stays, withdraws, noLocation]);

      expect([...members.keys()]).toEqual([stays]);
    });

    it("returns nulls for an athlete with no profile row, and nothing for no ids", async () => {
      const userId = await makeUser("memberbare", { profile: null });

      expect((await repository.currentMembers([userId])).get(userId)).toEqual({
        displayName: null,
        username: null,
        avatarUrl: null,
        isPublicProfile: false,
      });
      expect((await repository.currentMembers([])).size).toBe(0);
    });
  });

  describe("latestEligibleCity", () => {
    it("is the city of the most recent eligible session", async () => {
      const userId = await makeUser("latest");
      await save(sessionFor(userId, "2026-08-01T10:00:00Z", { city: "Cairo", citySlug: OTHER_SLUG }));
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { city: "Alexandria", citySlug: SLUG }));

      await expect(repository.latestEligibleCity(userId)).resolves.toEqual({ citySlug: SLUG, city: "Alexandria" });
    });

    it("follows the athlete when they move, because it reads the newest session and not their profile", async () => {
      const userId = await makeUser("moved");
      await save(sessionFor(userId, "2026-08-01T10:00:00Z", { city: "Alexandria", citySlug: SLUG }));
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { city: "Cairo", citySlug: OTHER_SLUG }));

      await expect(repository.latestEligibleCity(userId)).resolves.toEqual({ citySlug: OTHER_SLUG, city: "Cairo" });
    });

    it("skips sessions that could never count", async () => {
      const userId = await makeUser("skips");
      await save(sessionFor(userId, "2026-08-01T10:00:00Z", { city: "Alexandria", citySlug: SLUG }));
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { city: "Cairo", citySlug: OTHER_SLUG, isLiveTracked: false }));
      await save(sessionFor(userId, "2026-09-06T10:00:00Z", { city: "Cairo", citySlug: OTHER_SLUG, status: "cancelled" }));
      await save(sessionFor(userId, "2026-09-07T10:00:00Z", { city: null, citySlug: null }));

      await expect(repository.latestEligibleCity(userId)).resolves.toEqual({ citySlug: SLUG, city: "Alexandria" });
    });

    it("is null when the athlete has no eligible session", async () => {
      const userId = await makeUser("none");
      await save(sessionFor(userId, "2026-09-05T10:00:00Z", { isLiveTracked: false }));

      await expect(repository.latestEligibleCity(userId)).resolves.toBeNull();
    });

    it("never returns another athlete's city", async () => {
      const mine = await makeUser("mine");
      const theirs = await makeUser("theirs");
      await save(sessionFor(theirs, "2026-09-05T10:00:00Z"));

      await expect(repository.latestEligibleCity(mine)).resolves.toBeNull();
    });
  });
});
