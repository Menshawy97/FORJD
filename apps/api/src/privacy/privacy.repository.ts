import { Inject, Injectable } from '@nestjs/common';
import { PrivacySettings } from '@forjd/domain';
import { eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import {
  privacySettings,
  PrivacySettingsRow,
} from '../database/schema/privacy-settings.schema';

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
   * Applies a partial update, returning null when there is no row to update. Fields left
   * `undefined` are untouched — clearing `aiFeaturesConsentAt` requires an explicit null,
   * which is what distinguishes "withdraw consent" from "change something else".
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
