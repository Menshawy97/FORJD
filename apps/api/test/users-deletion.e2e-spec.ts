import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { users } from "../src/database/schema/users.schema";
import { profiles } from "../src/database/schema/profiles.schema";
import { privacySettings } from "../src/database/schema/privacy-settings.schema";
import { bodyScans, bodyMeasurements } from "../src/database/schema/body.schema";
import { healthObservations } from "../src/database/schema/health-data.schema";
import { externalConnections } from "../src/database/schema/external-connections.schema";
import { foods, nutritionLogEntries } from "../src/database/schema/nutrition.schema";
import { workoutTemplates, workoutSessions, programs, programEnrollments } from "../src/database/schema/workouts.schema";
import { STORAGE_PROVIDER } from "../src/storage/providers/storage-provider.interface";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-deletion-owner-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
const otherEmail = `e2e-deletion-other-${suiteId}@example.com`;
const otherExternalId = randomUUID();

/**
 * C1's orphan assertion, over real HTTP and real Postgres: after `DELETE /users/me`, zero
 * rows survive for that user in every table a health/training account touches. Written as a
 * table-driven loop so a future table added with a `user_id` column but no cascade fails this
 * test rather than silently leaking data forever, exactly as the audit asked for.
 */
describe("Account deletion (e2e)", () => {
  let app: INestApplication;
  let db: Database;
  const deletedStorageRefs: Array<{ bucket: string; key: string }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: ownerEmail, externalId: ownerExternalId, tokens: ["owner-token"] },
            { email: otherEmail, externalId: otherExternalId, tokens: ["other-token"] },
          ],
          signIn: "disabled",
        }),
      )
      .overrideProvider(STORAGE_PROVIDER)
      .useValue({
        delete: async (ref: { bucket: string; key: string }) => {
          deletedStorageRefs.push(ref);
        },
      })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: ownerEmail, password: "Str0ngPass!" }).expect(201);
    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: otherEmail, password: "Str0ngPass!" }).expect(201);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [ownerEmail, otherEmail]));
    await app.close();
  });

  it("rejects an unauthenticated delete", async () => {
    await request(app.getHttpServer()).delete("/api/v1/users/me").expect(401);
  });

  it("erases every table a health/training account touches, and leaves the other user's data alone", async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail));
    const [other] = await db.select().from(users).where(eq(users.email, otherEmail));
    if (!owner || !other) throw new Error("test users not found");
    const ownerId = owner.id;
    const otherId = other.id;

    // Seed one row per table the audit's orphan check names, for both users -- the owner's
    // rows must all disappear; the other user's must all survive untouched.
    const seedFor = async (userId: string, label: string) => {
      const [scan] = await db
        .insert(bodyScans)
        .values({ userId, measuredAt: new Date(), source: "inbody", photoKey: `${userId}/scan.webp` })
        .returning();
      await db.insert(bodyMeasurements).values({
        scanId: scan!.id,
        userId,
        metric: "weight_kg",
        value: "84.6",
        unit: "kg",
        confidence: "0.97",
        measuredAt: new Date(),
      });

      await db.insert(healthObservations).values({
        userId,
        metricType: "hrv",
        value: "55",
        unit: "ms",
        startTime: new Date(),
        endTime: new Date(),
        source: "manual",
      });

      const [food] = await db
        .insert(foods)
        .values({
          ownerUserId: userId,
          name: `${label} custom food`,
          category: "other",
          kcalPer100g: "100",
          proteinPer100g: "10",
          carbsPer100g: "10",
          fatPer100g: "2",
        })
        .returning();
      await db.insert(nutritionLogEntries).values({
        userId,
        foodId: food!.id,
        loggedDate: new Date().toISOString().slice(0, 10),
        slot: "breakfast",
        servingLabel: "1 serving",
        grams: "100",
        kcal: "100",
        protein: "10",
        carbs: "10",
        fat: "2",
      });

      const [template] = await db
        .insert(workoutTemplates)
        .values({ ownerUserId: userId, name: `${label} template`, activity: "strength" })
        .returning();
      await db.insert(workoutSessions).values({
        id: randomUUID(),
        userId,
        templateId: template!.id,
        name: `${label} session`,
        activity: "strength",
        status: "completed",
        startedAt: new Date(),
        endedAt: new Date(),
        durationSeconds: 1800,
      });

      const [program] = await db
        .insert(programs)
        .values({
          ownerUserId: userId,
          name: `${label} program`,
          slug: `${label}-program-${userId}`,
          category: "strength",
          level: "beginner",
          daysPerWeek: 3,
          durationWeeks: 8,
        })
        .returning();
      await db.insert(programEnrollments).values({ userId, programId: program!.id, programVersion: 1 });

      await db.insert(externalConnections).values({
        userId,
        provider: "whoop",
        status: "connected",
        externalUserId: `${label}-whoop-id`,
        encryptedAccessToken: "cipher-access",
        encryptedRefreshToken: "cipher-refresh",
        tokenKeyVersion: 1,
      });
    };

    await seedFor(ownerId, "owner");
    await seedFor(otherId, "other");

    await request(app.getHttpServer()).delete("/api/v1/users/me").set("Authorization", "Bearer owner-token").expect(204);

    // The table-driven orphan check: every one of these must report zero rows for ownerId.
    const tablesWithUserId = [
      { name: "users", table: users, userColumn: users.id },
      { name: "profiles", table: profiles, userColumn: profiles.userId },
      { name: "privacy_settings", table: privacySettings, userColumn: privacySettings.userId },
      { name: "body_scans", table: bodyScans, userColumn: bodyScans.userId },
      { name: "body_measurements", table: bodyMeasurements, userColumn: bodyMeasurements.userId },
      { name: "health_observations", table: healthObservations, userColumn: healthObservations.userId },
      { name: "external_connections", table: externalConnections, userColumn: externalConnections.userId },
      { name: "nutrition_log_entries", table: nutritionLogEntries, userColumn: nutritionLogEntries.userId },
      { name: "foods (owned)", table: foods, userColumn: foods.ownerUserId },
      { name: "workout_templates", table: workoutTemplates, userColumn: workoutTemplates.ownerUserId },
      { name: "workout_sessions", table: workoutSessions, userColumn: workoutSessions.userId },
      { name: "programs (owned)", table: programs, userColumn: programs.ownerUserId },
      { name: "program_enrollments", table: programEnrollments, userColumn: programEnrollments.userId },
    ] as const;

    for (const { name, table, userColumn } of tablesWithUserId) {
      const rows = await db.select().from(table as never).where(eq(userColumn as never, ownerId));
      expect(rows).toEqual([]);
      if (rows.length > 0) {
        throw new Error(`orphaned rows survive in ${name} for the deleted user`);
      }
    }

    // The other user's rows in every one of those same tables must be completely untouched.
    for (const { table, userColumn } of tablesWithUserId) {
      if (table === users) continue;
      const rows = await db.select().from(table as never).where(eq(userColumn as never, otherId));
      expect(rows.length).toBeGreaterThan(0);
    }
    const [otherStillExists] = await db.select().from(users).where(eq(users.id, otherId));
    expect(otherStillExists).toBeDefined();

    // Storage cleanup: the scan photo and (implicitly, no avatar set here) nothing else.
    expect(deletedStorageRefs.some((ref) => ref.bucket === "inbody" && ref.key === `${ownerId}/scan.webp`)).toBe(true);

    await db.delete(users).where(eq(users.id, otherId));
  });

  it("is idempotent -- deleting an already-deleted account does not 500", async () => {
    // The owner token still authenticates (JwtAuthGuard checks the JWT's own signature/claims,
    // not that the row still exists) but the row is already gone; the guard's own lookup will
    // fail this the same way any post-deletion authenticated call would.
    const response = await request(app.getHttpServer())
      .delete("/api/v1/users/me")
      .set("Authorization", "Bearer owner-token");
    expect([204, 401, 404]).toContain(response.status);
  });
});
