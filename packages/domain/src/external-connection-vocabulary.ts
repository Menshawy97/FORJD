/**
 * Canonical external-integration-connection vocabulary (Phase 7, WHOOP). Same `as const`
 * tuple + display-name map pattern as `health-vocabulary.ts` / `body-vocabulary.ts` --
 * `@forjd/contracts` builds `z.enum(...)` from these tuples, so drift between the domain and
 * the wire is unrepresentable.
 *
 * `EXTERNAL_CONNECTION_PROVIDERS` and `EXTERNAL_CONNECTION_STATUSES` back
 * `external_connections.provider` / `.status` -- `text` columns, never a Postgres enum, for
 * the same reason every other closed vocabulary in this package gives: a new OAuth
 * integration is then a tuple edit, not a migration.
 *
 * This file is pure TypeScript with no imports beyond this package, enforced by CI's
 * conformance check (CLAUDE.md rules 1-2).
 *
 * @see docs/product/phase-7-plan.md -- slice 7B.
 * @see docs/architecture/integrations.md -- the `ExternalConnection` shape this table
 *      implements: `user_id, provider, status, external_user_id, encrypted_access_token,
 *      encrypted_refresh_token, expires_at, scopes, last_sync_at`.
 */

/**
 * Deliberately just `whoop` today, not a speculative list of every provider
 * `integrations.md`'s build order eventually names (Garmin, Oura, Fitbit) -- YAGNI, same
 * reasoning `HEALTH_SOURCES`' own docblock gives. Apple Health (Phase 11) and Health Connect
 * are on-device providers with no OAuth connection to store here at all; this table is
 * specifically for cloud/API integrations that hand back a token.
 */
export const EXTERNAL_CONNECTION_PROVIDERS = ["whoop"] as const;
export type ExternalConnectionProvider = (typeof EXTERNAL_CONNECTION_PROVIDERS)[number];

export const EXTERNAL_CONNECTION_PROVIDER_DISPLAY_NAMES: Record<ExternalConnectionProvider, string> = {
  whoop: "WHOOP",
};

/**
 * The full lifecycle a stored OAuth connection moves through:
 * - `pending` -- the authorize redirect was issued but the callback has not landed yet
 *   (bridges the gap between `POST .../authorize` and `GET .../callback`).
 * - `connected` -- tokens are stored and (as far as this API knows) usable.
 * - `expired` -- the access token's `expires_at` has passed and a refresh attempt failed
 *   (the refresh token itself was rejected, not merely that no refresh has run yet -- a
 *   merely-stale-but-refreshable token stays `connected`, since `WhoopProvider.connect()`
 *   refreshes lazily rather than treating every expiry as a lifecycle transition).
 * - `revoked` -- the provider itself revoked access (observed via a failed API call after a
 *   refresh also failed, or a future WHOOP deauthorization webhook).
 * - `disconnected` -- the user disconnected from FORJD's own UI (Phase 7G's Connect screen).
 */
export const EXTERNAL_CONNECTION_STATUSES = ["pending", "connected", "expired", "revoked", "disconnected"] as const;
export type ExternalConnectionStatus = (typeof EXTERNAL_CONNECTION_STATUSES)[number];
