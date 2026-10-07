import { Injectable } from '@nestjs/common';
import { LEADERBOARD_PERIODS, MIN_COHORT_SIZE, rankMoves } from '@forjd/domain';

import { CityResolverService } from '../cities/city-resolver.service';
import { rankCity } from './activity-inputs';
import { monthBounds, snapshotWeekStart } from './city-time';
import { LeaderboardSnapshotRepository, type SnapshotRow } from './leaderboard-snapshot.repository';
import { LeaderboardsRepository } from './leaderboards.repository';

/** The one metric with a real score today; the others return `coming_soon` and have nothing to snapshot. */
const SNAPSHOT_METRIC = 'activity';
const UTC = 'UTC';
/** How many cities are captured at once. */
const SNAPSHOT_CONCURRENCY = 4;

/** Where a rank move goes to become a push (Phase 12F slice 6). Built from the push queue by the snapshot script. */
export interface RankMoveSink {
  queue(move: {
    userId: string;
    direction: 'up' | 'down';
    cityName: string;
    /** The Saturday that starts the week this snapshot closes (`YYYY-MM-DD`). */
    weekStart: string;
    occurredAt: Date;
  }): Promise<boolean>;
}

/** The board a rank push is about: movement over a month resets, so only the all-time board is compared. */
const MOVE_PERIOD = 'all_time';
const MS_PER_DAY = 86_400_000;

/**
 * A run that closes a week, as the Saturday job does: its label (the Saturday of the week it closes) is today or within a day or
 * two. A manual run in mid-week carries last Saturday's label and must not tell anyone anything: it would compare the wrong
 * weeks and its keys would differ from the real Saturday run's, so a mover could be told twice.
 */
function isWeekBoundaryRun(weekStart: string, now: Date): boolean {
  return Date.parse(`${weekStart}T00:00:00Z`) > now.getTime() - 2 * MS_PER_DAY;
}

/** The Saturday a week before `weekStart` (`YYYY-MM-DD`). */
function previousWeekStart(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) - 7 * MS_PER_DAY).toISOString().slice(0, 10);
}

export interface SnapshotSummary {
  /** Rank pushes queued, and ones that could not be (the snapshot itself never fails over a push). */
  moves: number;
  moveFailures: number;
  /** Cities captured without error. */
  cities: number;
  /** Snapshot rows written across all of them. */
  rows: number;
  failures: Array<{ citySlug: string; message: string }>;
}

/**
 * Takes the weekly baseline the "up 3 this week" arrow is measured from (Phase 10J, ADR-047).
 *
 * For every city that has a board, it recomputes the standings with exactly the code the
 * leaderboard read uses and stores each athlete's rank. It only ever recomputes and replaces, so
 * running it twice in a week leaves one set of rows (CLAUDE.md rule 9).
 *
 * **One city failing does not stop the others**: failures are collected and reported, and the
 * script that runs this exits non-zero if there were any, so the workflow run turns red without
 * the healthy cities having been skipped.
 */
@Injectable()
export class LeaderboardSnapshotService {
  constructor(
    private readonly leaderboards: LeaderboardsRepository,
    private readonly snapshots: LeaderboardSnapshotRepository,
    private readonly cityResolver: CityResolverService,
    private readonly moves: RankMoveSink | null = null,
  ) {}

  async captureAll(now: Date): Promise<SnapshotSummary> {
    const slugs = await this.snapshots.eligibleCities(MIN_COHORT_SIZE);
    const summary: SnapshotSummary = { cities: 0, rows: 0, failures: [], moves: 0, moveFailures: 0 };

    // A few cities at a time rather than one after another (review 8.5, L9a-8), and never so many
    // that the job takes over the database's connections.
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < slugs.length) {
        const citySlug = slugs[next] as string;
        next += 1;
        try {
          // Awaited before it is added: `rows += await ...` would read the total before the wait
          // and lose what the other workers added meanwhile.
          const written = await this.captureCity(citySlug, now, summary);
          summary.rows += written;
          summary.cities += 1;
        } catch (error) {
          summary.failures.push({ citySlug, message: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SNAPSHOT_CONCURRENCY, slugs.length) }, worker));
    return summary;
  }

  private async captureCity(citySlug: string, now: Date, summary: SnapshotSummary): Promise<number> {
    const timeZone = this.cityResolver.findBySlug(citySlug)?.timezone ?? UTC;
    const weekStart = snapshotWeekStart(now, timeZone);
    let written = 0;

    for (const period of LEADERBOARD_PERIODS) {
      const window = period === 'month' ? monthBounds(now, timeZone) : null;
      const athletes = await this.leaderboards.cityAthletes(citySlug, timeZone, window);
      // A board below the minimum is never shown, so it has no baseline; the week is cleared so a
      // re-run after athletes left cannot leave a stale one behind.
      const ranked = athletes.length < MIN_COHORT_SIZE ? [] : rankCity(athletes, window, now);
      const rows: SnapshotRow[] = ranked.map((entry) => ({
        userId: entry.userId,
        rank: entry.rank,
        score: entry.score,
        cohortSize: ranked.length,
      }));
      // Compared with last Saturday's standings **before** this week replaces anything, then queued; never able to fail the snapshot.
      if (period === MOVE_PERIOD && this.moves && rows.length > 0 && isWeekBoundaryRun(weekStart, now)) {
        await this.queueMoves(citySlug, weekStart, rows, now, summary);
      }
      await this.snapshots.replaceWeek(citySlug, SNAPSHOT_METRIC, period, weekStart, rows);
      written += rows.length;
    }
    return written;
  }

  private async queueMoves(
    citySlug: string,
    weekStart: string,
    rows: readonly SnapshotRow[],
    now: Date,
    summary: SnapshotSummary,
  ): Promise<void> {
    const sink = this.moves;
    const cityName = this.cityResolver.findBySlug(citySlug)?.name;
    if (!sink || !cityName) return;
    try {
      const lastWeek = previousWeekStart(weekStart);
      const previous = await this.snapshots.baselineRanks(citySlug, SNAPSHOT_METRIC, MOVE_PERIOD, lastWeek, lastWeek);
      for (const move of rankMoves(previous, rows)) {
        try {
          // Only a push that was really queued counts: a switch that is off, no phone, or a repeat is not one.
          if (await sink.queue({ ...move, cityName, weekStart, occurredAt: now })) summary.moves += 1;
        } catch {
          summary.moveFailures += 1;
        }
      }
    } catch {
      summary.moveFailures += 1;
    }
  }
}
