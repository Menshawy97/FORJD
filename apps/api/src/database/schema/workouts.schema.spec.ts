import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { randomUUID } from "crypto";

import { exercises } from "./exercises.schema";
import { users } from "./users.schema";
import {
  programEnrollments,
  programWorkouts,
  programs,
  workoutBlocks,
  workoutExercises,
  workoutSessionExercises,
  workoutSessions,
  workoutSets,
  workoutTemplates,
} from "./workouts.schema";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is migration
 * 0012's own constraint decisions (FK actions, soft-delete referenceability), which a mock
 * would only prove the test author's assumptions about. Same rationale as
 * ExercisesRepository.spec.ts. No repository exists yet for these tables (that is Phase D);
 * this pins the schema's own claims directly against the applied migration.
 */
describe("workouts schema (migrations 0012, 0013)", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  const createdUserEmails: string[] = [];
  const createdExerciseIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdSessionIds: string[] = [];
  const createdProgramIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `wkoutschema-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const makeExercise = async (label: string, deletedAt: Date | null = null): Promise<string> => {
    const [row] = await db
      .insert(exercises)
      .values({
        name: `Test ${label} ${randomUUID()}`,
        slug: `test-${label}-${randomUUID()}`,
        category: "strength",
        goal: "strength",
        measure: "weight",
        deletedAt,
      })
      .returning();
    if (!row) throw new Error("insert did not return a row");
    createdExerciseIds.push(row.id);
    return row.id;
  };

  const makeTemplate = async (ownerUserId: string): Promise<string> => {
    const [row] = await db
      .insert(workoutTemplates)
      .values({ ownerUserId, name: "Test template", activity: "strength" })
      .returning();
    if (!row) throw new Error("insert did not return a row");
    createdTemplateIds.push(row.id);
    return row.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(workoutSessions).where(inArray(workoutSessions.id, createdSessionIds));
    }
    if (createdProgramIds.length > 0) {
      await db.delete(programs).where(inArray(programs.id, createdProgramIds));
    }
    if (createdTemplateIds.length > 0) {
      await db.delete(workoutTemplates).where(inArray(workoutTemplates.id, createdTemplateIds));
    }
    if (createdExerciseIds.length > 0) {
      await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
    }
    if (createdUserEmails.length > 0) {
      await db.delete(users).where(inArray(users.email, createdUserEmails));
    }
    await pool.end();
  });

  it("lets a workout_exercises row reference a soft-deleted exercise", async () => {
    const userId = await makeUser("softdel-owner");
    const templateId = await makeTemplate(userId);
    const exerciseId = await makeExercise("softdeleted", new Date());

    const [block] = await db
      .insert(workoutBlocks)
      .values({ templateId, type: "straight_sets", orderIndex: 0 })
      .returning();
    if (!block) throw new Error("insert did not return a row");

    await expect(
      db.insert(workoutExercises).values({
        blockId: block.id,
        exerciseId,
        orderIndex: 0,
        setCount: 4,
        targetReps: 8,
      }),
    ).resolves.not.toThrow();

    const rows = await db
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.exerciseId, exerciseId));
    expect(rows).toHaveLength(1);
  });

  it("rejects hard-deleting an exercise still referenced by a workout_exercises row", async () => {
    const userId = await makeUser("restrict-owner");
    const templateId = await makeTemplate(userId);
    const exerciseId = await makeExercise("restrict-target");

    const [block] = await db
      .insert(workoutBlocks)
      .values({ templateId, type: "straight_sets", orderIndex: 0 })
      .returning();
    if (!block) throw new Error("insert did not return a row");
    await db.insert(workoutExercises).values({ blockId: block.id, exerciseId, orderIndex: 0 });

    await expect(db.delete(exercises).where(eq(exercises.id, exerciseId))).rejects.toThrow();
  });

  it("keeps a session's own name and history when its template is hard-deleted", async () => {
    const userId = await makeUser("session-survives");
    const templateId = await makeTemplate(userId);
    const sessionId = randomUUID();

    await db.insert(workoutSessions).values({
      id: sessionId,
      userId,
      templateId,
      name: "Snapshot name",
      activity: "strength",
      status: "completed",
      startedAt: new Date(),
      durationSeconds: 1800,
    });
    createdSessionIds.push(sessionId);

    await db.delete(workoutTemplates).where(eq(workoutTemplates.id, templateId));
    createdTemplateIds.splice(createdTemplateIds.indexOf(templateId), 1);

    const [row] = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId));
    expect(row?.templateId).toBeNull();
    expect(row?.name).toBe("Snapshot name");
  });

  it("cascades a session delete down through its exercises and sets", async () => {
    const userId = await makeUser("cascade-owner");
    const exerciseId = await makeExercise("cascade-target");
    const sessionId = randomUUID();

    await db.insert(workoutSessions).values({
      id: sessionId,
      userId,
      name: "Cascade test",
      activity: "strength",
      status: "completed",
      startedAt: new Date(),
      durationSeconds: 600,
    });

    const [sessionExercise] = await db
      .insert(workoutSessionExercises)
      .values({ sessionId, exerciseId, orderIndex: 0, measure: "weight" })
      .returning();
    if (!sessionExercise) throw new Error("insert did not return a row");

    await db.insert(workoutSets).values({
      sessionExerciseId: sessionExercise.id,
      setIndex: 0,
      type: "working",
      weightKg: "100.00",
      reps: 8,
    });

    await db.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));

    const remainingExercises = await db
      .select()
      .from(workoutSessionExercises)
      .where(eq(workoutSessionExercises.sessionId, sessionId));
    const remainingSets = await db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.sessionExerciseId, sessionExercise.id));

    expect(remainingExercises).toHaveLength(0);
    expect(remainingSets).toHaveLength(0);
  });

  it("sets based_on_template_id to null when the base template is hard-deleted", async () => {
    const userId = await makeUser("based-on-owner");
    const baseTemplateId = await makeTemplate(userId);
    const [customized] = await db
      .insert(workoutTemplates)
      .values({
        ownerUserId: userId,
        name: "My version",
        activity: "strength",
        basedOnTemplateId: baseTemplateId,
      })
      .returning();
    if (!customized) throw new Error("insert did not return a row");
    createdTemplateIds.push(customized.id);

    await db.delete(workoutTemplates).where(eq(workoutTemplates.id, baseTemplateId));
    createdTemplateIds.splice(createdTemplateIds.indexOf(baseTemplateId), 1);

    const [row] = await db
      .select()
      .from(workoutTemplates)
      .where(eq(workoutTemplates.id, customized.id));
    expect(row?.basedOnTemplateId).toBeNull();
  });

  /**
   * Phase 3K. Both assertions below are about **partial unique indexes**, which are the part of
   * this migration most easily lost: a regenerated migration that drops the `where` clause still
   * applies cleanly, still passes a typecheck, and silently stops enforcing anything.
   */
  describe("programs (migration 0013)", () => {
    const makeProgram = async (
      ownerUserId: string | null,
      slug: string,
    ): Promise<string> => {
      const [row] = await db
        .insert(programs)
        .values({
          ownerUserId,
          name: `Test ${slug}`,
          slug,
          category: "strength",
          level: "intermediate",
          daysPerWeek: 4,
          durationWeeks: 8,
        })
        .returning();
      if (!row) throw new Error("insert did not return a row");
      createdProgramIds.push(row.id);
      return row.id;
    };

    it("refuses a second catalogue preset with the same slug", async () => {
      const slug = `preset-${randomUUID()}`;
      await makeProgram(null, slug);

      await expect(makeProgram(null, slug)).rejects.toThrow();
    });

    // The reason the index is partial. Two athletes may each build a program called "My Split",
    // and neither should collide with the other or with a catalogue slug.
    it("lets two different users own a program with the same slug", async () => {
      const slug = `mine-${randomUUID()}`;
      const owner = await makeUser("prog-owner");
      const stranger = await makeUser("prog-stranger");

      await makeProgram(owner, slug);

      await expect(makeProgram(stranger, slug)).resolves.toBeTruthy();
    });

    it("refuses a second active enrolment for the same user", async () => {
      const owner = await makeUser("enrol-one");
      const first = await makeProgram(null, `p1-${randomUUID()}`);
      const second = await makeProgram(null, `p2-${randomUUID()}`);

      await db.insert(programEnrollments).values({ userId: owner, programId: first, programVersion: 1 });

      await expect(
        db.insert(programEnrollments).values({ userId: owner, programId: second, programVersion: 1 }),
      ).rejects.toThrow();
    });

    // Ending one and starting another is the design's own Start Following, which has no "stop
    // the other one first" step -- so the index must not stand in its way.
    it("allows a new enrolment once the previous one has ended", async () => {
      const owner = await makeUser("enrol-again");
      const first = await makeProgram(null, `p3-${randomUUID()}`);
      const second = await makeProgram(null, `p4-${randomUUID()}`);

      await db.insert(programEnrollments).values({ userId: owner, programId: first, programVersion: 1 });
      await db
        .update(programEnrollments)
        .set({ endedAt: new Date() })
        .where(eq(programEnrollments.userId, owner));

      await expect(
        db.insert(programEnrollments).values({ userId: owner, programId: second, programVersion: 1 }),
      ).resolves.toBeTruthy();
    });

    // `restrict`, not `cascade`: a program quietly losing a day is the hollowing-out this
    // phase's plan refuses.
    it("rejects hard-deleting a template a program still points at", async () => {
      const owner = await makeUser("prog-tmpl");
      const programId = await makeProgram(null, `p5-${randomUUID()}`);
      const templateId = await makeTemplate(owner);

      await db.insert(programWorkouts).values({ programId, templateId, orderIndex: 0 });

      await expect(
        db.delete(workoutTemplates).where(eq(workoutTemplates.id, templateId)),
      ).rejects.toThrow();

      // Leave nothing behind for the shared teardown to trip over.
      await db.delete(programWorkouts).where(eq(programWorkouts.programId, programId));
    });
  });
});
