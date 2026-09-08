import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "./users.schema";

/**
 * External OAuth connection state (Phase 7, WHOOP). One row per (user, provider), matching
 * `docs/architecture/integrations.md:57-59`'s `ExternalConnection` shape: `user_id, provider,
 * status, external_user_id, encrypted_access_token, encrypted_refresh_token, expires_at,
 * scopes, last_sync_at`.
 *
 * Deliberately a separate table from `health_connections` (Phase 6): that table has no room
 * for tokens and holds on-device providers (Health Connect, Apple Health) that never have an
 * OAuth flow to store state for. Growing token columns onto `health_connections` would leave
 * every on-device row with permanently-null token fields -- see `docs/product/phase-7-plan.md`,
 * decision 3.
 *
 * `provider` and `status` are `text`, never a Postgres enum, matching every other
 * closed-vocabulary column in this schema directory: narrowing `@forjd/domain`'s
 * `EXTERNAL_CONNECTION_PROVIDERS` / `EXTERNAL_CONNECTION_STATUSES` tuples is a domain-package
 * edit, `ALTER TYPE` cannot even remove a value.
 *
 * Token columns hold ciphertext from `token-cipher.ts` (ADR-036), never plaintext --
 * `token_key_version` records which configured key can decrypt them, so a future key
 * rotation is additive rather than a data migration.
 *
 * `oauth_state` / `oauth_state_expires_at` bridge the gap between issuing the authorize
 * redirect (`POST .../authorize`, Phase 7F) and the callback landing (`GET .../callback`) --
 * CSRF protection per WHOOP's own OAuth docs, bound to this row rather than a separate table
 * since only one pending authorization can exist per (user, provider) at a time, the same
 * cardinality the unique index below already enforces.
 *
 * RLS is not enabled, matching every other table in this schema directory -- no client holds
 * a Supabase credential (ADR-008), so the standing gating rule that triggers enabling it is
 * not tripped. Authorization lives in the NestJS service layer, per rule 12.
 */
export const externalConnections = pgTable(
  "external_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One of EXTERNAL_CONNECTION_PROVIDERS in @forjd/domain, e.g. "whoop". */
    provider: text("provider").notNull(),
    /** One of EXTERNAL_CONNECTION_STATUSES in @forjd/domain -- see that file's docblock for
     *  the full lifecycle each value means. */
    status: text("status").notNull(),
    /** The id the provider itself assigns to this user (e.g. WHOOP's numeric user id, as a
     *  string). Null until the OAuth callback completes and the provider's own identity is
     *  known -- deliberately not a foreign key anything in this schema depends on, the same
     *  shape `users.supabase_user_id` already sets (ADR-008). */
    externalUserId: text("external_user_id"),
    /** AES-256-GCM ciphertext from token-cipher.ts, never a plaintext token. */
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    /** Which entry in token-cipher.provider.ts's key map can decrypt the two columns above. */
    tokenKeyVersion: integer("token_key_version").notNull(),
    /** When the access token itself expires, per the provider's `expires_in`. Null until the
     *  first successful token exchange. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Space-separated OAuth scopes actually granted, verbatim from the token response --
     *  what requestPermissions() reports back, not what was merely requested. */
    scopes: text("scopes"),
    /** Null until the first successful sync completes -- the checkpoint WhoopProvider.sync()
     *  reads from and advances, same role as health_connections.last_successful_sync_at. */
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /** CSRF state bound to this user for the in-flight authorize redirect. Null once no
     *  authorization is pending (cleared on a successful or failed callback). */
    oauthState: text("oauth_state"),
    oauthStateExpiresAt: timestamp("oauth_state_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One connection per user per provider -- reconnecting the same provider updates this
     *  row (via upsert) rather than creating a second, dangling connection state. Mirrors
     *  health_connections_user_source_unique. Also serves as the lookup index for the lazy-
     *  refresh check on every outbound WHOOP call (phase-7-plan.md decision C) -- a unique
     *  btree index answers an equality lookup on its own leading columns just as well as a
     *  separate plain index would, so no second index is needed here. */
    uniqueIndex("external_connections_user_provider_unique").on(table.userId, table.provider),
  ],
);

export type ExternalConnectionRow = typeof externalConnections.$inferSelect;
export type NewExternalConnectionRow = typeof externalConnections.$inferInsert;
