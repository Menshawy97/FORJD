# Lane 3 — Privacy and health data (8.5E re-run, 2026-09-26, at 445fcf0)

## Previous findings

| ID | Finding | Status at 445fcf0 |
|---|---|---|
| **L3-1** (blocker) | Offline-queued workouts and runs upload under the next signed-in account | **Fixed (S1, #267).** `session_queue`, `session_snapshot` and `run_snapshot` carry a nullable `account_id` (`store/workout-session.ts:114-121`, `run-session.ts:101-124`); `getAccountId()` decodes the stored JWT's `sub` offline (`auth/secureStorage.ts:113-116`); drain, failed-session, retry and crash-recovery reads all filter through `belongsToAccount` (`store/account-scope.ts:9-12`). Another account's rows wait untouched. Legacy null rows are claimed by the signed-in account, as documented (existing dev installs only). |
| **L3-2** | Account export omits run distance, splits, heart rate, calories | **Fixed (S4, #270).** `account-export.service.ts:135-146` reads `findRunSummariesForSessions` over the caller's own session ids. Heart rate and calories are what was stored (already dropped at write time without consent, `workout-sessions.repository.ts:79-80`). `data-inventory.md` no longer says "(planned)". |
| **L3-3** | Sentry does not scrub health values from exception messages | **Open, scheduled at triage** (not in S1-S13). `sentry-scrub.ts` still strips only the user field (`data-inventory.md`). Carried in the roadmap's known gaps. |
| **L5-2** | Recent exercises, notification and unit preferences carry over to the next account | **Fixed (S1).** `store/account-preferences.ts` clears the three keys; `clearSession` (`secureStorage.ts:160-181`) calls it with the consent-copy clears, best-effort, never blocking sign-out. |
| Late `getMe` race (known gap) | A `getMe` resolving after sign-out rewrote consent copies | **Fixed (S1).** `app/(tabs)/index.tsx:117-144` writes consent copies only if the account is unchanged; the shared in-flight `getMe` is keyed by access token (`apiClient.ts:215-233`). |

## New findings

**None.** Nothing in `b1f006a..445fcf0` introduces a privacy or health-data issue:
- **S9:** only the vendor's error text is logged, never an extracted value or the image; no new logging under `body/**`.
- **S10:** the Health Connect flow is still gated by `readHealthConsent()` before `prepareRunHealth` (`use-run-session.ts:286-306`); the library import stays in `integrations/health/` (rule 17).
- **S6:** only totals are cached; `currentMembers` is read live and filters on opt-in and location sharing, so a withdrawal applies on the next request, including the profile's `standingFor`.
- **S4:** export runs are scoped to the caller's own ids.
- **S1:** the local SQLite migrations are additive and nullable.
- No new log call on a health-data path logs values; no analytics, ad or crash SDK added (only Expo patch bumps).
- `data-inventory.md` and `security.md` match the code.

## Unconfirmed
- `AuthenticatedGate` in `apps/mobile/src/app/_layout.tsx:223-238` runs its own date-of-birth `getMe` with a `cancelled` flag reset only on unmount. If the gate stays mounted across a sign-out and immediate sign-in (not confirmed), a late result from the old account could redirect the new one to the date-of-birth step. A UI gate, not health data, so not a privacy finding; a narrower case of the late-`getMe` pattern S1 fixed.
- Cohort-minimum and scoring math not re-checked (out of scope).

## Checked and clean
`getAllObservationsForExport` (`health-data.repository.ts:161-176`) is unaffected by S2's cap: export stays full and unbounded; rule 15 holds (no such SDK in the app); consent on run heart rate and calories traced end to end (consent gate → per-metric grant → server drop without consent); `_headers` adds `interest-cohort=()`.
