import { Inject, Injectable } from '@nestjs/common';
import { ForgeBand, ForgeLadder, ForgeOutcome, ForgeReward } from '@forjd/domain';
import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { forgeRewards, forgeUserLadders, forgeWeekAcks, forgeWeeks } from '../database/schema/forge.schema';
import { preferences } from '../database/schema/preferences.schema';

export interface ForgeLadderRow {
  ladder: ForgeLadder;
  level: number;
  missStreak: number;
  temperedHoldWeeks: number;
  forgedStreak: number;
  bestForgedStreak: number;
}

export interface ForgeClosedLadderRow {
  ladder: ForgeLadder;
  outcome: ForgeOutcome;
  levelBefore: number;
  levelAfter: number;
  bandBefore: ForgeBand;
  bandAfter: ForgeBand;
  total: number;
  target: number;
  rewards: ForgeReward[];
}

export interface ForgeClosedWeek {
  weekStart: string;
  ladders: ForgeClosedLadderRow[];
}

/** How many unseen closed weeks one request returns. More than this is a backlog, not news. */
export const PENDING_WEEK_LIMIT = 8;

/**
 * The reads behind Weekly Forge's routes, and the two small writes they own (acknowledging a week,
 * storing the phone's time zone). Every query is scoped by the caller's `userId`.
 */
@Injectable()
export class ForgeReadRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async ladders(userId: string): Promise<ForgeLadderRow[]> {
    const rows = await this.db.select().from(forgeUserLadders).where(eq(forgeUserLadders.userId, userId));
    return rows.map((row) => ({
      ladder: row.ladderKey as ForgeLadder,
      level: row.level,
      missStreak: row.missStreak,
      temperedHoldWeeks: row.temperedHoldWeeks,
      forgedStreak: row.forgedStreak,
      bestForgedStreak: row.bestForgedStreak,
    }));
  }

  /** Every band the athlete has entered, per ladder: their band badges, lowest first. */
  async badges(userId: string): Promise<Array<{ ladder: ForgeLadder; band: ForgeBand }>> {
    const rows = await this.db
      .select({ ladder: forgeRewards.ladderKey, band: forgeRewards.band })
      .from(forgeRewards)
      .where(and(eq(forgeRewards.userId, userId), eq(forgeRewards.type, 'band_badge')))
      .orderBy(asc(forgeRewards.level));
    return rows.map((row) => ({ ladder: row.ladder as ForgeLadder, band: row.band as ForgeBand }));
  }

  /** The most recent closed weeks the athlete has not acknowledged, oldest first. */
  async pendingWeeks(userId: string): Promise<ForgeClosedWeek[]> {
    const unseen = await this.db
      .selectDistinct({ weekStart: forgeWeeks.weekStart })
      .from(forgeWeeks)
      .where(
        and(
          eq(forgeWeeks.userId, userId),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(forgeWeekAcks)
              .where(and(eq(forgeWeekAcks.userId, userId), eq(forgeWeekAcks.weekStart, forgeWeeks.weekStart))),
          ),
        ),
      )
      .orderBy(desc(forgeWeeks.weekStart))
      .limit(PENDING_WEEK_LIMIT);
    const weekStarts = unseen.map((row) => row.weekStart);
    if (weekStarts.length === 0) {
      return [];
    }

    const [weekRows, rewardRows] = await Promise.all([
      this.db
        .select()
        .from(forgeWeeks)
        .where(and(eq(forgeWeeks.userId, userId), inArray(forgeWeeks.weekStart, weekStarts)))
        .orderBy(asc(forgeWeeks.weekStart), asc(forgeWeeks.ladderKey)),
      this.db
        .select()
        .from(forgeRewards)
        .where(and(eq(forgeRewards.userId, userId), inArray(forgeRewards.weekStart, weekStarts))),
    ]);

    return [...weekStarts].sort().map((weekStart) => ({
      weekStart,
      ladders: weekRows
        .filter((row) => row.weekStart === weekStart)
        .map((row) => ({
          ladder: row.ladderKey as ForgeLadder,
          outcome: row.outcome as ForgeOutcome,
          levelBefore: row.levelBefore,
          levelAfter: row.levelAfter,
          bandBefore: row.bandBefore as ForgeBand,
          bandAfter: row.bandAfter as ForgeBand,
          total: Number(row.total),
          target: Number(row.target),
          rewards: rewardRows
            .filter((reward) => reward.weekStart === weekStart && reward.ladderKey === row.ladderKey)
            .map((reward) => ({ type: reward.type, level: reward.level, band: reward.band }) as ForgeReward),
        })),
    }));
  }

  async hasWeek(userId: string, weekStart: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: forgeWeeks.id })
      .from(forgeWeeks)
      .where(and(eq(forgeWeeks.userId, userId), eq(forgeWeeks.weekStart, weekStart)))
      .limit(1);
    return row !== undefined;
  }

  /** Idempotent: acknowledging a week twice is harmless. */
  async acknowledge(userId: string, weekStart: string): Promise<void> {
    await this.db.insert(forgeWeekAcks).values({ userId, weekStart }).onConflictDoNothing();
  }

  /** Stores the phone's IANA zone, which closes the athlete's Forge weeks (ADR-057 decision 3). */
  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    await this.db
      .insert(preferences)
      .values({ userId, timezone: timeZone })
      .onConflictDoUpdate({ target: preferences.userId, set: { timezone: timeZone, updatedAt: sql`now()` } });
  }
}
