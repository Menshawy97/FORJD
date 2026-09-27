import { eq } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { Database } from "../database/database.module";
import { featureFlags } from "../database/schema/feature-flags.schema";
import { FeatureFlagsRepository } from "./feature-flags.repository";

/** Against real Postgres: the `feature_flags` table is the one switch that turns a feature on. */
describe("FeatureFlagsRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";
  const ON = `test-flag-on-${Date.now()}`;
  const OFF = `test-flag-off-${Date.now()}`;

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: FeatureFlagsRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new FeatureFlagsRepository(db as unknown as Database);
    await db.insert(featureFlags).values([
      { key: ON, enabled: true },
      { key: OFF, enabled: false },
    ]);
  });

  afterAll(async () => {
    await db.delete(featureFlags).where(eq(featureFlags.key, ON));
    await db.delete(featureFlags).where(eq(featureFlags.key, OFF));
    await pool.end();
  });

  it("reports a flag that is switched on", async () => {
    expect(await repository.isEnabled(ON)).toBe(true);
  });

  it("reports a flag that is switched off, and one that does not exist, as off", async () => {
    expect(await repository.isEnabled(OFF)).toBe(false);
    expect(await repository.isEnabled(`missing-${Date.now()}`)).toBe(false);
  });

  it("lists only the flags that are switched on", async () => {
    const enabled = await repository.enabledKeys();

    expect(enabled).toContain(ON);
    expect(enabled).not.toContain(OFF);
  });

  // Migration 0031 switched Weekly Forge on in every environment (the user's call, 2026-09-27).
  it("has weekly_forge switched on", async () => {
    expect(await repository.isEnabled("weekly_forge")).toBe(true);
  });
});
