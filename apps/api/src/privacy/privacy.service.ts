import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { UpdatePrivacyRequest } from '@forjd/contracts';
import { PrivacySettings } from '@forjd/domain';

import { PrivacyPatch, PrivacyRepository } from './privacy.repository';

/**
 * Every rule *about* consent lives here, and none of it lives in the repository or in SQL.
 *
 * That split is CLAUDE.md rule 12 applied to consent rather than to authorization: a rule
 * expressed only as a CHECK constraint cannot be unit-tested, and surfaces a violation as an
 * opaque 500 instead of the 400 a client can act on. This class carries a 100% coverage
 * threshold for the same reason — an untested branch in a consent decision is the branch
 * that silently grants something.
 *
 * **Nothing here is cached.** A cached consent flag means a withdrawal has a window in which
 * it is not yet true, and docs/architecture/security.md treats that window as a security
 * parameter that must be stated rather than discovered. When the AI module needs the read to
 * be cheap, it gets a cache with an explicit, documented TTL — not before.
 */
@Injectable()
export class PrivacyService {
  constructor(private readonly privacyRepository: PrivacyRepository) {}

  get(userId: string): Promise<PrivacySettings> {
    return this.privacyRepository.findOrCreate(userId);
  }

  async update(userId: string, request: UpdatePrivacyRequest): Promise<PrivacySettings> {
    // Guarantees the row exists before the locking read, which cannot create one.
    await this.privacyRepository.findOrCreate(userId);

    // Every rule below is a statement about a *transition*, so it must be evaluated against
    // the row as it is at write time. `updateLocked` holds a row lock across the read, the
    // decision and the write, so two overlapping requests cannot both decide against the same
    // stale snapshot and leave a state neither of them checked — see the repository for the
    // concrete interleaving this closes.
    //
    // It is also why nothing here is cached: the comparison has to be against what is stored
    // right now, and a cached flag would mean a withdrawal has a window in which it is not
    // yet true. docs/architecture/security.md treats that window as a security parameter to
    // be stated rather than discovered.
    const updated = await this.privacyRepository.updateLocked(userId, (current) => {
      const patch: PrivacyPatch = { ...request };

      this.applyLeaderboardDependency(current, request, patch);
      const consentTransition = this.applyConsentTransition(current, request, patch);

      return {
        patch,
        // Written inside the same transaction as the change it records, so the two cannot
        // come apart — a consent change whose audit row was lost would leave a trail that
        // reads as complete while being wrong.
        audit: consentTransition
          ? { action: consentTransition, metadata: { at: new Date().toISOString() } }
          : null,
      };
    });

    if (!updated) {
      // findOrCreate guaranteed a row moments ago, so this means it vanished in between.
      // Failing beats returning a shape that would read as "all flags off".
      throw new NotFoundException('Privacy settings not found');
    }

    return updated;
  }

  /**
   * `locationForLeaderboard` is meaningless without `leaderboardOptIn`, and the two directions
   * are deliberately asymmetric:
   *
   * - Turning the parent **off cascades** the child off. Leaving it set would keep a stored
   *   "yes" to sharing location for a feature the user has left — which anything later
   *   reading the flag on its own would read as live consent.
   * - Turning the child **on without the parent is a 400**, not a silent coercion. Quietly
   *   dropping the field would hide a client bug behind a successful response, on a location
   *   setting the user believes they just enabled.
   */
  private applyLeaderboardDependency(
    current: PrivacySettings,
    request: UpdatePrivacyRequest,
    patch: PrivacyPatch,
  ): void {
    const leaderboardAfter = request.leaderboardOptIn ?? current.leaderboardOptIn;

    if (request.locationForLeaderboard === true && !leaderboardAfter) {
      throw new BadRequestException(
        'locationForLeaderboard requires leaderboardOptIn to be enabled',
      );
    }

    // Only when the parent actually goes off, and only if the child is not already off —
    // so an unrelated PATCH does not write a column it has nothing to say about.
    if (request.leaderboardOptIn === false && current.locationForLeaderboard) {
      patch.locationForLeaderboard = false;
    }
  }

  /**
   * Stamps or clears `aiFeaturesConsentAt` and reports the audit action to record, but only
   * on a **real transition**.
   *
   * The design's Save button re-sends every toggle on each tap. Writing on every request
   * would therefore manufacture a fresh consent record each time a user opened the screen and
   * saved — destroying the actual date consent was given, and filling the audit log with
   * events that describe nothing happening. An audit trail that records non-events is worse
   * than none, because it looks authoritative.
   *
   * @returns the audit action, or null when nothing changed.
   */
  private applyConsentTransition(
    current: PrivacySettings,
    request: UpdatePrivacyRequest,
    patch: PrivacyPatch,
  ): string | null {
    if (request.aiFeaturesConsent === undefined) {
      return null;
    }

    if (request.aiFeaturesConsent === current.aiFeaturesConsent) {
      return null;
    }

    if (request.aiFeaturesConsent) {
      patch.aiFeaturesConsentAt = new Date();
      return 'privacy.ai_consent_granted';
    }

    patch.aiFeaturesConsentAt = null;
    return 'privacy.ai_consent_withdrawn';
  }
}
