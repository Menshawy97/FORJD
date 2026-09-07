import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { Pool } from "pg";

import { users } from "./users.schema";
import { healthConnections, healthObservations } from "./health-data.schema";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is migration
 * 0015's own constraint decisions (FK cascade, the partial idempotent-reingest unique
 * index, the one-connection-per-provider unique index), which a mock would only prove the
 * test author's assumptions about. Same rationale as workouts.schema.spec.ts. No repository
 * exists yet for these tables (that is Phase 6D); this pins the schema's own claims
 * directly against the applied migration.
 */
describe("health-data schema (migration 0015)", () => {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  const createdUserEmails: string[] = [];
  const createdUserIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `healthschema-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  const observationValues = (userId: string, overrides: Partial<typeof healthObservations.$inferInsert> = {}) => ({
    userId,
    metricType: "hrv",
    value: "62",
    unit: "ms",
    startTime: new Date("2026-09-07T00:00:00Z"),
    endTime: new Date("2026-09-07T00:00:00Z"),
    source: "health_connect",
    ...overrides,
  });

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Cascades to health_observations / health_connections rows -- asserted below, not
      // just relied on here.
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  it("stores and reads back an observation row", async () => {
    const userId = await makeUser("basic");

    const [row] = await db.insert(healthObservations).values(observationValues(userId)).returning();
    if (!row) throw new Error("insert did not return a row");

    expect(row.metricType).toBe("hrv");
    expect(Number(row.value)).toBe(62);
    expect(row.unit).toBe("ms");
    expect(row.source).toBe("health_connect");
    expect(row.providerRecordId).toBeNull();
    expect(row.deviceId).toBeNull();
    expect(row.quality).toBeNull();
  });

  it("rejects a second observation with the same (user, source, provider_record_id)", async () => {
    const userId = await makeUser("dedup");
    await db.insert(healthObservations).values(observationValues(userId, { providerRecordId: "provider-abc" }));

    await expect(
      db.insert(healthObservations).values(observationValues(userId, { providerRecordId: "provider-abc" })),
    ).rejects.toThrow();
  });

  it("allows re-ingesting the identical (user, source, provider_record_id) via upsert instead of duplicating", async () => {
    // The unique index is partial (WHERE provider_record_id IS NOT NULL), so Postgres
    // requires ON CONFLICT's own predicate to match exactly -- this is the query shape
    // Phase 6D's repository must use for idempotent re-ingestion; proving it here confirms
    // the migration's index is actually usable for that, not just present.
    const userId = await makeUser("upsert");
    await db.insert(healthObservations).values(observationValues(userId, { providerRecordId: "provider-xyz", value: "60" }));

    await db
      .insert(healthObservations)
      .values(observationValues(userId, { providerRecordId: "provider-xyz", value: "65" }))
      .onConflictDoUpdate({
        target: [healthObservations.userId, healthObservations.source, healthObservations.providerRecordId],
        targetWhere: isNotNull(healthObservations.providerRecordId),
        set: { value: "65" },
      });

    const rows = await db
      .select()
      .from(healthObservations)
      .where(eq(healthObservations.userId, userId));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.value)).toBe(65);
  });

  it("allows multiple observations with a null provider_record_id for the same user and source", async () => {
    const userId = await makeUser("null-dedup");

    await expect(
      db.insert(healthObservations).values([observationValues(userId), observationValues(userId)]),
    ).resolves.not.toThrow();

    const rows = await db
      .select()
      .from(healthObservations)
      .where(eq(healthObservations.userId, userId));
    expect(rows).toHaveLength(2);
  });

  it("allows the same provider_record_id for two different users (the unique index is per-user)", async () => {
    const userA = await makeUser("shared-provider-a");
    const userB = await makeUser("shared-provider-b");

    await expect(
      db.insert(healthObservations).values([
        observationValues(userA, { providerRecordId: "shared-record" }),
        observationValues(userB, { providerRecordId: "shared-record" }),
      ]),
    ).resolves.not.toThrow();
  });

  it("cascades on user deletion: deleting a user removes their health_observations rows", async () => {
    const userId = await makeUser("cascade-obs");
    await db.insert(healthObservations).values(observationValues(userId));

    await db.delete(users).where(eq(users.id, userId));
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);
    createdUserEmails.splice(
      createdUserEmails.findIndex((e) => e.startsWith("healthschema-cascade-obs-")),
      1,
    );

    const rows = await db
      .select()
      .from(healthObservations)
      .where(eq(healthObservations.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("stores and reads back a connection row with a null sync checkpoint", async () => {
    const userId = await makeUser("connection-basic");

    const [row] = await db
      .insert(healthConnections)
      .values({ userId, source: "health_connect" })
      .returning();
    if (!row) throw new Error("insert did not return a row");

    expect(row.source).toBe("health_connect");
    expect(row.lastSuccessfulSyncAt).toBeNull();
  });

  it("rejects a second connection for the same (user, source)", async () => {
    const userId = await makeUser("connection-dedup");
    await db.insert(healthConnections).values({ userId, source: "health_connect" });

    await expect(db.insert(healthConnections).values({ userId, source: "health_connect" })).rejects.toThrow();
  });

  it("allows the same user to connect two different providers", async () => {
    const userId = await makeUser("connection-multi-provider");

    await expect(
      db.insert(healthConnections).values([
        { userId, source: "health_connect" },
        { userId, source: "whoop" },
      ]),
    ).resolves.not.toThrow();
  });

  it("cascades on user deletion: deleting a user removes their health_connections rows", async () => {
    const userId = await makeUser("cascade-connection");
    await db.insert(healthConnections).values({ userId, source: "health_connect" });

    await db.delete(users).where(eq(users.id, userId));
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);
    createdUserEmails.splice(
      createdUserEmails.findIndex((e) => e.startsWith("healthschema-cascade-connection-")),
      1,
    );

    const rows = await db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.userId, userId));
    expect(rows).toHaveLength(0);
  });
});
