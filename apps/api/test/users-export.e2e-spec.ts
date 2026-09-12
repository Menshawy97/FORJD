import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accountExportSchema } from "@forjd/contracts";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { users } from "../src/database/schema/users.schema";
import { bodyScans, bodyMeasurements } from "../src/database/schema/body.schema";
import { healthObservations } from "../src/database/schema/health-data.schema";
import { externalConnections } from "../src/database/schema/external-connections.schema";
import { foods, nutritionLogEntries } from "../src/database/schema/nutrition.schema";
import { workoutTemplates, workoutSessions, programs, programEnrollments } from "../src/database/schema/workouts.schema";
import { STORAGE_PROVIDER } from "../src/storage/providers/storage-provider.interface";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-export-owner-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
const otherEmail = `e2e-export-other-${suiteId}@example.com`;
const otherExternalId = randomUUID();

/**
 * R4 (H2), GDPR Art. 15 & 20. `GET /users/me` used to return only profile and privacy -- there
 * was no way for an athlete to get a full copy of everything else FORJD holds about them.
 *
 * Seeded the same way as `users-deletion.e2e-spec.ts` (one row per table, for two users), but
 * asserting the *opposite* direction: the owner's data appears in their own export, and the
 * other user's rows never do. `JSON.stringify` + a blunt substring search backstops the schema
 * assertion for the one thing a shape check alone cannot catch -- ciphertext accidentally
 * riding along on a field the schema does not know about.
 */
describe("Account export (e2e)", () => {
  let app: INestApplication;
  let db: Database;

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
      .useValue({ delete: async () => undefined })
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

  it("rejects an unauthenticated export", async () => {
    await request(app.getHttpServer()).get("/api/v1/users/me/export").expect(401);
  });

  it("returns a full copy of the owner's data, matching accountExportSchema, and none of the other user's", async () => {
    const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail));
    const [other] = await db.select().from(users).where(eq(users.email, otherEmail));
    if (!owner || !other) throw new Error("test users not found");
    const ownerId = owner.id;
    const otherId = other.id;

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
          slug: `${label}-export-program-${userId}`,
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
        externalUserId: `${label}-export-whoop-id`,
        encryptedAccessToken: "cipher-access-should-never-leak",
        encryptedRefreshToken: "cipher-refresh-should-never-leak",
        tokenKeyVersion: 1,
      });

      return { templateId: template!.id, sessionName: `${label} session` };
    };

    const ownerSeed = await seedFor(ownerId, "owner");
    await seedFor(otherId, "other");

    const response = await request(app.getHttpServer())
      .get("/api/v1/users/me/export")
      .set("Authorization", "Bearer owner-token")
      .expect(200);

    // Fails loudly (with Zod's own message) if a field the live contract requires is missing
    // or shaped wrong -- the same "parsed, not merely inspected" discipline the fixture tests
    // hold for every other response shape in `packages/contracts`.
    const parsed = accountExportSchema.parse(response.body);

    expect(parsed.account).toEqual({ id: ownerId, email: ownerEmail });

    expect(parsed.healthObservations.length).toBeGreaterThan(0);
    expect(parsed.healthObservations.every((observation) => observation.source === "manual")).toBe(true);

    expect(parsed.bodyScans).toEqual([
      expect.objectContaining({ measurements: [expect.objectContaining({ metric: "weight_kg", value: 84.6 })] }),
    ]);

    expect(parsed.nutritionLogEntries).toEqual([expect.objectContaining({ servingLabel: "1 serving" })]);

    expect(parsed.workoutTemplates).toEqual([
      expect.objectContaining({ id: ownerSeed.templateId, name: "owner template" }),
    ]);
    expect(parsed.workoutSessions).toEqual([expect.objectContaining({ name: ownerSeed.sessionName })]);
    // Neither the other user's template/session name, nor their id, ever appears.
    expect(JSON.stringify(parsed)).not.toContain("other template");
    expect(JSON.stringify(parsed)).not.toContain("other session");
    expect(JSON.stringify(parsed)).not.toContain(otherId);

    expect(parsed.programs.owned).toEqual([expect.objectContaining({ name: "owner program", isOwn: true })]);
    expect(parsed.programs.enrollment).toEqual(expect.objectContaining({ programName: "owner program" }));

    expect(parsed.externalConnections).toEqual([
      { provider: "whoop", status: "connected", externalUserId: "owner-export-whoop-id", lastSyncAt: null },
    ]);

    // The blunt backstop rule 10/H2 call for explicitly: no WHOOP ciphertext, from either
    // user, anywhere in the serialized export, and no key naming it either.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("cipher-access-should-never-leak");
    expect(serialized).not.toContain("cipher-refresh-should-never-leak");
    expect(serialized).not.toContain("encryptedAccessToken");
    expect(serialized).not.toContain("encryptedRefreshToken");

    await db.delete(users).where(eq(users.id, otherId));
  });
});
