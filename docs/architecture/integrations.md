# Integrations

## HealthProvider — see ADR-003 for the full interface and rationale

```typescript
interface HealthProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<ProviderCapabilities>;
  requestPermissions(permissions: HealthPermission[]): Promise<PermissionResult>;
  sync(request: SyncRequest): Promise<SyncResult>;
}
```

Implementations, in build order (see `docs/product/roadmap.md`):
`HealthConnectProvider` (Phase 6) → `WhoopProvider` (Phase 7) →
`AppleHealthProvider` (Phase 11) → later, `GarminProvider`, `OuraProvider`,
`FitbitProvider` as demand justifies.

The workout engine and analytics never call a provider SDK directly
(`CLAUDE.md` rule 3). Request only the permission capabilities actually
needed — a capability-based model (`steps`, `heart_rate`, `sleep`, `weight`,
`workouts`, `calories`, `respiratory_rate`, ...), not an all-or-nothing grant.

## Native health platforms

Android Health Connect is reached through
[`react-native-health-connect`](https://github.com/matinzd/react-native-health-connect)
(ADR-034), as the *implementation* behind `HealthProvider` — see `CLAUDE.md` rule 17.
Feature code never imports the package directly; only
`apps/mobile/src/integrations/health/health-connect.provider.ts` (Phase 6F) does.

```
React Native screen → HealthProvider interface → HealthConnectProvider →
react-native-health-connect → Android Health Connect
```

Apple HealthKit (iOS) is a **separate system with a separate library**, decided in a
separate ADR when Phase 11 (the iOS track, ADR-007) starts — ADR-034 is Android-only and
does not presume that choice.

One guardrail carries over regardless of which provider library is behind it: every
`HealthObservation` records its originating provider explicitly — never inferred from
which platform API answered. If a library can't express something a future provider
needs, write a small targeted native bridge for just that gap, behind the unchanged
`HealthProvider` interface. Don't let a gap become an excuse to bypass the interface
elsewhere.

## WHOOP (Phase 7)

The integration runs entirely server-side; WHOOP's client secret and access/refresh
tokens never reach the mobile client (`CLAUDE.md` rule 5):

```
React Native (Expo) → Your API → WHOOP OAuth
```

`apps/api/src/integrations/whoop/` is the first occupant of the
`apps/api/src/integrations/<provider>/` directory (`CLAUDE.md` rule 4). `WhoopProvider`
implements `HealthProvider` exactly like `HealthConnectProvider` does — the phone only
ever calls the app's own `/integrations/whoop/*` routes, never WHOOP's API.

`external_connections` table (migration `0016`): `user_id, provider, status,
external_user_id, encrypted_access_token, encrypted_refresh_token, expires_at, scopes,
oauth_state, oauth_state_expires_at, token_key_version, last_sync_at`. This is separate
from `health_connections` (Phase 6), which stays for on-device providers that never hold
a server-side token. WHOOP uses OAuth 2.0 with an `offline` scope so it issues a refresh
token; the access token is refreshed lazily, immediately before an outbound call, guarded
by a row lock (`SELECT ... FOR UPDATE`) so two concurrent refreshes for the same user
can't invalidate each other's token.

Tokens are encrypted at rest with AES-256-GCM in application code (ADR-036), not Cloud
KMS. Webhook delivery is synchronous: WHOOP's own five-retries-over-an-hour schedule is
the retry mechanism, so there is no queue or worker for it (consistent with ADR-029 and
ADR-032's Cloud-Run-can't-host-a-worker reasoning). See ADR-037 for the full integration
shape and this phase's still-open items.

## Sync architecture

Never make the UI responsible for full synchronization on open:

```
App → Request sync → Backend/native integration → Incremental sync →
Queue → Process → Update database → Notify UI
```

Checkpointed via `last_successful_sync_at` and provider record IDs where
available.

## AuthProvider / StorageProvider

Same adapter pattern applied to Supabase itself — see `docs/architecture/system.md`
("Portability") and `CLAUDE.md` rules 11-14. `AuthProvider` resolves "who is
the current user" through an interface; the internal `users` table has its
own UUID, with `supabase_user_id` as one mapped external identifier, same
shape as `ExternalConnection.provider`. `StorageProvider` wraps InBody
uploads and other media (Supabase Storage is S3-compatible, so a future
swap to S3/R2 is a one-file adapter change).

Method signatures and the rule about where implementations may live are in ADR-008.

## ExerciseSourceAdapter

The same pattern again, applied to exercise content ingestion (Phase 2) —
see `docs/architecture/system.md` and ADR-005. External dataset schema and
muscle-group taxonomy normalize into the canonical `Exercise` model through
an adapter, not a direct passthrough.
