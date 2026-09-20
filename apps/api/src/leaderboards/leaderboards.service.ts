import { Injectable } from '@nestjs/common';
import type { LeaderboardQuery, LeaderboardResponse, LeaderboardRow } from '@forjd/contracts';
import {
  LIVE_METRICS,
  MIN_COHORT_SIZE,
  rankWindow,
  topPercent,
  User,
  type LeaderboardStatus,
  type RankedAthlete,
} from '@forjd/domain';

import { CityResolverService } from '../cities/city-resolver.service';
import { PrivacyService } from '../privacy/privacy.service';
import { rankCity } from './activity-inputs';
import { baselineNotBefore, comparisonWeekStart, monthBounds, periodLabel } from './city-time';
import { LeaderboardSnapshotRepository } from './leaderboard-snapshot.repository';
import { CityAthleteRow, LeaderboardsRepository } from './leaderboards.repository';

/** Used to date a board that has no city to date it by: not opted in, or no city yet. */
const NO_CITY_TIME_ZONE = 'UTC';

interface CityContext {
  name: string;
  slug: string;
  timeZone: string;
}

/**
 * The city leaderboard (Phase 10, ADR-046, ADR-047): who is in the caller's city, ranked, in a
 * window around the caller.
 *
 * **Every response is one of six designed states, not an error** (`LEADERBOARD_STATUSES`), each with
 * its own copy on the screen, and only `ranked` carries rows or a `me`: a number can never ride
 * along with `coming_soon`, `cohort_too_small` and the rest. `not_opted_in` is a 200 and not a 403
 * for that reason: the screen has a state for it, and a 403 would make the client guess why.
 *
 * **Privacy is read live, never cached.** `PrivacyService.get` is called on every request (the
 * precedent is `requireHealthDataConsent`), and the repository joins every athlete's own settings
 * inside the query, so a withdrawal is true on the very next request.
 *
 * **The caller's city is the city of their latest eligible session**, not `profiles.city`, which is
 * volunteered and unvalidated. That is what makes "the leaderboard does not follow you when you
 * relocate" true by construction (`docs/architecture/security.md`).
 *
 * The scoring is `scoreCohort` in `@forjd/domain`, a pure function; this class only gathers the
 * inputs and shapes the response. `now` is a parameter, so the calendar is a function of its
 * arguments and the whole thing is testable at a fixed instant.
 */
@Injectable()
export class LeaderboardsService {
  constructor(
    private readonly repository: LeaderboardsRepository,
    private readonly privacyService: PrivacyService,
    private readonly cityResolver: CityResolverService,
    private readonly snapshots: LeaderboardSnapshotRepository,
  ) {}

  async get(viewer: User, query: LeaderboardQuery, now: Date = new Date()): Promise<LeaderboardResponse> {
    const { metric, period } = query;

    // Strength, running and HYROX have no score yet. The chip is real and the answer is a designed
    // state with no rows, so a fabricated number is not representable (ADR-046).
    if (!(LIVE_METRICS as readonly string[]).includes(metric)) {
      const city = await this.callerCity(viewer.id);
      return this.empty('coming_soon', query, city, now, 0);
    }

    const privacy = await this.privacyService.get(viewer.id);
    if (!privacy.leaderboardOptIn) return this.empty('not_opted_in', query, null, now, 0);
    if (!privacy.locationForLeaderboard) return this.empty('no_city', query, null, now, 0);

    const city = await this.callerCity(viewer.id);
    if (!city) return this.empty('no_eligible_sessions', query, null, now, 0);

    const window = period === 'month' ? monthBounds(now, city.timeZone) : null;
    const athletes = await this.repository.cityAthletes(city.slug, city.timeZone, window);

    const isCaller = (athlete: CityAthleteRow): boolean => athlete.userId === viewer.id;
    if (!athletes.some(isCaller)) return this.empty('no_eligible_sessions', query, city, now, athletes.length);
    if (athletes.length < MIN_COHORT_SIZE) return this.empty('cohort_too_small', query, city, now, athletes.length);

    const ranked = rankCity(athletes, window, now);
    const me = ranked.find((entry) => entry.userId === viewer.id) as RankedAthlete;
    const { from, to } = rankWindow(me.rank, ranked.length, query.window);
    const byId = new Map(athletes.map((athlete) => [athlete.userId, athlete]));
    const baseline = await this.snapshots.baselineRanks(city.slug, metric, period, comparisonWeekStart(now, city.timeZone), baselineNotBefore(period, now, city.timeZone));
    // Positive means moved up: last week's rank minus this week's. Null when there is nothing to compare.
    const deltaOf = (entry: RankedAthlete): number | null => {
      const before = baseline.get(entry.userId);
      return before === undefined ? null : before - entry.rank;
    };

    return {
      status: 'ranked',
      metric,
      period,
      city: { name: city.name, slug: city.slug },
      periodLabel: periodLabel(period, now, city.timeZone),
      cohortSize: ranked.length,
      minCohortSize: MIN_COHORT_SIZE,
      me: { rank: me.rank, score: me.score, topPercent: topPercent(me.rank, ranked.length), delta: deltaOf(me) },
      rows: ranked.slice(from - 1, to).map((entry) => this.toRow(entry, byId.get(entry.userId) as CityAthleteRow, viewer.id, deltaOf(entry))),
    };
  }

  /** The caller's city, from their latest eligible session, with the timezone its month is measured in. */
  private async callerCity(userId: string): Promise<CityContext | null> {
    const latest = await this.repository.latestEligibleCity(userId);
    if (!latest) return null;
    const known = this.cityResolver.findBySlug(latest.citySlug);
    return {
      name: known?.name ?? latest.city ?? latest.citySlug,
      slug: latest.citySlug,
      // A slug from an older version of the city list can be missing from the current one; the
      // board still works, measured in UTC, rather than failing.
      timeZone: known?.timezone ?? NO_CITY_TIME_ZONE,
    };
  }

  /** A state with no rows and no `me`: every status except `ranked`. */
  private empty(
    status: Exclude<LeaderboardStatus, 'ranked'>,
    query: LeaderboardQuery,
    city: CityContext | null,
    now: Date,
    cohortSize: number,
  ): LeaderboardResponse {
    return {
      status,
      metric: query.metric,
      period: query.period,
      city: city ? { name: city.name, slug: city.slug } : null,
      periodLabel: periodLabel(query.period, now, city?.timeZone ?? NO_CITY_TIME_ZONE),
      cohortSize,
      minCohortSize: MIN_COHORT_SIZE,
      me: null,
      rows: [],
    };
  }

  private toRow(entry: RankedAthlete, athlete: CityAthleteRow, viewerId: string, delta: number | null): LeaderboardRow {
    return {
      rank: entry.rank,
      userId: entry.userId,
      // Never nameless: joining a leaderboard means being shown on it, and a private profile only
      // decides whether the row can be opened (D10).
      displayName: athlete.displayName ?? athlete.username ?? 'Athlete',
      username: athlete.username,
      // The photo is what a stranger cannot get from a private profile anywhere else (D10 shows name
      // and username only), so it is withheld from everyone but the person it belongs to.
      avatarUrl: athlete.isPublicProfile || entry.userId === viewerId ? athlete.avatarUrl : null,
      score: entry.score,
      delta,
      isSelf: entry.userId === viewerId,
      isPublicProfile: athlete.isPublicProfile,
    };
  }
}
