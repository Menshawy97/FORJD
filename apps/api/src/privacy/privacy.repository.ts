import { Inject, Injectable } from '@nestjs/common';
import { PrivacySettings } from '@forjd/domain';
import { eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { auditLogs } from '../database/schema/audit-logs.schema';
import {
  privacySettings,
  PrivacySettingsRow,
} from '../database/schema/privacy-settings.schema';

/**
 * What `updateLocked`'s caller decided to do with the locked row: the columns to write, and
 * the audit row to write alongside them in the same transaction, if the change is one that
 * warrants a record.
 */
export interface PrivacyDecision {
  patch: PrivacyPatch;
  audit: { action: string; metadata?: Record<string, unknown> } | null;
}

export interface PrivacyPatch {
  publicProfile?: boolean;
  leaderboardOptIn?: boolean;
  locationForLeaderboard?: boolean;
  aiFeaturesConsent?: boolean;
  aiFeaturesConsentAt?: Date | null;
  crashDiagnostics?: boolean;
}

/**
 * Storage for consent flags. Every rule *about* those flags — the leaderboard/location
 * dependency, the consent timestamp, the audit row — lives in PrivacyService, not here.
 * Splitting it that way keeps one statement of each rule and keeps this class trivially
 * substitutable in service tests.
 */
@Injectable()
export class PrivacyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Reads the row, creating an all-off one if it is missing.
   *
   * `upsertFromIdentity` already creates the row at registration, so the create half should
   * never fire in practice. It exists because the alternative failure is bad out of all
   * proportion to the cost of preventing it: an account whose row went missing — created
   * before this table existed, or lost to a partial failure — would otherwise get a 500 on
   * the settings screen, i.e. be unable to reach the controls for its own consent.
   *
   * `onConflictDoNothing` plus a re-read handles the concurrent first request, where two
   * inserts race and one must lose without raising.
   */
  async findOrCreate(userId: string): Promise<PrivacySettings> {
    const existing = await this.find(userId);
    if (existing) {
      return existing;
    }

    await this.db.insert(privacySettings).values({ userId }).onConflictDoNothing();

    const created = await this.find(userId);
    if (!created) {
      throw new Error('Failed to create privacy settings');
    }

    return created;
  }

  async find(userId: string): Promise<PrivacySettings | null> {
    const [row] = await this.db
      .select()
      .from(privacySettings)
      .where(eq(privacySettings.userId, userId))
      .limit(1);

    return row ? this.toPrivacySettings(row) : null;
  }

  /**
   * Reads the row **under a write lock**, lets the caller decide what to change, then writes
   * the patch and any audit row in the same transaction.
   *
   * The lock is the point. Consent rules are all statements about a *transition*, so they
   * have to be evaluated against the row as it is at write time — not against a snapshot read
   * earlier in the request. Without `FOR UPDATE`, two overlapping requests both read the old
   * row, both conclude their change is legal, and the second write lands on a state its
   * decision was never checked against: one turning `leaderboardOptIn` off while another
   * turns `locationForLeaderboard` on ends with location sharing enabled for a leaderboard
   * the user has left. That is not an adversarial-timing edge case — the design's Save button
   * re-sends every toggle on each tap, so overlapping PATCHes are the ordinary case.
   *
   * The audit row is written here rather than by the caller afterwards so that the consent
   * change and its record either both land or both roll back. An audit trail that can lose
   * the event for a change that did happen is worse than none, because it reads as complete.
   *
   * `decide` runs inside an open transaction holding a row lock, so anything slow inside it
   * holds that lock. It is expected to be pure computation over the row it is given.
   */
  async updateLocked(
    userId: string,
    decide: (current: PrivacySettings) => PrivacyDecision | Promise<PrivacyDecision>,
  ): Promise<PrivacySettings | null> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(privacySettings)
        .where(eq(privacySettings.userId, userId))
        .for('update')
        .limit(1);

      if (!locked) {
        return null;
      }

      const { patch, audit } = await decide(this.toPrivacySettings(locked));

      const [row] = await tx
        .update(privacySettings)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(privacySettings.userId, userId))
        .returning();

      if (!row) {
        return null;
      }

      if (audit) {
        await tx.insert(auditLogs).values({
          userId,
          action: audit.action,
          metadata: audit.metadata ?? null,
        });
      }

      return this.toPrivacySettings(row);
    });
  }

  /**
   * Applies a partial update, returning null when there is no row to update. Fields left
   * `undefined` are untouched — clearing `aiFeaturesConsentAt` requires an explicit null,
   * which is what distinguishes "withdraw consent" from "change something else".
   *
   * Unlocked, so it is only for changes that depend on nothing already in the row. Anything
   * conditional on current state must go through `updateLocked`.
   */
  async update(userId: string, patch: PrivacyPatch): Promise<PrivacySettings | null> {
    const [row] = await this.db
      .update(privacySettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(privacySettings.userId, userId))
      .returning();

    return row ? this.toPrivacySettings(row) : null;
  }

  private toPrivacySettings(row: PrivacySettingsRow): PrivacySettings {
    return {
      userId: row.userId,
      publicProfile: row.publicProfile,
      leaderboardOptIn: row.leaderboardOptIn,
      locationForLeaderboard: row.locationForLeaderboard,
      aiFeaturesConsent: row.aiFeaturesConsent,
      aiFeaturesConsentAt: row.aiFeaturesConsentAt,
      crashDiagnostics: row.crashDiagnostics,
    };
  }
}
