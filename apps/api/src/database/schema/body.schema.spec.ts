import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

import { users } from "./users.schema";
import { bodyMeasurements, bodyScans } from "./body.schema";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is migration
 * 0014's own cascade decisions, which a mock would only prove the test author's assumptions
 * about. Same rationale as workouts.schema.spec.ts. No repository exists yet for these
 * tables (that is Phase 5D); this pins the schema's own claims directly against the applied
 * migration.
 */
describe("body schema (migration 0014)", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  // The first query in this suite pays for pool connection setup on top of the query
  // itself, which measured over Jest's 5s default on this machine; later queries are fast
  // (the two cascade tests below ran in under 2.5s each). Scoped to this file only.
  jest.setTimeout(15000);

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  const createdUserEmails: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `bodyschema-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  const makeScan = async (userId: string) => {
    const [row] = await db
      .insert(bodyScans)
      .values({ userId, measuredAt: new Date(), source: "inbody", photoKey: `${userId}/test.webp` })
      .returning();
    if (!row) throw new Error("insert did not return a row");
    return row.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  });

  afterAll(async () => {
    for (const email of createdUserEmails) {
      await db.delete(users).where(eq(users.email, email));
    }
    await pool.end();
  });

  it("stores a measurement row scoped to a scan", async () => {
    const userId = await makeUser("basic");
    const scanId = await makeScan(userId);

    const [row] = await db
      .insert(bodyMeasurements)
      .values({
        scanId,
        userId,
        metric: "weight_kg",
        value: "84.6",
        unit: "kg",
        confidence: "0.97",
        measuredAt: new Date(),
      })
      .returning();

    expect(row?.metric).toBe("weight_kg");
    expect(row?.value).toBe("84.6");
  });

  it("cascades: deleting a scan deletes its measurements", async () => {
    const userId = await makeUser("scan-cascade");
    const scanId = await makeScan(userId);
    await db.insert(bodyMeasurements).values({
      scanId,
      userId,
      metric: "bmi",
      value: "26.4",
      unit: "",
      confidence: "0.96",
      measuredAt: new Date(),
    });

    await db.delete(bodyScans).where(eq(bodyScans.id, scanId));

    const remaining = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.scanId, scanId));
    expect(remaining).toHaveLength(0);
  });

  it("cascades: deleting a user deletes their scans and measurements", async () => {
    const userId = await makeUser("user-cascade");
    const scanId = await makeScan(userId);
    await db.insert(bodyMeasurements).values({
      scanId,
      userId,
      metric: "visceral_fat_level",
      value: "8",
      unit: "",
      confidence: "0.72",
      measuredAt: new Date(),
    });

    await db.delete(users).where(eq(users.id, userId));

    const remainingScans = await db.select().from(bodyScans).where(eq(bodyScans.userId, userId));
    const remainingMeasurements = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId));
    expect(remainingScans).toHaveLength(0);
    expect(remainingMeasurements).toHaveLength(0);
  });
});
