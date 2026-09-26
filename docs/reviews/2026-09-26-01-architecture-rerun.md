# Lane 1 — Architecture conformance (8.5E re-run, 2026-09-26, at 445fcf0)

## Previous findings

| ID | Claim | Status |
|---|---|---|
| L1-1 | `HealthConnectProvider` imported its native library eagerly; Android Expo Go could crash on import | **Fixed (S10, #284).** `apps/mobile/src/integrations/health/device-health-provider.ts:18-26` requires the adapter lazily, Android only, inside `try/catch`, returning `null` on failure, like `location-provider.ts` and `auth/google.ts`. |

## New findings

**None** at any severity. Every 8.5D commit (`b1f006a..445fcf0`, #267-#287) was traced against CLAUDE.md rules 1-17:
- **S1:** the sync queue is scoped by `getAccountId()` from the stored JWT's `sub` (`jwt-subject.ts`), no network (rule 6), labelled "not an authorization decision".
- **S2:** newest-first then reversed, same ascending contract (rule 7); source untouched (rule 10).
- **S3:** optional `id` on `logFoodRequestSchema` is additive (rule 7); a replayed id is accepted only when it is the same request by the same user.
- **S4:** `run` on `workoutSessionResponseSchema` is `.nullable().optional()` (rule 7); the run read is a two-query batch over the caller's own sessions.
- **S6:** the 15 s cache is a read-through cache of a computed value, not a patched aggregate (rule 9); membership is read live (ADR-054); migration 0028 is drizzle-kit generated (rule 14).
- **S7, S8, S12, S13:** deploy, UI, test and docs only.
- **S9:** stays inside the vision adapter and the fixtures.
- **S10:** `run-health.ts` still speaks only `HealthProvider` (rules 3, 17).
- **S11:** WHOOP state stays server-side (rule 5); the new pinning check and its harness run green.

`bash scripts/ci/check-architecture-conformance.sh`: all rules pass. Its fixture harness: 9/9.

## Unconfirmed
- The leaderboard cache is per Cloud Run instance, so two instances can disagree on totals for up to 15 s. Documented and accepted in ADR-054; not load-tested.
- S10 on a physical Android phone (rule 16): owed by the user's decision, recorded in the ADR-035 amendment; not a new gap.

## Checked and clean
Domain purity (rules 1-2; `nutrition-targets.ts` has no imports); provider abstraction (rules 3, 17); offline workouts (rule 6); additive contracts (rule 7); recompute-not-patch (rule 9); source preservation (rule 10, `caloriesSource` kept end to end); guards, not SQL-only authorization (rule 12); versioned migrations (rule 14); WHOOP secrets server-side (rule 5); no Supabase SDK, edge function or analytics SDK added.
