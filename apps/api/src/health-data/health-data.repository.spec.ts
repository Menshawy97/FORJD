import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import type { Logger } from "drizzle-orm/logger";

import { healthObservations } from "../database/schema/health-data.schema";
import { users } from "../database/schema/users.schema";
import { HealthDataRepository, type NewObservationInput } from "./health-data.repository";

/**
 * Exercised against real Postgres, not a mock -- R8 (audit H4) is about what actually reaches
 * the database (an `IN`, a `>=`, a `LIMIT` in the generated SQL, hitting the
 * `(user_id, metric_type, start_time)` index), which a mocked query builder would only prove
 * the test author's assumptions about. Same rationale as `NutritionRepository.spec.ts`.
 *
 * The window is asserted against the *generated query text* (captured via drizzle's own
 * `logger` hook), not by filtering the returned rows in JavaScript -- proving the predicate
 * was pushed into SQL, not applied after an unbounded fetch.
 */
describe("HealthDataRepository", () => {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: HealthDataRepository;
  let capturedQueries: string[];
  const createdUserIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `healthrepo-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  const observation = (overrides: Partial<NewObservationInput> = {}): NewObservationInput => ({
    metricType: "hrv",
    value: 60,
    unit: "ms",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    endTime: new Date("2026-01-01T00:00:00.000Z"),
    source: "manual",
    providerRecordId: null,
    deviceId: null,
    quality: null,
    ...overrides,
  });

  /** Only the SELECT this test cares about -- `beforeAll`'s user insert, and `ingestObservations`'s
   *  own insert, also flow through the same captured logger. */
  const latestSelectQuery = (): string | undefined =>
    [...capturedQueries].reverse().find((q) => /select/i.test(q) && /health_observations/i.test(q));

  beforeAll(() => {
    pool = new Pool({ connectionString });
    const logger: Logger = {
      logQuery: (query) => {
        capturedQueries.push(query);
      },
    };
    db = drizzle(pool, { logger }) as NodePgDatabase<Record<string, never>>;
    repository = new HealthDataRepository(db);
  });

  beforeEach(() => {
    capturedQueries = [];
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(healthObservations).where(inArray(healthObservations.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  describe("getObservationsForUser", () => {
    it("pushes metricTypes, since and limit into the generated SQL rather than filtering in JavaScript", async () => {
      const userId = await makeUser("sql-shape");

      await repository.getObservationsForUser(userId, {
        metricTypes: ["hrv", "resting_heart_rate"],
        since: new Date("2026-08-01T00:00:00.000Z"),
        limit: 25,
      });

      const selectQuery = latestSelectQuery();
      expect(selectQuery).toBeDefined();
      expect(selectQuery).toMatch(/metric_type.*in \(/i);
      expect(selectQuery).toMatch(/start_time.*>=/i);
      expect(selectQuery).toMatch(/limit/i);
    });

    it("omits the start_time predicate when since is null, but still bounds by metricTypes and limit", async () => {
      const userId = await makeUser("since-null");

      await repository.getObservationsForUser(userId, { metricTypes: ["hrv"], since: null, limit: 10 });

      const selectQuery = latestSelectQuery();
      expect(selectQuery).toBeDefined();
      expect(selectQuery).not.toMatch(/start_time.*>=/i);
      expect(selectQuery).toMatch(/metric_type.*in \(/i);
      expect(selectQuery).toMatch(/limit/i);
    });

    it("actually bounds the rows a real query returns by metricTypes and since, not just by shape", async () => {
      const userId = await makeUser("bounded-rows");
      await repository.ingestObservations(userId, [
        observation({ value: 40, startTime: new Date("2020-01-01T00:00:00.000Z"), endTime: new Date("2020-01-01T00:00:00.000Z") }),
        observation({ value: 65, startTime: new Date("2026-09-01T00:00:00.000Z"), endTime: new Date("2026-09-01T00:00:00.000Z") }),
        observation({
          metricType: "steps",
          value: 1000,
          unit: "steps",
          startTime: new Date("2026-09-01T00:00:00.000Z"),
          endTime: new Date("2026-09-01T00:00:00.000Z"),
        }),
      ]);

      const rows = await repository.getObservationsForUser(userId, {
        metricTypes: ["hrv"],
        since: new Date("2026-06-01T00:00:00.000Z"),
        limit: 10,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.metricType).toBe("hrv");
      expect(rows[0]?.value).toBe(65);
    });

    it("caps the number of rows returned at the requested limit", async () => {
      const userId = await makeUser("limit-cap");
      await repository.ingestObservations(
        userId,
        Array.from({ length: 5 }, (_, i) =>
          observation({
            value: i,
            startTime: new Date(Date.UTC(2026, 0, i + 1)),
            endTime: new Date(Date.UTC(2026, 0, i + 1)),
          }),
        ),
      );

      const rows = await repository.getObservationsForUser(userId, { metricTypes: ["hrv"], since: null, limit: 2 });

      expect(rows).toHaveLength(2);
    });
  });
});
