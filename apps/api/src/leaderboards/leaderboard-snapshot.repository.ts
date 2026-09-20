import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { Database, DRIZZLE } from '../database/database.module';
import { executeValidated } from '../database/db-utils';
import { leaderboardRankSnapshots } from '../database/schema/leaderboards.schema';

const eligibleCityRowSchema = z.object({ city_slug: z.string() });

/** One athlete's place in a captured week. `score` is what the board showed, to one decimal. */
export interface SnapshotRow {
  userId: string;
  rank: number;
  score: number;
  cohortSize: number;
}

/**
 * Reads and writes of the weekly rank snapshots (Phase 10J, ADR-047).
 *
 * A snapshot is derived data, so it is **recomputed and replaced, never patched** (CLAUDE.md rule
 * 9): `replaceWeek` deletes the week's rows for one city, metric and period and inserts the fresh
 * set in a single transaction. That is also what makes the weekly job safe to re-run.
 */
@Injectable()
export class LeaderboardSnapshotRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The cities worth snapshotting: at least `minCohortSize` athletes who could be on the board
   * right now, judged by the same eligibility rule as `LeaderboardsRepository.cityAthletes` (live
   * runner, completed, opted in, location allowed). A city below the bar shows no board, so
   * there is nothing to take a baseline of.
   */
  async eligibleCities(minCohortSize: number): Promise<string[]> {
    const rows = await executeValidated(
      this.db,
      sql`
      select ws.city_slug
      from workout_sessions ws
      join privacy_settings ps on ps.user_id = ws.user_id
      where ws.city_slug is not null
        and ws.deleted_at is null
        and ws.status = 'completed'
        and ws.is_live_tracked = true
        and ws.ended_at is not null
        and ps.leaderboard_opt_in = true
        and ps.location_for_leaderboard = true
      group by ws.city_slug
      having count(distinct ws.user_id) >= ${minCohortSize}
      order by ws.city_slug
      `,
      eligibleCityRowSchema,
      'LeaderboardSnapshotRepository.eligibleCities',
    );
    return rows.map((row) => row.city_slug);
  }

  /** Replaces one week of one city's board, atomically. An empty `rows` clears the week. */
  async replaceWeek(
    citySlug: string,
    metric: string,
    period: string,
    weekStart: string,
    rows: readonly SnapshotRow[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(leaderboardRankSnapshots)
        .where(
          and(
            eq(leaderboardRankSnapshots.citySlug, citySlug),
            eq(leaderboardRankSnapshots.metric, metric),
            eq(leaderboardRankSnapshots.period, period),
            eq(leaderboardRankSnapshots.weekStart, weekStart),
          ),
        );
      if (rows.length === 0) return;
      await tx.insert(leaderboardRankSnapshots).values(
        rows.map((row) => ({
          userId: row.userId,
          citySlug,
          metric,
          period,
          weekStart,
          rank: row.rank,
          score: row.score.toFixed(1),
          cohortSize: row.cohortSize,
        })),
      );
    });
  }

  /**
   * Where everyone in the city stood at the baseline: the snapshot of `weekStart`, or the latest
   * earlier one when this week has not been captured yet (the job runs on Monday, so a city whose
   * Monday has begun can be a few hours ahead of it). Never a later week, and never one before
   * `notBefore`, so an old or different-month baseline is not passed off as this week's.
   */
  async baselineRanks(
    citySlug: string,
    metric: string,
    period: string,
    weekStart: string,
    notBefore: string,
  ): Promise<Map<string, number>> {
    const scope = and(
      eq(leaderboardRankSnapshots.citySlug, citySlug),
      eq(leaderboardRankSnapshots.metric, metric),
      eq(leaderboardRankSnapshots.period, period),
    );
    const [latest] = await this.db
      .select({ weekStart: sql<string | null>`max(${leaderboardRankSnapshots.weekStart})` })
      .from(leaderboardRankSnapshots)
      .where(
        and(
          scope,
          lte(leaderboardRankSnapshots.weekStart, weekStart),
          gte(leaderboardRankSnapshots.weekStart, notBefore),
        ),
      );
    if (!latest?.weekStart) return new Map();

    const rows = await this.db
      .select({ userId: leaderboardRankSnapshots.userId, rank: leaderboardRankSnapshots.rank })
      .from(leaderboardRankSnapshots)
      .where(and(scope, eq(leaderboardRankSnapshots.weekStart, latest.weekStart)));
    return new Map(rows.map((row) => [row.userId, row.rank]));
  }
}
