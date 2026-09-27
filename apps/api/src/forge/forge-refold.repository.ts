import { Inject, Injectable } from '@nestjs/common';
import { FORGE_RULES_VERSION, ForgeLadder, refoldLadder } from '@forjd/domain';
import { and, asc, eq, lt, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { forgeRewards, forgeUserLadders, forgeWeeks } from '../database/schema/forge.schema';

export interface ForgeRefoldSummary {
  /** Stored weeks rewritten, one per athlete, ladder and week. */
  weeks: number;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Recomputes athletes' stored Weekly Forge weeks under the current tier table and rules
 * (ADR-058 decision 4). Each athlete's locked weekly totals are replayed from Ore 1 through
 * `refoldLadder`; the totals themselves are never touched.
 *
 * - **One athlete per transaction**, holding the same `forge_user_ladders ... for update` lock as
 *   `ForgeStateRepository.lockAndApply`, so a refold and an evaluation of one athlete can never
 *   interleave.
 * - **Only stale athletes.** `staleUserIds` lists athletes with a week below `FORGE_RULES_VERSION`,
 *   and a refold stamps every one of their weeks with it, so a second run finds nobody.
 * - **Rewards are append-only.** New ones go in with `on conflict do nothing`; none is removed.
 */
@Injectable()
export class ForgeRefoldRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async staleUserIds(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ userId: forgeWeeks.userId })
      .from(forgeWeeks)
      .where(lt(forgeWeeks.rulesVersion, FORGE_RULES_VERSION));
    return rows.map((row) => row.userId);
  }

  /** Refolds every stored week of one athlete. What `forge:refold` calls for each stale athlete. */
  async refoldUser(userId: string): Promise<ForgeRefoldSummary> {
    return this.db.transaction(async (tx) => this.refoldLocked(tx, userId));
  }

  /**
   * The evaluation's backstop (ADR-058 decision 4): refolds the athlete only while a week is still on
   * an older rules version -- one an old API revision closed during a deploy, after that deploy's
   * refold had already run. Checked under the same lock, so it can't race the evaluation it precedes.
   * Returns whether anything was refolded.
   */
  async refoldUserIfStale(userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await this.lockLadders(tx, userId);
      const [stale] = await tx
        .select({ id: forgeWeeks.id })
        .from(forgeWeeks)
        .where(and(eq(forgeWeeks.userId, userId), lt(forgeWeeks.rulesVersion, FORGE_RULES_VERSION)))
        .limit(1);
      if (!stale) {
        return false;
      }
      await this.refoldLocked(tx, userId);
      return true;
    });
  }

  /** Takes the evaluation's row lock and returns the ladders it covers. Re-locking in one transaction is a no-op. */
  private async lockLadders(tx: Transaction, userId: string): Promise<Set<string>> {
    const locked = await tx
      .select({ ladderKey: forgeUserLadders.ladderKey })
      .from(forgeUserLadders)
      .where(eq(forgeUserLadders.userId, userId))
      .orderBy(forgeUserLadders.ladderKey)
      .for('update');
    return new Set(locked.map((row) => row.ladderKey));
  }

  private async refoldLocked(tx: Transaction, userId: string): Promise<ForgeRefoldSummary> {
    const locked = await this.lockLadders(tx, userId);

    const weeks = await tx
      .select({
        id: forgeWeeks.id,
        ladderKey: forgeWeeks.ladderKey,
        weekStart: forgeWeeks.weekStart,
        total: forgeWeeks.total,
      })
      .from(forgeWeeks)
      .where(eq(forgeWeeks.userId, userId))
      .orderBy(asc(forgeWeeks.ladderKey), asc(forgeWeeks.weekStart));

    const byLadder = new Map<ForgeLadder, typeof weeks>();
    for (const week of weeks) {
      // Enrolment always writes every ladder's row together, so weeks without one mean something
      // went wrong elsewhere. Rewriting them without the row lock could race an evaluation: fail
      // loudly instead, and the transaction leaves the athlete as it was.
      if (!locked.has(week.ladderKey)) {
        throw new Error(`Forge refold: athlete ${userId} has ${week.ladderKey} weeks but no ${week.ladderKey} ladder row.`);
      }
      const ladder = week.ladderKey as ForgeLadder;
      byLadder.set(ladder, [...(byLadder.get(ladder) ?? []), week]);
    }

    for (const [ladder, ladderWeeks] of byLadder) {
      await this.rewriteLadder(tx, userId, ladder, ladderWeeks);
    }
    return { weeks: weeks.length };
  }

  private async rewriteLadder(
    tx: Transaction,
    userId: string,
    ladder: ForgeLadder,
    weeks: Array<{ id: string; weekStart: string; total: string }>,
  ): Promise<void> {
    const { results, state } = refoldLadder(
      ladder,
      weeks.map((week) => Number(week.total)),
    );

    for (const [index, result] of results.entries()) {
      await tx
        .update(forgeWeeks)
        .set({
          target: result.target.toFixed(2),
          levelBefore: result.levelBefore,
          levelAfter: result.levelAfter,
          bandBefore: result.bandBefore,
          bandAfter: result.bandAfter,
          outcome: result.outcome,
          missStreakAfter: result.next.missStreak,
          temperedHoldWeeksAfter: result.next.temperedHoldWeeks,
          forgedStreakAfter: result.next.forgedStreak,
          rulesVersion: FORGE_RULES_VERSION,
        })
        .where(eq(forgeWeeks.id, weeks[index]!.id));
    }

    await tx
      .update(forgeUserLadders)
      .set({ ...state, updatedAt: sql`now()` })
      .where(and(eq(forgeUserLadders.userId, userId), eq(forgeUserLadders.ladderKey, ladder)));

    const rewards = results.flatMap((result, index) =>
      result.rewards.map((reward) => ({ userId, ladderKey: ladder, weekStart: weeks[index]!.weekStart, ...reward })),
    );
    if (rewards.length > 0) {
      // Append-only and idempotent: a reward already in the ledger is skipped, never updated.
      await tx.insert(forgeRewards).values(rewards).onConflictDoNothing();
    }
  }
}
