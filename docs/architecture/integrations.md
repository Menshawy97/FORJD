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

## Native health platforms via the `health` package

Both HealthKit (iOS) and Health Connect (Android) are reached through the
[`health`](https://pub.dev/packages/health) Flutter package (maintained by
carp-dk), as the *implementation* behind `HealthProvider` — see ADR-007 and
`CLAUDE.md` rule 17. Feature code never imports the package directly; only
the adapter does.

```
Flutter → HealthRepository → health package → HealthKit / Health Connect
```

Two guardrails, because the package unifies HealthKit and Health Connect
behind one API:
- Every `HealthObservation` records its originating provider explicitly —
  never inferred from which platform API answered.
- If the package can't express something needed (e.g. WorkoutKit zone
  configuration), write a small targeted native bridge for just that gap,
  behind the unchanged `HealthProvider` interface. Don't let a gap become an
  excuse to bypass the interface elsewhere.

## WHOOP

Secrets never reach the mobile client:

```
Flutter → Your API → WHOOP OAuth
```

`ExternalConnection` table: `user_id, provider, status, external_user_id,
encrypted_access_token, encrypted_refresh_token, expires_at, scopes,
last_sync_at`. WHOOP uses OAuth 2.0 with an `offline` scope for refresh
tokens.

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
