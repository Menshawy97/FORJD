import { Injectable } from '@nestjs/common';
import { LEADERBOARD_PERIODS, MIN_COHORT_SIZE } from '@forjd/domain';

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

export interface SnapshotSummary {
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
  ) {}

  async captureAll(now: Date): Promise<SnapshotSummary> {
    const slugs = await this.snapshots.eligibleCities(MIN_COHORT_SIZE);
    const summary: SnapshotSummary = { cities: 0, rows: 0, failures: [] };

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
          const written = await this.captureCity(citySlug, now);
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

  private async captureCity(citySlug: string, now: Date): Promise<number> {
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
      await this.snapshots.replaceWeek(citySlug, SNAPSHOT_METRIC, period, weekStart, rows);
      written += rows.length;
    }
    return written;
  }
}
