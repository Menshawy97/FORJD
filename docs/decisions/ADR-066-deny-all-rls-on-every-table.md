# ADR-066: Row-level security on every table, deny-all

- **Status:** Accepted (2026-10-09)
- **Amends:** [ADR-038](./ADR-038-audit-remediation-pass-2026-09.md) (R29), [ADR-008](./ADR-008-auth-storage-provider-abstraction.md)

## Context

ADR-038 recorded that RLS was enabled on no table and called adding it "mostly theatre", because
`apps/api` connects to Postgres directly as the owning role. That is true of the API's own access
and missed the other door. Supabase exposes the `public` schema through its Data API (PostgREST),
and the anon key that opens it is public by design. Supabase's security advisor flagged
`rls_disabled_in_public` at ERROR level on **all 43 tables in forjd-prod** (40 in forjd-dev). On such
a table anyone holding the anon key can read and write rows -- including `health_observations`,
`body_scans`, `external_connections` and `device_push_tokens`. Nothing in the repo hands that key to
a client today, so this was exposure waiting for one leak or one future feature, not a live breach.

Checked against forjd-prod's role catalogue: the API connects as `postgres`, which owns all 43
tables and has `BYPASSRLS`; `anon` and `authenticated` own nothing and do not bypass.

## Decision

1. Migration `0037_enable-row-level-security` runs `ENABLE ROW LEVEL SECURITY` on every table, with
   **no policies**. `anon` and `authenticated` get nothing; the API's `postgres` role is unaffected.
   No `FORCE ROW LEVEL SECURITY`, so the owner keeps bypassing.
2. `scripts/ci/check-architecture-conformance.sh` fails the build if any table created by a
   migration lacks an `ENABLE ROW LEVEL SECURITY` statement in some migration, so new tables cannot
   ship exposed.
3. Authorization stays in the NestJS guards (rule 12). RLS here is the SQL backstop, not a rule
   engine. Real policies are written only if a client is ever given direct database access (for
   example Supabase Realtime), in a new ADR, with tests.

## Consequences

- The 40-vs-43 dev/prod gap came from dev tables being toggled by hand in Studio (rule 14 forbids
  that). The migration is idempotent, so dev converges.
- Supabase Storage is a separate surface (`storage.objects` policies) and is not changed here.
- Not covered, and separate: `pg_trgm` is installed in `public` (advisor WARN), and Supabase Auth's
  leaked-password protection is off (dashboard setting).
- The first prod deploy after merge runs the migration. Roll back with `DISABLE ROW LEVEL SECURITY`
  per table only if the API ever stops connecting as `postgres`.
