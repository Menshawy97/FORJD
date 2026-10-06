import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_QUIET_HOURS,
  NotificationPreferences,
  QuietHours,
} from '@forjd/domain';
import { eq, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import {
  notificationPreferences,
  NotificationPreferencesRow,
} from '../database/schema/notification-preferences.schema';

export interface StoredNotificationPreferences {
  preferences: NotificationPreferences;
  quietHours: QuietHours;
  /** `null` when the person has never saved a change. */
  updatedAt: Date | null;
}

export interface SavedNotificationPreferences {
  preferences: NotificationPreferences;
  quietHours: QuietHours;
  updatedAt: Date;
}

/** Any subset of the switches, and the quiet hours whole (both times) or not at all. */
export type NotificationPreferencesPatch = Partial<NotificationPreferences> & {
  quietHours?: QuietHours;
};

const toQuietHours = (row: NotificationPreferencesRow): QuietHours => ({
  startMinute: row.quietStartMinute,
  endMinute: row.quietEndMinute,
});

const toPreferences = (row: NotificationPreferencesRow): NotificationPreferences => ({
  workout: row.workout,
  recovery: row.recovery,
  pr: row.pr,
  rank: row.rank,
  weekly: row.weekly,
  meals: row.meals,
  noWorkout: row.noWorkout,
  forgeClosing: row.forgeClosing,
  weighIn: row.weighIn,
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
    if (!row) {
      return {
        preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        quietHours: { ...DEFAULT_QUIET_HOURS },
        updatedAt: null,
      };
    }
    return {
      preferences: toPreferences(row),
      quietHours: toQuietHours(row),
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Creates the row (every switch and the quiet hours not in `patch` at their defaults) or changes only what is in
   * `patch`. One statement, so two phones changing different things at once cannot undo each other. The database
   * refuses quiet hours that are equal or off the clock (a check constraint), so a bad value never lands.
   */
  async upsert(
    userId: string,
    patch: NotificationPreferencesPatch,
  ): Promise<SavedNotificationPreferences> {
    const { quietHours, ...switches } = patch;
    const columns = {
      ...switches,
      ...(quietHours
        ? { quietStartMinute: quietHours.startMinute, quietEndMinute: quietHours.endMinute }
        : {}),
    };
    const [row] = await this.db
      .insert(notificationPreferences)
      .values({ userId, ...columns })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...columns, updatedAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error('notification_preferences upsert returned no row');
    return {
      preferences: toPreferences(row),
      quietHours: toQuietHours(row),
      updatedAt: row.updatedAt,
    };
  }
}
