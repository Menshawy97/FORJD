import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { exercises } from "../database/schema/exercises.schema";
import { users } from "../database/schema/users.schema";
import {
  programEnrollments,
  programWorkouts,
  programs,
  workoutBlocks,
  workoutExercises,
  workoutTemplates,
} from "../database/schema/workouts.schema";
import { ProgramsRepository } from "./programs.repository";

/**
 * Exercised against real Postgres, not a mock, for the same reason the seed suite is: what is
 * under test *is* the SQL. The visibility predicate, the `array_agg` that keeps a workout's
 * exercise names in the design's order, the correlated count that must not multiply the program
 * row, and `owner = :user` arriving as SQL NULL rather than false for a preset are all things a
 * fake would merely restate.
 *
 * **It builds its own fixtures rather than reading the seeded catalogue.** The nine real programs
 * are present in a developer database and absent in a fresh CI one, and a suite that asserted on
 * them would really be testing whether `programs:seed` had run. Everything here is created with a
 * unique marker and removed afterwards.
 */
describe("ProgramsRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  const marker = `progrepo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ProgramsRepository;

  let ownerId: string;
  let strangerId: string;
  let benchId: string;
  let rowId: string;

  const createdProgramIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdExerciseIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const [row] = await db
      .insert(users)
      .values({ email: `${marker}-${label}@example.com` })
      .returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  const makeExercise = async (name: string): Promise<string> => {
    const [row] = await db
      .insert(exercises)
      .values({
        name: `${marker} ${name}`,
        slug: `${marker}-${name.toLowerCase()}-${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
      })
      .returning();
    if (!row) throw new Error("insert did not return a row");
    createdExerciseIds.push(row.id);
    return row.id;
  };

  /** A catalogue template with one `straight_sets` block, shaped like the seed's own output. */
  const makeTemplate = async (
    name: string,
    activity: string,
    exerciseIds: string[],
  ): Promise<string> => {
    const [template] = await db
      .insert(workoutTemplates)
      .values({ ownerUserId: null, name: `${marker} ${name}`, activity })
      .returning();
    if (!template) throw new Error("insert did not return a row");
    createdTemplateIds.push(template.id);

    const [block] = await db
      .insert(workoutBlocks)
      .values({ templateId: template.id, type: "straight_sets", orderIndex: 0 })
      .returning();
    if (!block) throw new Error("insert did not return a row");

    if (exerciseIds.length > 0) {
      await db.insert(workoutExercises).values(
        exerciseIds.map((exerciseId, orderIndex) => ({
          blockId: block.id,
          exerciseId,
          orderIndex,
          setCount: 3,
        })),
      );
    }
    return template.id;
  };

  const makeProgram = async (input: {
    slug: string;
    name: string;
    ownerUserId?: string | null;
    category?: string;
    level?: string;
    daysPerWeek?: number;
    durationWeeks?: number;
    description?: string | null;
    deletedAt?: Date | null;
  }): Promise<string> => {
    const [row] = await db
      .insert(programs)
      .values({
        ownerUserId: input.ownerUserId ?? null,
        name: input.name,
        slug: `${marker}-${input.slug}`,
        category: input.category ?? "strength",
        level: input.level ?? "intermediate",
        daysPerWeek: input.daysPerWeek ?? 3,
        durationWeeks: input.durationWeeks ?? 8,
        description: input.description === undefined ? "A description" : input.description,
        deletedAt: input.deletedAt ?? null,
      })
      .returning();
    if (!row) throw new Error("insert did not return a row");
    createdProgramIds.push(row.id);
    return row.id;
  };

  const link = async (
    programId: string,
    templateId: string,
    orderIndex: number,
    dayOfWeek: number | null = null,
  ): Promise<void> => {
    await db.insert(programWorkouts).values({ programId, templateId, orderIndex, dayOfWeek });
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool);
    repository = new ProgramsRepository(db);

    ownerId = await makeUser("owner");
    strangerId = await makeUser("stranger");
    benchId = await makeExercise("Bench");
    rowId = await makeExercise("Row");
  });

  afterAll(async () => {
    // Programs first: `program_workouts` cascades from them, and `template_id` is `restrict`, so
    // the join rows have to be gone before any template can be removed.
    if (createdProgramIds.length > 0) {
      await db.delete(programs).where(inArray(programs.id, createdProgramIds));
    }
    if (createdTemplateIds.length > 0) {
      await db.delete(workoutTemplates).where(inArray(workoutTemplates.id, createdTemplateIds));
    }
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  describe("listForUser", () => {
    let presetId: string;
    let ownId: string;
    let strangersId: string;

    beforeAll(async () => {
      presetId = await makeProgram({ slug: "preset", name: `${marker} A Preset` });
      ownId = await makeProgram({
        slug: "own",
        name: `${marker} B Mine`,
        ownerUserId: ownerId,
        category: "running",
      });
      strangersId = await makeProgram({
        slug: "strangers",
        name: `${marker} C Theirs`,
        ownerUserId: strangerId,
      });
      await makeProgram({ slug: "deleted", name: `${marker} D Deleted`, deletedAt: new Date() });
    });

    const listed = async (
      scope: "preset" | "mine" | "all",
      category?: "strength" | "running",
    ): Promise<string[]> => {
      const rows = await repository.listForUser({ userId: ownerId, scope, category });
      return rows.filter((row) => row.slug.startsWith(marker)).map((row) => row.id);
    };

    /**
     * The catalogue screen's own call. A custom program appearing here is the failure the
     * `scope` parameter exists to prevent.
     */
    it("returns only presets under the preset scope", async () => {
      const ids = await listed("preset");
      expect(ids).toContain(presetId);
      expect(ids).not.toContain(ownId);
      expect(ids).not.toContain(strangersId);
    });

    it("returns only the caller's own under the mine scope", async () => {
      expect(await listed("mine")).toEqual([ownId]);
    });

    it("returns presets and the caller's own under all, and never a stranger's", async () => {
      const ids = await listed("all");
      expect(ids).toContain(presetId);
      expect(ids).toContain(ownId);
      expect(ids).not.toContain(strangersId);
    });

    it("never returns a soft-deleted program under any scope", async () => {
      for (const scope of ["preset", "mine", "all"] as const) {
        const rows = await repository.listForUser({ userId: ownerId, scope });
        expect(rows.map((row) => row.name)).not.toContain(`${marker} D Deleted`);
      }
    });

    it("filters by category without disturbing the scope", async () => {
      expect(await listed("all", "running")).toEqual([ownId]);
      expect(await listed("all", "strength")).toContain(presetId);
      expect(await listed("all", "strength")).not.toContain(ownId);
    });

    /**
     * `owner = :user` is SQL NULL for a preset, not false. Coercing it wrongly would make every
     * catalogue row claim the reader built it.
     */
    it("marks a preset as not the caller's own, even though the comparison is against NULL", async () => {
      const rows = await repository.listForUser({ userId: ownerId, scope: "all" });
      expect(rows.find((row) => row.id === presetId)?.isOwn).toBe(false);
      expect(rows.find((row) => row.id === ownId)?.isOwn).toBe(true);
    });

    it("orders by name so two programs never come back in planner order", async () => {
      const rows = await repository.listForUser({ userId: ownerId, scope: "all" });
      const ours = rows.filter((row) => row.slug.startsWith(marker)).map((row) => row.name);
      expect(ours).toEqual([...ours].sort());
    });

    /**
     * Counted from the join rows, not read off `days_per_week`. The two agree for a seeded preset
     * and would diverge for a custom program with rest days, so a list reading the wrong one is
     * right today and quietly wrong once the builder ships.
     */
    it("counts a program's workouts rather than restating daysPerWeek", async () => {
      const templateA = await makeTemplate("Count A", "strength", [benchId]);
      const templateB = await makeTemplate("Count B", "strength", [rowId]);
      const programId = await makeProgram({
        slug: "counted",
        name: `${marker} E Counted`,
        daysPerWeek: 5,
      });
      await link(programId, templateA, 0);
      await link(programId, templateB, 1);

      const rows = await repository.listForUser({ userId: ownerId, scope: "preset" });
      const row = rows.find((candidate) => candidate.id === programId);

      expect(row?.workoutCount).toBe(2);
      expect(row?.daysPerWeek).toBe(5);
    });

    it("reports zero workouts for a program with none, rather than dropping the row", async () => {
      const rows = await repository.listForUser({ userId: ownerId, scope: "preset" });
      expect(rows.find((row) => row.id === presetId)?.workoutCount).toBe(0);
    });
  });

  describe("findByIdForUser", () => {
    let programId: string;
    let firstTemplateId: string;

    beforeAll(async () => {
      firstTemplateId = await makeTemplate("Upper A", "strength", [benchId, rowId]);
      const second = await makeTemplate("Long Run", "running", []);
      programId = await makeProgram({
        slug: "overview",
        name: `${marker} Overview`,
        description: null,
      });
      // Linked out of order on purpose: the read must order by `order_index`, not by insertion.
      await link(programId, second, 1);
      await link(programId, firstTemplateId, 0);
    });

    it("returns the program with its workouts in the design's order", async () => {
      const found = await repository.findByIdForUser(programId, ownerId);

      expect(found?.workouts.map((workout) => workout.orderIndex)).toEqual([0, 1]);
      expect(found?.workouts[0]?.templateId).toBe(firstTemplateId);
      expect(found?.workouts[0]?.activity).toBe("strength");
      expect(found?.workouts[1]?.activity).toBe("running");
    });

    /** The overview's `exs.join(' · ')` line. Reversed names would be silently wrong. */
    it("carries each workout's exercise names in block-then-position order", async () => {
      const found = await repository.findByIdForUser(programId, ownerId);
      expect(found?.workouts[0]?.exerciseNames).toEqual([`${marker} Bench`, `${marker} Row`]);
    });

    /** `array_agg` over no rows is NULL. An empty workout is legal, so this is a real case. */
    it("returns an empty array, not null, for a workout with no exercises", async () => {
      const found = await repository.findByIdForUser(programId, ownerId);
      expect(found?.workouts[1]?.exerciseNames).toEqual([]);
    });

    it("preserves a null description rather than inventing one", async () => {
      expect((await repository.findByIdForUser(programId, ownerId))?.description).toBeNull();
    });

    it("carries dayOfWeek through, null for a preset and a number when set", async () => {
      const template = await makeTemplate("Monday", "strength", [benchId]);
      const custom = await makeProgram({
        slug: "custom-days",
        name: `${marker} Custom Days`,
        ownerUserId: ownerId,
      });
      await link(custom, template, 0, 1);

      expect((await repository.findByIdForUser(custom, ownerId))?.workouts[0]?.dayOfWeek).toBe(1);
      expect(
        (await repository.findByIdForUser(programId, ownerId))?.workouts[0]?.dayOfWeek,
      ).toBeNull();
    });

    /**
     * Missing, deleted and someone else's are all `null`, so a probe cannot tell "does not exist"
     * from "exists and is not yours".
     */
    it("returns null for a stranger's program, a deleted one, and an unknown id alike", async () => {
      const strangers = await makeProgram({
        slug: "hidden",
        name: `${marker} Hidden`,
        ownerUserId: strangerId,
      });
      const deleted = await makeProgram({
        slug: "gone",
        name: `${marker} Gone`,
        deletedAt: new Date(),
      });

      expect(await repository.findByIdForUser(strangers, ownerId)).toBeNull();
      expect(await repository.findByIdForUser(deleted, ownerId)).toBeNull();
      expect(await repository.findByIdForUser(randomUUID(), ownerId)).toBeNull();
    });

    it("lets the owner of a custom program read it", async () => {
      const mine = await makeProgram({
        slug: "mine-readable",
        name: `${marker} Mine Readable`,
        ownerUserId: ownerId,
      });
      expect((await repository.findByIdForUser(mine, ownerId))?.isOwn).toBe(true);
    });

    /**
     * The same rule one level down. An exercise cannot be hard-deleted while a prescription
     * references it (`workout_exercises.exercise_id` is `restrict`), so soft deletion is the only
     * way one leaves the catalogue -- and an overview row that went on listing it would be
     * quietly wrong rather than visibly broken.
     */
    it("omits a soft-deleted exercise from a workout's names, keeping the rest", async () => {
      const retiredExerciseId = await makeExercise("Retired Lift");
      const template = await makeTemplate("Mixed", "strength", [benchId, retiredExerciseId]);
      const program = await makeProgram({ slug: "mixed", name: `${marker} Mixed` });
      await link(program, template, 0);

      expect((await repository.findByIdForUser(program, ownerId))?.workouts[0]?.exerciseNames)
        .toEqual([`${marker} Bench`, `${marker} Retired Lift`]);

      await db
        .update(exercises)
        .set({ deletedAt: new Date() })
        .where(eq(exercises.id, retiredExerciseId));

      expect(
        (await repository.findByIdForUser(program, ownerId))?.workouts[0]?.exerciseNames,
      ).toEqual([`${marker} Bench`]);
    });

    /**
     * A template soft-deleted out from under a program must not appear as a workout. It cannot be
     * hard-deleted while linked (`restrict`), so soft deletion is the only way this happens.
     */
    it("omits a workout whose template has been soft-deleted", async () => {
      const template = await makeTemplate("Retired", "strength", [benchId]);
      const program = await makeProgram({ slug: "retired", name: `${marker} Retired` });
      await link(program, template, 0);

      await db
        .update(workoutTemplates)
        .set({ deletedAt: new Date() })
        .where(eq(workoutTemplates.id, template));

      expect((await repository.findByIdForUser(program, ownerId))?.workouts).toEqual([]);
    });
  });

  describe("findActiveEnrollment", () => {
    it("returns null when the athlete follows nothing", async () => {
      expect(await repository.findActiveEnrollment(await makeUser("idler"))).toBeNull();
    });

    it("returns the active enrolment with the program's name and the version it began under", async () => {
      const follower = await makeUser("follower");
      const programId = await makeProgram({ slug: "followed", name: `${marker} Followed` });

      await db.insert(programEnrollments).values({ userId: follower, programId, programVersion: 4 });

      const found = await repository.findActiveEnrollment(follower);
      expect(found?.programId).toBe(programId);
      expect(found?.programName).toBe(`${marker} Followed`);
      expect(found?.programVersion).toBe(4);
      expect(found?.startedAt).toBeInstanceOf(Date);
    });

    /** Ended enrolments are history, not state -- "you followed this last spring" must not show. */
    it("ignores an enrolment that has ended", async () => {
      const quitter = await makeUser("quitter");
      const programId = await makeProgram({ slug: "quit", name: `${marker} Quit` });

      await db.insert(programEnrollments).values({
        userId: quitter,
        programId,
        programVersion: 1,
        endedAt: new Date(),
      });

      expect(await repository.findActiveEnrollment(quitter)).toBeNull();
    });

    it("never returns another athlete's enrolment", async () => {
      const a = await makeUser("enrolled-a");
      const b = await makeUser("enrolled-b");
      const programId = await makeProgram({ slug: "shared", name: `${marker} Shared` });

      await db.insert(programEnrollments).values({ userId: a, programId, programVersion: 1 });

      expect(await repository.findActiveEnrollment(b)).toBeNull();
    });
  });

  describe("enrol", () => {
    it("starts following and snapshots the program's current version", async () => {
      const user = await makeUser("enrol-fresh");
      const programId = await makeProgram({ slug: "enrol-fresh", name: `${marker} Enrol Fresh` });
      await db.update(programs).set({ version: 5 }).where(eq(programs.id, programId));

      const enrolment = await repository.enrol(user, programId);

      expect(enrolment?.programId).toBe(programId);
      expect(enrolment?.programVersion).toBe(5);
      expect(enrolment?.programName).toBe(`${marker} Enrol Fresh`);
      expect((await repository.findActiveEnrollment(user))?.id).toBe(enrolment?.id);
    });

    /**
     * The design's Start Following has no "you must stop the other one first" step, and
     * `program_enrollments_one_active_key` would reject an insert made before the previous
     * enrolment was ended -- so the order inside the transaction is load-bearing, not incidental.
     */
    it("ends the previous enrolment and starts the new one, leaving exactly one active", async () => {
      const user = await makeUser("enrol-switch");
      const first = await makeProgram({ slug: "switch-a", name: `${marker} Switch A` });
      const second = await makeProgram({ slug: "switch-b", name: `${marker} Switch B` });

      const before = await repository.enrol(user, first);
      const after = await repository.enrol(user, second);

      expect(after?.programId).toBe(second);
      expect(after?.id).not.toBe(before?.id);

      const active = await db
        .select()
        .from(programEnrollments)
        .where(and(eq(programEnrollments.userId, user), isNull(programEnrollments.endedAt)));
      expect(active).toHaveLength(1);
      expect(active[0]?.programId).toBe(second);

      // The old one is ended, not deleted -- "you followed this last spring" survives.
      const [old] = await db
        .select()
        .from(programEnrollments)
        .where(eq(programEnrollments.id, before!.id));
      expect(old?.endedAt).not.toBeNull();
    });

    /**
     * Re-following what you already follow must not move `started_at`: "Recommended next" (K4) is
     * derived from the sessions performed *since* enrolling, so restarting the enrolment would
     * silently erase the athlete's progress through the program.
     */
    it("is a no-op when re-following the program already being followed", async () => {
      const user = await makeUser("enrol-again");
      const programId = await makeProgram({ slug: "again", name: `${marker} Again` });

      const first = await repository.enrol(user, programId);
      const second = await repository.enrol(user, programId);

      expect(second?.id).toBe(first?.id);
      expect(second?.startedAt.toISOString()).toBe(first?.startedAt.toISOString());

      const all = await db
        .select()
        .from(programEnrollments)
        .where(eq(programEnrollments.userId, user));
      expect(all).toHaveLength(1);
      expect(all[0]?.endedAt).toBeNull();
    });

    /** Enrolling in something you cannot read must not be a way to reach it. */
    it("returns null for a stranger's program, a deleted one and an unknown id alike", async () => {
      const user = await makeUser("enrol-refused");
      const strangers = await makeProgram({
        slug: "enrol-hidden",
        name: `${marker} Enrol Hidden`,
        ownerUserId: strangerId,
      });
      const deleted = await makeProgram({
        slug: "enrol-gone",
        name: `${marker} Enrol Gone`,
        deletedAt: new Date(),
      });

      expect(await repository.enrol(user, strangers)).toBeNull();
      expect(await repository.enrol(user, deleted)).toBeNull();
      expect(await repository.enrol(user, randomUUID())).toBeNull();
      expect(await repository.findActiveEnrollment(user)).toBeNull();
    });

    it("lets an athlete follow their own custom program", async () => {
      const programId = await makeProgram({
        slug: "enrol-mine",
        name: `${marker} Enrol Mine`,
        ownerUserId: ownerId,
      });

      expect((await repository.enrol(ownerId, programId))?.programId).toBe(programId);
      await repository.endActiveEnrollment(ownerId);
    });
  });

  describe("endActiveEnrollment", () => {
    it("ends the active enrolment and reports that it did", async () => {
      const user = await makeUser("stop-following");
      const programId = await makeProgram({ slug: "stop", name: `${marker} Stop` });
      await repository.enrol(user, programId);

      expect(await repository.endActiveEnrollment(user)).toBe(true);
      expect(await repository.findActiveEnrollment(user)).toBeNull();
    });

    /** A second tap on Stop Following is not an error, and must not invent a row to end. */
    it("reports false, and changes nothing, when nothing is being followed", async () => {
      const user = await makeUser("stop-nothing");
      expect(await repository.endActiveEnrollment(user)).toBe(false);
    });

    it("never ends another athlete's enrolment", async () => {
      const mine = await makeUser("stop-mine");
      const theirs = await makeUser("stop-theirs");
      const programId = await makeProgram({ slug: "stop-shared", name: `${marker} Stop Shared` });

      await repository.enrol(theirs, programId);
      expect(await repository.endActiveEnrollment(mine)).toBe(false);
      expect(await repository.findActiveEnrollment(theirs)).not.toBeNull();
    });

    /** Ended, never deleted -- the history stays readable. */
    it("leaves the ended row in place rather than deleting it", async () => {
      const user = await makeUser("stop-history");
      const programId = await makeProgram({ slug: "history", name: `${marker} History` });
      const enrolment = await repository.enrol(user, programId);

      await repository.endActiveEnrollment(user);

      const [row] = await db
        .select()
        .from(programEnrollments)
        .where(eq(programEnrollments.id, enrolment!.id));
      expect(row).toBeDefined();
      expect(row?.endedAt).not.toBeNull();
    });

    /**
     * Ending then re-following is allowed by the partial unique index, which only constrains rows
     * with `ended_at is null`. That is the design's unfollow-then-follow-again path.
     */
    it("allows following again after stopping", async () => {
      const user = await makeUser("stop-restart");
      const programId = await makeProgram({ slug: "restart", name: `${marker} Restart` });

      const first = await repository.enrol(user, programId);
      await repository.endActiveEnrollment(user);
      const second = await repository.enrol(user, programId);

      expect(second?.id).not.toBe(first?.id);
      expect(await repository.findActiveEnrollment(user)).not.toBeNull();
    });
  });
});
