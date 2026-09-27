import { eq, sql } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { forgeLadders, forgeTiers } from "../database/schema/forge.schema";
import { ForgeSeedRepository } from "./forge-seed.repository";
import { forgeSeedRows } from "./seed/seed";

/**
 * Against real Postgres: the claims are that seeding is idempotent (a re-run changes nothing), that
 * a changed target is updated in place, and that a level removed from the domain table is pruned,
 * so the table can never hold a target the code no longer has.
 */
describe("ForgeSeedRepository", () => {
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: ForgeSeedRepository;

  const count = async (): Promise<{ ladders: number; tiers: number }> => {
    const [ladders] = await db.select({ n: sql<number>`count(*)::int` }).from(forgeLadders);
    const [tiers] = await db.select({ n: sql<number>`count(*)::int` }).from(forgeTiers);
    return { ladders: ladders!.n, tiers: tiers!.n };
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new ForgeSeedRepository(db as never);
  });

  afterAll(async () => {
    // Leave the real table seeded, as a deploy would.
    await repository.replaceAll(forgeSeedRows());
    await pool.end();
  });

  it("writes every ladder and tier, and a second run changes nothing", async () => {
    const rows = forgeSeedRows();

    await repository.replaceAll(rows);
    const first = await count();
    const again = await repository.replaceAll(rows);
    const second = await count();

    expect(first).toEqual({ ladders: rows.ladders.length, tiers: rows.tiers.length });
    expect(second).toEqual(first);
    expect(again.pruned).toBe(0);
  });

  it("updates a changed target in place", async () => {
    const rows = forgeSeedRows();
    const changed = {
      ...rows,
      tiers: rows.tiers.map((tier) =>
        tier.ladderKey === "volume" && tier.level === 1 ? { ...tier, target: "1900.00" } : tier,
      ),
    };

    await repository.replaceAll(changed);

    const [tier] = await db
      .select()
      .from(forgeTiers)
      .where(sql`${forgeTiers.ladderKey} = 'volume' and ${forgeTiers.level} = 1`);
    expect(tier?.target).toBe("1900.00");
  });

  it("prunes a level the domain table no longer has, and a ladder it no longer has", async () => {
    const rows = forgeSeedRows();
    await db
      .insert(forgeLadders)
      .values({ key: "retired-ladder", unit: "kg", maxBand: "ore", isPublic: true, sortOrder: 50 })
      .onConflictDoNothing();
    await db.insert(forgeTiers).values({ ladderKey: "retired-ladder", level: 1, band: "ore", target: "1" }).onConflictDoNothing();
    await db.insert(forgeTiers).values({ ladderKey: "nourish", level: 7, band: "anvil", target: "7" }).onConflictDoNothing();

    const summary = await repository.replaceAll(rows);

    expect(summary.pruned).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(forgeLadders).where(eq(forgeLadders.key, "retired-ladder"))).toEqual([]);
    expect(
      await db.select().from(forgeTiers).where(sql`${forgeTiers.ladderKey} = 'nourish' and ${forgeTiers.level} = 7`),
    ).toEqual([]);
    expect(await count()).toEqual({ ladders: rows.ladders.length, tiers: rows.tiers.length });
  });
});
