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

/**
 * R14 (H9) -- every read method takes a `userId` and must carry it as a predicate, not just
 * accept it as an unused parameter. Seeds two real users with their own scans in Postgres and
 * proves user A's calls never return user B's rows, the same "second user's data is invisible"
 * shape already used above for the transaction tests.
 */
describe("BodyRepository -- reads are scoped by userId (H9)", () => {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: BodyRepository;
  const createdUserIds: string[] = [];

  let userA: string;
  let userB: string;
  let scanA: string;
  let scanB: string;

  const makeUser = async (label: string): Promise<string> => {
    const email = `bodyrepo-scope-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new BodyRepository(db);

    userA = await makeUser("user-a");
    userB = await makeUser("user-b");

    const measuredAt = new Date("2026-01-15T09:00:00.000Z");
    const measurementsA: NewMeasurementInput[] = [
      { metric: "weight_kg" as BodyMetric, value: 70, unit: "kg", confidence: 0.9 },
    ];
    const measurementsB: NewMeasurementInput[] = [
      { metric: "weight_kg" as BodyMetric, value: 99, unit: "kg", confidence: 0.9 },
    ];

    scanA = await repository.createScan(userA, measuredAt, "inbody", "user-a/photo.webp", measurementsA);
    scanB = await repository.createScan(userB, measuredAt, "inbody", "user-b/photo.webp", measurementsB);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  it("getScanById returns null for user A when asked for user B's scan id", async () => {
    await expect(repository.getScanById(userA, scanB)).resolves.toBeNull();
  });

  it("getScanById returns the scan for its owner", async () => {
    const scan = await repository.getScanById(userA, scanA);
    expect(scan?.id).toBe(scanA);
  });

  it("listScansForUser never includes another user's scans", async () => {
    const scansForA = await repository.listScansForUser(userA);

    expect(scansForA.map((s) => s.id)).toContain(scanA);
    expect(scansForA.map((s) => s.id)).not.toContain(scanB);
  });

  it("getSeriesForUser never mixes another user's measurement points into the series", async () => {
    const seriesForA = await repository.getSeriesForUser(userA);
    const weightSeries = seriesForA.find((s) => s.metric === "weight_kg");

    expect(weightSeries?.points.map((p) => p.value)).toEqual([70]);
    expect(weightSeries?.points.map((p) => p.value)).not.toContain(99);
  });

  it("listScanPhotoKeysForUser never includes another user's photo key", async () => {
    const keysForA = await repository.listScanPhotoKeysForUser(userA);

    expect(keysForA).toContain("user-a/photo.webp");
    expect(keysForA).not.toContain("user-b/photo.webp");
  });
});
