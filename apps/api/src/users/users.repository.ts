import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Profile, Sex, UnitSystem, User } from '@forjd/domain';
import { eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { auditLogs } from '../database/schema/audit-logs.schema';
import { profiles, ProfileRow } from '../database/schema/profiles.schema';
import { users, UserRow } from '../database/schema/users.schema';

/** Postgres unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

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
   * profile on first sight. Idempotent for a repeated login by the same identity.
   *
   * The conflict target is deliberately `supabase_user_id`, not `email`. Keying on email
   * would mean a *different* auth identity presenting a known address silently takes over
   * the existing row — and every profile, goal and preference cascading from its id. That
   * becomes reachable as soon as account deletion frees an address for re-registration
   * (see docs/architecture/security.md), so an address already bound to another identity
   * is rejected rather than merged.
   */
  async upsertFromIdentity(externalId: string, email: string): Promise<User> {
    const existing = await this.findByExternalId(externalId);
    if (existing) {
      return existing;
    }

    const [claimedByAnother] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (claimedByAnother && claimedByAnother.supabaseUserId !== externalId) {
      throw new ConflictException('That email address belongs to a different account');
    }

    let row: UserRow | undefined;

    try {
      [row] = await this.db
        .insert(users)
        .values({ supabaseUserId: externalId, email })
        .onConflictDoUpdate({ target: users.supabaseUserId, set: { email } })
        .returning();
    } catch (error: unknown) {
      // A concurrent insert for a different identity can still win the email uniqueness
      // race between the check above and this statement. Fail loudly, never merge.
      if (isUniqueViolation(error)) {
        throw new ConflictException('That email address belongs to a different account');
      }

      throw error;
    }

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
