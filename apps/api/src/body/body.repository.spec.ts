import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import type { BodyMetric } from "@forjd/domain";

import { bodyMeasurements, bodyScans } from "../database/schema/body.schema";
import { users } from "../database/schema/users.schema";
import { BodyRepository, NewMeasurementInput } from "./body.repository";

/**
 * Exercised against real Postgres, not a mock -- same rationale as
 * `whoop-connection.repository.spec.ts` and `users.repository.spec.ts`: the behaviour under
 * test is transactional atomicity across two tables, which only a real transaction (and a
 * real constraint violation) can prove.
 *
 * R7 (H3): `createScan` used to run `insert(bodyScans)` then a separate
 * `insert(bodyMeasurements)`. A crash between them left an unrecoverable scan row with zero
 * measurements, because vision extraction is never re-run. These tests pin both halves of
 * the fix: the happy path still works, and a failure partway through leaves nothing behind.
 */
describe("BodyRepository", () => {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: BodyRepository;
  const createdUserIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `bodyrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new BodyRepository(db);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  it("creates a scan and its measurements together on the happy path", async () => {
    const userId = await makeUser("happy-path");
    const measuredAt = new Date("2026-01-15T09:00:00.000Z");
    const measurements: NewMeasurementInput[] = [
      { metric: "weight_kg" as BodyMetric, value: 84.6, unit: "kg", confidence: 0.97 },
    ];

    const scanId = await repository.createScan(userId, measuredAt, "inbody", "photo-key.webp", measurements);

    const [scanRow] = await db.select().from(bodyScans).where(eq(bodyScans.id, scanId));
    expect(scanRow?.userId).toBe(userId);

    const measurementRows = await db.select().from(bodyMeasurements).where(eq(bodyMeasurements.scanId, scanId));
    expect(measurementRows).toHaveLength(1);
  });

  it("runs both inserts inside a single transaction, leaving no scan row when the measurements insert throws", async () => {
    const userId = await makeUser("rollback");
    const measuredAt = new Date("2026-01-15T09:00:00.000Z");
    // `metric` is NOT NULL in `body_measurements`. Casting past the type system to force a
    // genuine DB-layer constraint violation on the *second* insert, after the first
    // (`body_scans`) insert has already succeeded within the same transaction -- exactly the
    // crash-between-writes scenario H3 describes, reproduced deterministically.
    const measurements = [
      { metric: null as unknown as BodyMetric, value: 84.6, unit: "kg", confidence: 0.97 },
    ] as NewMeasurementInput[];

    await expect(
      repository.createScan(userId, measuredAt, "inbody", "photo-key.webp", measurements),
    ).rejects.toThrow();

    const scanRows = await db.select().from(bodyScans).where(eq(bodyScans.userId, userId));
    expect(scanRows).toHaveLength(0);
  });
});
