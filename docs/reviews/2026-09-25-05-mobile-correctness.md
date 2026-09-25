# Lane 5 — Mobile correctness (2026-09-25, at b1f006a)

### L5-1 — Denying only heart rate also discards granted watch calories
- **Severity:** medium · **Where:** `apps/mobile/src/features/run/run-health.ts:70-80`
- **Scenario:** the runner grants "Active energy burned" but declines "Heart rate"; `prepareRunHealth` returns `null` because `result.granted` lacks `heart_rate`, so the granted calories are never read and the run falls back to the estimate.
- **Suggested fix:** build the reader from the metrics actually granted; `null` only when neither is.
- **Known gap?** related to, but distinct from, "a revoked Health Connect permission reads as no watch".

### L5-2 — Recent exercises, notification and unit preferences survive sign-out into the next account
- **Severity:** medium (privacy) · **Where:** `apps/mobile/src/store/recent-exercises.ts:17-53`, `store/notification-preferences.ts:13`, `store/exercise-unit-preferences.ts:29`; sign-out `auth/secureStorage.ts:144-162` (`clearSession`) vs `store/local-data.ts:18-28` (`clearLocalUserData`, called only from `delete-account.tsx`); `app/(tabs)/profile.tsx:298-310` (`handleLogout`).
- **Scenario:** A signs out, B signs in on the same phone: the library's "Recent" shows A's exercises; A's preferences become B's.
- **Suggested fix:** run `clearLocalUserData()` (or a session-scoped subset) on sign-out too.
- **Known gap?** extends the roadmap's sign-out snapshot gap (same root cause, different keys).

## Unconfirmed (not findings)
- `live.tsx` Finish has no disabled state; a double tap likely only duplicates an idempotent write, but whether two `workout_finished` events can reach the payload was not traced.
- Body-scan weight always in kg (may be intentional).

## Checked and clean
Rule 6 for live session and run (SQLite only; network reads bounded by timeout); upload queue (4xx vs transient, atomic attempt counts, failed rows visible and retryable — old C3 fixed); run upload placeholder resolution and payload sanitising; crash recovery replay (tick/untick, pause), recovered run already queued is dropped, HR dropped if consent revoked; double-submit guards on finish run/workout, saved meal, delete account; `clearSession` clears health and location consent on every session end; units and local-day bucketing; effect cleanup and unmount guards.

## Not reached
Most of `(tabs)/*`, `features/progress|nutrition|targets|athlete|faq`, catalogue/media sync stores (grep only).
