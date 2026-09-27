import { Inject, Injectable } from '@nestjs/common';
import { and, eq, notInArray, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { forgeLadders, forgeTiers } from '../database/schema/forge.schema';

export interface ForgeLadderSeedRow {
  key: string;
  unit: string;
  maxBand: string;
  isPublic: boolean;
  sortOrder: number;
}

export interface ForgeTierSeedRow {
  ladderKey: string;
  level: number;
  band: string;
  /** Two decimal places, as `numeric(10, 2)` stores it. */
  target: string;
}

export interface ForgeSeedRows {
  ladders: ForgeLadderSeedRow[];
  tiers: ForgeTierSeedRow[];
}

export interface ForgeSeedSummary {
  ladders: number;
  tiers: number;
  /** Ladders and tiers removed because the domain table no longer has them. */
  pruned: number;
}

/**
 * Writes Weekly Forge's reference tables from `@forjd/domain`'s `FORGE_TIERS` (ADR-057 decision 6).
 *
 * Idempotent in one transaction: every ladder and tier is upserted, then anything the domain table
 * no longer has is pruned, so `forge_tiers` can never hold a target the code has dropped. A re-run
 * with an unchanged table writes the same values and prunes nothing.
 */
@Injectable()
export class ForgeSeedRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async replaceAll(rows: ForgeSeedRows): Promise<ForgeSeedSummary> {
    // An empty seed is a caller bug, never "delete all reference data": pruning against an empty
    // list would remove every ladder and tier.
    if (rows.ladders.length === 0 || rows.tiers.length === 0) {
      throw new Error("Refusing to seed Weekly Forge with no ladders or no tiers.");
    }
    return this.db.transaction(async (tx) => {
      for (const ladder of rows.ladders) {
        await tx
          .insert(forgeLadders)
          .values(ladder)
          .onConflictDoUpdate({
            target: forgeLadders.key,
            set: {
              unit: ladder.unit,
              maxBand: ladder.maxBand,
              isPublic: ladder.isPublic,
              sortOrder: ladder.sortOrder,
              updatedAt: sql`now()`,
            },
          });
      }

      await tx
        .insert(forgeTiers)
        .values(rows.tiers)
        .onConflictDoUpdate({
          target: [forgeTiers.ladderKey, forgeTiers.level],
          set: { band: sql`excluded.band`, target: sql`excluded.target` },
        });

      const keep = rows.ladders.map((ladder) => ladder.key);
      // A retired ladder's tiers go with it (`on delete cascade`), so remove them explicitly first
      // to count them.
      const retiredTiers = await tx.delete(forgeTiers).where(notInArray(forgeTiers.ladderKey, keep)).returning();
      const retiredLadders = await tx.delete(forgeLadders).where(notInArray(forgeLadders.key, keep)).returning();

      let prunedTiers = 0;
      for (const ladder of rows.ladders) {
        const levels = rows.tiers.filter((tier) => tier.ladderKey === ladder.key).map((tier) => tier.level);
        const removed = await tx
          .delete(forgeTiers)
          .where(
            levels.length > 0
              ? and(eq(forgeTiers.ladderKey, ladder.key), notInArray(forgeTiers.level, levels))
              : eq(forgeTiers.ladderKey, ladder.key),
          )
          .returning();
        prunedTiers += removed.length;
      }

      return {
        ladders: rows.ladders.length,
        tiers: rows.tiers.length,
        pruned: retiredLadders.length + retiredTiers.length + prunedTiers,
      };
    });
  }
}
