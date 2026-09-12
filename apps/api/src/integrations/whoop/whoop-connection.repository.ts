import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt } from "drizzle-orm";
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

  /** How an incoming webhook (Phase 7F), which carries only WHOOP's own numeric user id, is
   *  matched back to the internal user it belongs to. */
  async findByExternalUserId(externalUserId: string): Promise<WhoopConnectionRow | null> {
    const [row] = await this.db
      .select()
      .from(externalConnections)
      .where(and(eq(externalConnections.provider, PROVIDER), eq(externalConnections.externalUserId, externalUserId)))
      .limit(1);

    return row ?? null;
  }

  /**
   * Upserts on `(user_id, provider)` -- the same unique index `external-connections.schema.ts`
   * defines specifically so reconnecting a provider updates the existing row rather than
   * creating a second, dangling one.
   */
  async upsertTokens(userId: string, input: UpsertWhoopTokensInput): Promise<void> {
    // A completed token write ends whatever OAuth round trip was pending -- clearing the
    // state here (rather than leaving it to expire naturally) closes the window a captured
    // state value could otherwise still be replayed in, however briefly.
    await this.db
      .insert(externalConnections)
      .values({ userId, provider: PROVIDER, ...input, oauthState: null, oauthStateExpiresAt: null })
      .onConflictDoUpdate({
        target: [externalConnections.userId, externalConnections.provider],
        set: { ...input, oauthState: null, oauthStateExpiresAt: null, updatedAt: new Date() },
      });
  }

  /**
   * Bridges `POST /authorize` (Phase 7F) to `GET /callback`: the callback is a public,
   * unauthenticated route reached by the user's own browser redirect, so it cannot rely on
   * `JwtAuthGuard` to know which internal user is completing the flow -- `state` is the only
   * thing it has. `encryptedAccessToken: ""` is a placeholder, never real ciphertext, and is
   * never decrypted while `status` is `pending` (`WhoopProvider`'s own token-refresh path
   * only runs for a row with real tokens); `tokenKeyVersion: 0` is a sentinel no real key
   * version ever uses, for the same reason.
   */
  async setPendingState(userId: string, state: string, expiresAt: Date): Promise<void> {
    const pending = {
      status: "pending" as const,
      externalUserId: null,
      encryptedAccessToken: "",
      encryptedRefreshToken: null,
      tokenKeyVersion: 0,
      expiresAt: null,
      scopes: null,
    };

    await this.db
      .insert(externalConnections)
      .values({ userId, provider: PROVIDER, ...pending, oauthState: state, oauthStateExpiresAt: expiresAt })
      .onConflictDoUpdate({
        target: [externalConnections.userId, externalConnections.provider],
        set: { oauthState: state, oauthStateExpiresAt: expiresAt, updatedAt: new Date() },
      });
  }

  /** `null` for a state nobody issued, or one that has expired -- the callback cannot tell
   *  those two apart, and treats both identically as "reject this callback." */
  async findByOAuthState(state: string): Promise<WhoopConnectionRow | null> {
    const [row] = await this.db
      .select()
      .from(externalConnections)
      .where(
        and(
          eq(externalConnections.provider, PROVIDER),
          eq(externalConnections.oauthState, state),
          gt(externalConnections.oauthStateExpiresAt, new Date()),
        ),
      );

    return row ?? null;
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

  /**
   * Nulls the stored tokens and marks the connection disconnected -- the counterpart to
   * `revokeToken` on `WhoopClient`. Shared by `AccountDeletionService` (R3, C1) and
   * `WhoopProvider.disconnect()` (R5, H1): both used to (or, for deletion, would have)
   * left the encrypted tokens sitting in this row indefinitely.
   */
  async clearTokens(userId: string): Promise<void> {
    await this.db
      .update(externalConnections)
      .set({
        status: "disconnected",
        encryptedAccessToken: "",
        encryptedRefreshToken: null,
        expiresAt: null,
        scopes: null,
        updatedAt: new Date(),
      })
      .where(and(eq(externalConnections.userId, userId), eq(externalConnections.provider, PROVIDER)));
  }
}
