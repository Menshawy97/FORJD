# ADR-008: AuthProvider and StorageProvider abstraction over Supabase

**Status:** Accepted
**Date:** 2026-08

## Context

Supabase supplies three things FORJD depends on: authentication, Postgres, and object
storage. Postgres is already portable — Drizzle emits plain SQL and migrations run against
the local `postgres:16-alpine` container before they ever touch Supabase (ADR-002). Auth and
storage are not portable by default: both have vendor-shaped SDKs whose types leak into
whatever calls them.

ADR-003 established the provider-adapter pattern for `HealthProvider` and explicitly deferred
the auth and storage equivalents to Phase 1, leaving `docs/architecture/integrations.md` and
`docs/architecture/domain-model.md` carrying an "ADR pending" placeholder. This ADR closes
that gap.

The decision has a deadline built into it. Every endpoint written after this point either
goes through an interface or bakes in a Supabase call, and retrofitting the interface once
business logic already imports the SDK is the expensive version of this work.

## Decision

Two interfaces, each with exactly one implementation for now, and a hard rule about where
implementations may live.

`AuthProvider` (`apps/api/src/auth/providers/auth-provider.interface.ts`):

```typescript
interface AuthProvider {
  signUp(credentials: AuthCredentials): Promise<AuthResult>;
  signIn(credentials: AuthCredentials): Promise<AuthResult>;
  refreshSession(refreshToken: string): Promise<AuthSession>;
  signOut(accessToken: string): Promise<void>;
  verifyAccessToken(accessToken: string): Promise<AuthIdentity>;
}
```

`StorageProvider` (`apps/api/src/storage/providers/storage-provider.interface.ts`):

```typescript
interface StorageProvider {
  upload(request: UploadRequest): Promise<StorageObjectRef>;
  getSignedUrl(ref: StorageObjectRef, expiresInSeconds: number): Promise<string>;
  delete(ref: StorageObjectRef): Promise<void>;
}
```

Implementations may exist only under `apps/api/src/auth/providers/` and
`apps/api/src/storage/providers/`. `@supabase/supabase-js` may be imported nowhere else in
the repository, enforced by the CI conformance check rather than by convention.

### Identity mapping

The `users` table owns its own UUID primary key. `supabase_user_id` is a nullable, unique
mapped external identifier alongside it — deliberately the same shape as
`ExternalConnection.provider` for health integrations, not a foreign key the schema depends
on. The interface calls this field `AuthIdentity.externalId`, named for the role it plays
rather than the vendor that currently fills it.

Consequently no domain table references a Supabase identifier. Changing auth providers
rewrites one column's contents, not the schema.

### Storage addressing

`StorageObjectRef` is `{bucket, key}` — S3's addressing model, which Supabase Storage is
compatible with. Choosing S3's shape over Supabase's convenience helpers is what makes a
later swap to S3 or R2 a single new file.

## Rationale

- This is the same pattern as `HealthProvider` (ADR-003), applied to the vendor sitting
  underneath the whole application rather than at its edges. One pattern, learned once.
- Interfaces make authorization testable. `JwtAuthGuard` takes an `AuthProvider`, so guard
  behavior can be unit-tested against a mock instead of a live Supabase project — which is
  what `CLAUDE.md` rule 12 means by a rule you can actually test.
- Contract tests can run against recorded fixtures in CI, so the pipeline needs no Supabase
  credentials and no network.
- The portability argument is real but secondary. The immediate payoff is testability and a
  seam that keeps vendor types out of business logic.

## Consequences

- Two interfaces to keep honest. If a Supabase-specific capability is genuinely needed later,
  it goes on the interface as a capability check — the way `HealthProvider.getCapabilities()`
  handles the same problem — never as a cast back to the SDK type.
- `SupabaseStorageProvider` ships in Phase 1 with no caller; InBody upload in Phase 5 is its
  first consumer. Building it now is deliberate: it is written while the pattern is fresh and
  the alternative is writing it under Phase 5 deadline pressure.
- RLS still gets enabled on user-owned tables, but as defense-in-depth only. Authorization
  lives in NestJS guards (`CLAUDE.md` rule 12).
- Accepted once both adapters existed and the conformance check passed against real code.
  `SupabaseAuthProvider` and `SupabaseStorageProvider` are the only two files in the
  repository that import `@supabase/supabase-js`, verified by grep and enforced in CI.
- The interface earned its keep immediately. Registration against a project requiring email
  confirmation returns no session, which forced `signUp` to return `SignUpResult` with a
  nullable session rather than pretending one always exists — a distinction the vendor SDK
  buries in an optional field and callers routinely miss.
