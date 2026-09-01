import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicProfileResponse } from '@forjd/contracts';
import { Profile, User } from '@forjd/domain';

import { PrivacyRepository } from '../privacy/privacy.repository';
import { UsersRepository } from '../users/users.repository';

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
  ) {}

  async getPublicProfile(viewer: User, userId: string): Promise<PublicProfileResponse> {
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
    return this.toPublicProfile(profile, isSelf);
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
  private toPublicProfile(profile: Profile, isSelf: boolean): PublicProfileResponse {
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      city: profile.city,
      trainingGoals: profile.trainingGoals,
      activities: profile.activities,
      isSelf,
    };
  }
}
