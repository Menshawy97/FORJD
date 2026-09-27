import { Inject, Injectable } from '@nestjs/common';
import { FORGE_LADDERS, ForgeLadder, ForgeLadderState, ForgeWeekResult } from '@forjd/domain';
import { and, desc, eq, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { forgeRewards, forgeUserLadders, forgeWeeks } from '../database/schema/forge.schema';
import { preferences } from '../database/schema/preferences.schema';
import { ForgeWeeklyTotals } from './forge-totals.repository';

/** One ladder's stored position, as the evaluation reads it. */
export interface ForgeStateRow {
  ladder: ForgeLadder;
  state: ForgeLadderState;
  enrolledWeek: string;
  lastEvaluatedWeek: string | null;
}

/** The athlete's most recently evaluated week and the instant it closed. */
export interface ForgeLastWeek {
  weekStart: string;
  closesAt: Date;
}

/** Everything one evaluated week writes, in one transaction. */
export interface ForgeWeekWrite {
  weekStart: string;
  timeZone: string;
  closesAt: Date;
  rulesVersion: number;
  totals: ForgeWeeklyTotals;
  results: Array<{ ladder: ForgeLadder; result: ForgeWeekResult }>;
}

/** The slice of the repository the evaluation service uses, so its spec can pass a fake. */
export interface ForgeStateStore {
  timeZoneOf(userId: string): Promise<string | null>;
  enroll(userId: string, weekStart: string): Promise<void>;
  lockAndApply(
    userId: string,
    plan: (rows: ForgeStateRow[], lastWeek: ForgeLastWeek | null) => Promise<ForgeWeekWrite | null>,
  ): Promise<ForgeWeekWrite | null>;
}

/**
 * Weekly Forge's stored state and its writes (ADR-057 decisions 1, 4 and 7).
 *
 * `lockAndApply` is the whole of an evaluation's write path: it locks the athlete's ladder rows
 * (`select ... for update`), hands them to the caller's plan, and writes what the plan returns --
 * the week's locked results, the new state and the ledger rows -- in the same transaction. The plan
 * also gets the athlete's last evaluated week and its stored close, so the next week starts exactly
 * where the last one ended even if the athlete's time zone has changed since. Two
 * evaluations of one athlete (the hourly job and a `GET /forge` at the same moment) therefore run
 * one after the other, and the second sees the first's `last_evaluated_week` and does nothing.
 */
@Injectable()
export class ForgeStateRepository implements ForgeStateStore {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async timeZoneOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ timeZone: preferences.timezone })
      .from(preferences)
      .where(eq(preferences.userId, userId));
    return row?.timeZone ?? null;
  }

  /** Every ladder at Ore 1 from `weekStart`. Idempotent: an athlete already enrolled is untouched. */
  async enroll(userId: string, weekStart: string): Promise<void> {
    await this.db
      .insert(forgeUserLadders)
      .values(FORGE_LADDERS.map((ladderKey) => ({ userId, ladderKey, enrolledWeek: weekStart })))
      .onConflictDoNothing();
  }

  /** Every enrolled athlete, for the hourly job. */
  async enrolledUserIds(): Promise<string[]> {
    const rows = await this.db.selectDistinct({ userId: forgeUserLadders.userId }).from(forgeUserLadders);
    return rows.map((row) => row.userId);
  }

  async lockAndApply(
    userId: string,
    plan: (rows: ForgeStateRow[], lastWeek: ForgeLastWeek | null) => Promise<ForgeWeekWrite | null>,
  ): Promise<ForgeWeekWrite | null> {
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(forgeUserLadders)
        .where(eq(forgeUserLadders.userId, userId))
        .orderBy(forgeUserLadders.ladderKey)
        .for('update');
      const [last] = await tx
        .select({ weekStart: forgeWeeks.weekStart, closesAt: forgeWeeks.closesAt })
        .from(forgeWeeks)
        .where(eq(forgeWeeks.userId, userId))
        .orderBy(desc(forgeWeeks.weekStart))
        .limit(1);

      const write = await plan(
        locked.map((row) => ({
          ladder: row.ladderKey as ForgeLadder,
          enrolledWeek: row.enrolledWeek,
          lastEvaluatedWeek: row.lastEvaluatedWeek,
          state: {
            level: row.level,
            bestLevel: row.bestLevel,
            missStreak: row.missStreak,
            temperedHoldWeeks: row.temperedHoldWeeks,
            forgedStreak: row.forgedStreak,
            bestForgedStreak: row.bestForgedStreak,
          },
        })),
        last ?? null,
      );
      if (write === null || write.results.length === 0) {
        return null;
      }

      await tx.insert(forgeWeeks).values(
        write.results.map(({ ladder, result }) => ({
          userId,
          ladderKey: ladder,
          weekStart: write.weekStart,
          timeZone: write.timeZone,
          closesAt: write.closesAt,
          total: write.totals[ladder].toFixed(2),
          target: result.target.toFixed(2),
          levelBefore: result.levelBefore,
          levelAfter: result.levelAfter,
          bandBefore: result.bandBefore,
          bandAfter: result.bandAfter,
          outcome: result.outcome,
          missStreakAfter: result.next.missStreak,
          temperedHoldWeeksAfter: result.next.temperedHoldWeeks,
          forgedStreakAfter: result.next.forgedStreak,
          rulesVersion: write.rulesVersion,
        })),
      );

      for (const { ladder, result } of write.results) {
        await tx
          .update(forgeUserLadders)
          .set({ ...result.next, lastEvaluatedWeek: write.weekStart, updatedAt: sql`now()` })
          .where(and(eq(forgeUserLadders.userId, userId), eq(forgeUserLadders.ladderKey, ladder)));
      }

      const rewards = write.results.flatMap(({ ladder, result }) =>
        result.rewards.map((reward) => ({ userId, ladderKey: ladder, weekStart: write.weekStart, ...reward })),
      );
      if (rewards.length > 0) {
        // Append-only and idempotent: a reward already in the ledger is skipped, never updated.
        await tx.insert(forgeRewards).values(rewards).onConflictDoNothing();
      }

      return write;
    });
  }
}
