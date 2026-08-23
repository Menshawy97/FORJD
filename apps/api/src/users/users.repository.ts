import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  ACTIVITIES,
  Activity,
  DISTANCE_UNITS,
  DistanceUnit,
  ENERGY_UNITS,
  EnergyUnit,
  Profile,
  Sex,
  TRAINING_GOALS,
  TrainingGoal,
  UnitSystem,
  User,
  WEIGHT_UNITS,
  WeightUnit,
} from '@forjd/domain';
import { eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { auditLogs } from '../database/schema/audit-logs.schema';
import { privacySettings } from '../database/schema/privacy-settings.schema';
import { profiles, ProfileRow } from '../database/schema/profiles.schema';
import { users, UserRow } from '../database/schema/users.schema';

/** Postgres unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * Keeps only the members a `text[]` column holds that are still in the closed set.
 *
 * The columns are `text[]` so the set can be narrowed without a migration — which is the
 * whole reason narrowing `sex` was free. The cost is that a stored value can outlive its own
 * valid set. Unfiltered, that value would reach the response and make the API's own output
 * fail the API's own schema; filtered, the worst outcome is that the chip renders deselected.
 */
function keepKnown<T extends string>(values: string[], known: readonly T[]): T[] {
  return values.filter((value): value is T => (known as readonly string[]).includes(value));
}

/**
 * Narrows a single-value `text` column, falling back when the stored value has left the set.
 * Same reasoning as `keepKnown`, but a scalar has no "drop it" option — a unit preference
 * must be *something*, so it degrades to the column default rather than to null.
 */
function keepKnownScalar<T extends string>(value: string, known: readonly T[], fallback: T): T {
  return (known as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * An already-validated patch. This type is the repository's input, not a wire shape.
 *
 * `citySlug` is never client-writable — there is no such field on
 * `updateProfileRequestSchema` — and this repository does not derive it either. That happens
 * once, in `UsersService.toPatch` (`slugifyCity`), which is the only place a `ProfilePatch`
 * carrying `citySlug` is constructed from a request; the repository just stores whatever it is
 * given, same as every other field.
 *
 * `trainingGoals` and `activities` are validated on write by `updateProfileRequestSchema`
 * (membership and a max length equal to the value set's own size). `toProfile` filters unknown
 * members on *read*, which is a graceful degradation for a narrowed value set — not an input
 * check, and not a substitute for the one on write.
 */
export interface ProfilePatch {
  displayName?: string | null;
  dateOfBirth?: string | null;
  sex?: Sex | null;
  heightCm?: number | null;
  unitSystem?: UnitSystem;
  weightUnit?: WeightUnit;
  distanceUnit?: DistanceUnit;
  energyUnit?: EnergyUnit;
  trainingGoals?: TrainingGoal[];
  activities?: Activity[];
  city?: string | null;
  citySlug?: string | null;
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
      // One transaction for all three rows. Registration must not be able to leave an
      // account that half exists — a user without a profile has no name, and a user without
      // a privacy row has no consent state, which is worse: nothing to read means nothing
      // that reliably reads as "has not consented".
      row = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(users)
          .values({ supabaseUserId: externalId, email })
          .onConflictDoUpdate({ target: users.supabaseUserId, set: { email } })
          .returning();

        if (!inserted) {
          throw new Error('Failed to persist user');
        }

        await tx.insert(profiles).values({ userId: inserted.id }).onConflictDoNothing();
        await tx.insert(privacySettings).values({ userId: inserted.id }).onConflictDoNothing();

        return inserted;
      });
    } catch (error: unknown) {
      // A concurrent insert for a different identity can still win the email uniqueness
      // race between the check above and this statement. Fail loudly, never merge.
      if (isUniqueViolation(error)) {
        throw new ConflictException('That email address belongs to a different account');
      }

      throw error;
    }

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
      weightUnit: keepKnownScalar(row.weightUnit, WEIGHT_UNITS, 'kg'),
      distanceUnit: keepKnownScalar(row.distanceUnit, DISTANCE_UNITS, 'km'),
      energyUnit: keepKnownScalar(row.energyUnit, ENERGY_UNITS, 'kcal'),
      trainingGoals: keepKnown(row.trainingGoals, TRAINING_GOALS),
      activities: keepKnown(row.activities, ACTIVITIES),
      city: row.city,
      citySlug: row.citySlug,
      avatarUrl: row.avatarUrl,
    };
  }
}
