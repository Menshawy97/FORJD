import { Inject, Injectable } from '@nestjs/common';
import type { PushPlatform } from '@forjd/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { devicePushTokens, DevicePushTokenRow } from '../database/schema/device-push-tokens.schema';

/** A person with this many phones keeps the most recently seen ones; the rest are dropped on the next registration. */
export const MAX_PUSH_TOKENS_PER_USER = 10;

/**
 * Storage for device push tokens (Phase 12F). Which user is the caller's own id only; the service never lets a
 * request name another one (CLAUDE.md rule 12).
 */
@Injectable()
export class PushTokensRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Stores the token for the person, or, if the token is already stored, moves it to them and marks it seen now (the
   * same phone signed in as someone else). Then keeps only their most recently seen tokens. One transaction that first
   * takes a lock on the person, so two registrations at once cannot both count the same rows and leave more than the cap.
   */
  async register(userId: string, token: string, platform: PushPlatform): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
      await tx
        .insert(devicePushTokens)
        .values({ userId, token, platform })
        .onConflictDoUpdate({
          target: devicePushTokens.token,
          set: { userId, platform, lastSeenAt: sql`now()` },
        });
      await tx.execute(sql`
        delete from device_push_tokens
        where user_id = ${userId}
          and id not in (
            select id from device_push_tokens
            where user_id = ${userId}
            order by last_seen_at desc, created_at desc, id
            limit ${MAX_PUSH_TOKENS_PER_USER}
          )
      `);
    });
  }

  /** Deletes the caller's own token; `false` when it was not theirs or not stored, which is not an error. */
  async remove(userId: string, token: string): Promise<boolean> {
    const deleted = await this.db
      .delete(devicePushTokens)
      .where(and(eq(devicePushTokens.userId, userId), eq(devicePushTokens.token, token)))
      .returning({ id: devicePushTokens.id });
    return deleted.length > 0;
  }

  /** Tokens the push service reported dead, whoever holds them (the sender, slice 3, calls this). */
  async deleteByTokens(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.delete(devicePushTokens).where(inArray(devicePushTokens.token, [...tokens]));
  }

  async listForUser(userId: string): Promise<DevicePushTokenRow[]> {
    return this.db
      .select()
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, userId))
      .orderBy(asc(devicePushTokens.createdAt), asc(devicePushTokens.id));
  }
}
