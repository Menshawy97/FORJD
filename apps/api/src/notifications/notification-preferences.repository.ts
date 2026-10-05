import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPreferences } from '@forjd/domain';
import { eq, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import {
  notificationPreferences,
  NotificationPreferencesRow,
} from '../database/schema/notification-preferences.schema';

export interface StoredNotificationPreferences {
  preferences: NotificationPreferences;
  /** `null` when the person has never saved a change. */
  updatedAt: Date | null;
}

export interface SavedNotificationPreferences {
  preferences: NotificationPreferences;
  updatedAt: Date;
}

const toPreferences = (row: NotificationPreferencesRow): NotificationPreferences => ({
  workout: row.workout,
  recovery: row.recovery,
  pr: row.pr,
  rank: row.rank,
  weekly: row.weekly,
});

/**
 * Storage for the notification switches. Which user is the caller's own id only; the service never
 * lets a request name another one (CLAUDE.md rule 12).
 */
@Injectable()
export class NotificationPreferencesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The defaults with a null timestamp when no row exists, so a never-saved account reads cleanly. */
  async get(userId: string): Promise<StoredNotificationPreferences> {
    const [row] = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    if (!row) return { preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES }, updatedAt: null };
    return { preferences: toPreferences(row), updatedAt: row.updatedAt };
  }

  /**
   * Creates the row (every switch not in `patch` at its default) or changes only the switches in
   * `patch`. One statement, so two phones changing different switches at once cannot undo each other.
   */
  async upsert(userId: string, patch: Partial<NotificationPreferences>): Promise<SavedNotificationPreferences> {
    const [row] = await this.db
      .insert(notificationPreferences)
      .values({ userId, ...patch })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...patch, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('notification_preferences upsert returned no row');
    return { preferences: toPreferences(row), updatedAt: row.updatedAt };
  }
}
