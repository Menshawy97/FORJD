import { Inject, Injectable } from '@nestjs/common';
import { Profile, Sex, UnitSystem, User } from '@forjd/domain';
import { eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { auditLogs } from '../database/schema/audit-logs.schema';
import { profiles, ProfileRow } from '../database/schema/profiles.schema';
import { users, UserRow } from '../database/schema/users.schema';

export interface ProfilePatch {
  displayName?: string | null;
  dateOfBirth?: string | null;
  sex?: Sex | null;
  heightCm?: number | null;
  unitSystem?: UnitSystem;
  avatarUrl?: string | null;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByExternalId(externalId: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.supabaseUserId, externalId))
      .limit(1);

    return row ? this.toUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);

    return row ? this.toUser(row) : null;
  }

  /**
   * Links an external identity to an internal user, creating both the user and an empty
   * profile on first sight. Idempotent: a repeated login must not create a second user.
   */
  async upsertFromIdentity(externalId: string, email: string): Promise<User> {
    const existing = await this.findByExternalId(externalId);
    if (existing) {
      return existing;
    }

    const [row] = await this.db
      .insert(users)
      .values({ supabaseUserId: externalId, email })
      .onConflictDoUpdate({ target: users.email, set: { supabaseUserId: externalId } })
      .returning();

    if (!row) {
      throw new Error('Failed to persist user');
    }

    await this.db.insert(profiles).values({ userId: row.id }).onConflictDoNothing();

    return this.toUser(row);
  }

  async findProfile(userId: string): Promise<Profile | null> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);

    return row ? this.toProfile(row) : null;
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<Profile | null> {
    const [row] = await this.db
      .update(profiles)
      .set({
        ...patch,
        // numeric columns round-trip as strings through node-postgres.
        heightCm: patch.heightCm === undefined ? undefined : (patch.heightCm?.toString() ?? null),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId))
      .returning();

    return row ? this.toProfile(row) : null;
  }

  async recordAudit(
    userId: string | null,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(auditLogs).values({ userId, action, metadata: metadata ?? null });
  }

  private toUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toProfile(row: ProfileRow): Profile {
    return {
      userId: row.userId,
      displayName: row.displayName,
      dateOfBirth: row.dateOfBirth,
      sex: row.sex as Sex | null,
      heightCm: row.heightCm === null ? null : Number(row.heightCm),
      unitSystem: row.unitSystem as UnitSystem,
      avatarUrl: row.avatarUrl,
    };
  }
}
