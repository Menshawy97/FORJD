import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicProfileResponse } from '@forjd/contracts';
import { Profile, User } from '@forjd/domain';

import { CityResolverService } from '../cities/city-resolver.service';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';
import { PrivacyRepository } from '../privacy/privacy.repository';
import { UsersRepository } from '../users/users.repository';
import { AthleteStatsRepository } from './athlete-stats.repository';

const RECORD_COUNT = 4;
const RECENT_SESSION_COUNT = 3;
const UTC = 'UTC';

/** Matches any RFC 4122 version. Rejecting early keeps a malformed id out of Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads another athlete's profile.
 *
 * **Why a service and not a guard.** A guard returns a boolean: it can answer "may this
 * request proceed", but it cannot express *which fields* may appear in the answer, and making
 * it try means reading the same rows twice. Admission and projection are different decisions,
 * so a guard decides the first and this class decides the second. CLAUDE.md rule 12 asks for
 * authorization in code that can be unit-tested, not for a class whose name ends in `Guard`.
 */
@Injectable()
export class AthletesService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly privacyRepository: PrivacyRepository,
    private readonly statsRepository: AthleteStatsRepository,
    private readonly leaderboards: LeaderboardsService,
    private readonly cityResolver: CityResolverService,
  ) {}

  async getPublicProfile(
    viewer: User,
    userId: string,
    now: Date = new Date(),
  ): Promise<PublicProfileResponse> {
    // A malformed id never reaches the database. Postgres raises an invalid-uuid cast as an
    // error that surfaces as a 500 — a third, distinguishable response, which is exactly what
    // the single refusal shape below exists to avoid.
    if (!UUID_PATTERN.test(userId)) {
      throw this.refuse();
    }

    // Postgres compares uuid columns case-insensitively, so the downstream lookups below
    // treat two differently-cased spellings of the same id as the same row. Comparing here
    // with plain string equality would not: a genuine owner requesting their own id in a
    // different case would compute isSelf=false and then be gated behind their own privacy
    // check — an over-refusal (a false 404 on your own profile), not a leak, but worth
    // avoiding for free.
    const isSelf = viewer.id.toLowerCase() === userId.toLowerCase();

    const profile = await this.usersRepository.findProfile(userId);
    if (!profile) {
      throw this.refuse();
    }

    if (!isSelf) {
      // `find`, not `findOrCreate`. Creating a row as a side effect of a stranger's read
      // would let one user cause a write on another's behalf, and a missing row is a reason
      // to refuse rather than a reason to invent a default.
      const privacy = await this.privacyRepository.find(userId);

      if (!privacy?.publicProfile) {
        throw this.refuse();
      }
    }

    // Reached only once access is settled. The projection is never built and then stripped:
    // a build-then-strip would mean the full record briefly exists in the shape that gets
    // serialised, and every future field would be exposed by default until someone removed it.
    return this.toPublicProfile(profile, isSelf, now);
  }

  /**
   * One refusal for every reason — unknown account, private account, malformed id.
   *
   * **404, never 403.** A 403 says "this account exists but you may not see it", which makes
   * the endpoint an oracle: anyone with a list of candidate ids could sort real accounts from
   * imaginary ones, on a product whose accounts hold health data. The same reasoning already
   * governs forgot-password here. The message is deliberately generic and identical in every
   * case, because a difference in wording is a difference an attacker can read.
   */
  private refuse(): NotFoundException {
    return new NotFoundException('Athlete not found');
  }

  /**
   * Every field is named explicitly. No spread, and no `Pick` of the owner's profile — both
   * would make "add a column" and "publish a column to strangers" the same action. Anything
   * absent from this list is absent from the response, and adding something here is a visible
   * edit to a file about what strangers can see.
   */
  private async toPublicProfile(profile: Profile, isSelf: boolean, now: Date): Promise<PublicProfileResponse> {
    const [standing, records, sessions] = await Promise.all([
      this.leaderboards.standingFor(profile.userId, now),
      this.statsRepository.personalRecords(profile.userId, RECORD_COUNT),
      this.statsRepository.recentSessions(profile.userId, RECENT_SESSION_COUNT),
    ]);

    // The tiles exist only for an athlete who is ranked this month, and the streak goes with
    // them: a profile shows a rank only for someone who chose to be on the leaderboard. The
    // streak is dated in the ranked city's own calendar.
    const stats = standing
      ? {
          cityName: standing.cityName,
          cityRank: standing.rank,
          score: standing.score,
          streakWeeks: await this.statsRepository.weekStreak(
            profile.userId,
            this.cityResolver.findBySlug(standing.citySlug)?.timezone ?? UTC,
            now,
          ),
          periodLabel: standing.periodLabel,
        }
      : null;

    return {
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      city: profile.city,
      trainingGoals: profile.trainingGoals,
      activities: profile.activities,
      isSelf,
      stats,
      personalRecords: records.map((record) => ({
        exerciseName: record.exerciseName,
        weightKg: record.weightKg,
      })),
      recentSessions: sessions.map((session) => ({
        name: session.name,
        startedAt: session.startedAt.toISOString(),
        volumeKg: session.volumeKg,
        durationSeconds: session.durationSeconds,
      })),
    };
  }
}
