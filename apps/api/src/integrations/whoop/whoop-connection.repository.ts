import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { ExternalConnectionStatus } from "@forjd/domain";

import { Database, DRIZZLE } from "../../database/database.module";
import { externalConnections } from "../../database/schema/external-connections.schema";

const PROVIDER = "whoop" as const;

export interface WhoopConnectionRow {
  id: string;
  userId: string;
  status: string;
  externalUserId: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenKeyVersion: number;
  expiresAt: Date | null;
  scopes: string | null;
  lastSyncAt: Date | null;
}

export interface UpsertWhoopTokensInput {
  status: ExternalConnectionStatus;
  externalUserId: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenKeyVersion: number;
  expiresAt: Date | null;
  scopes: string | null;
}

/**
 * Every method is scoped to `provider = "whoop"` -- this repository is WHOOP-specific by
 * design (it lives under `integrations/whoop/`, not `database/`), matching
 * `docs/product/phase-7-plan.md`'s decision that `external_connections` is a shared table
 * shape but each provider integration owns its own repository against it, the same way
 * `HealthDataRepository` (a different table) is not shared across health providers either.
 */
@Injectable()
export class WhoopConnectionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByUserId(userId: string): Promise<WhoopConnectionRow | null> {
    const [row] = await this.db
      .select()
      .from(externalConnections)
      .where(and(eq(externalConnections.userId, userId), eq(externalConnections.provider, PROVIDER)));

    return row ?? null;
  }

  /**
   * Upserts on `(user_id, provider)` -- the same unique index `external-connections.schema.ts`
   * defines specifically so reconnecting a provider updates the existing row rather than
   * creating a second, dangling one.
   */
  async upsertTokens(userId: string, input: UpsertWhoopTokensInput): Promise<void> {
    await this.db
      .insert(externalConnections)
      .values({ userId, provider: PROVIDER, ...input })
      .onConflictDoUpdate({
        target: [externalConnections.userId, externalConnections.provider],
        set: { ...input, updatedAt: new Date() },
      });
  }

  async updateLastSyncAt(userId: string, at: Date): Promise<void> {
    await this.db
      .update(externalConnections)
      .set({ lastSyncAt: at, updatedAt: new Date() })
      .where(and(eq(externalConnections.userId, userId), eq(externalConnections.provider, PROVIDER)));
  }

  async updateStatus(userId: string, status: ExternalConnectionStatus): Promise<void> {
    await this.db
      .update(externalConnections)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(externalConnections.userId, userId), eq(externalConnections.provider, PROVIDER)));
  }
}
