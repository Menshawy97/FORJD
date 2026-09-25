# Lane 9a — Server and database speed (2026-09-25, at b1f006a)

Measured: staging `GET /api/v1/health` (a `select 1`) from this PC — **cold 14.6 s**, warm 0.68-0.78 s (5 samples). Session measurements (advisors, `pg_stat_statements`) are in the combined report.

### L9a-1 — Progress loads four sections one after another
Same as L9b-1 (cross-corroborated by two lanes). ~4 round trips (~2.5-3 s) where ~1 would do.

### L9a-2 — Opening any athlete profile recomputes that athlete's whole city leaderboard
- **Severity:** high (as reported) · **Where:** `apps/api/src/athletes/athletes.service.ts:98-120` → `leaderboards.service.ts:123-133` (`standingFor` calls the full `get()`) → `leaderboards.repository.ts:71-131` (`cityAthletes`)
- **Scenario:** each profile view (e.g. tapping through Rank rows) aggregates every eligible session and set of every athlete in the city to keep one row. Uncached.
- **Suggested fix:** a single-athlete rank query, or a board cached/reused across the leaderboard and profile reads.

### L9a-3 — `all_time` leaderboard aggregates a city's entire history on every request
- **Severity:** high (as reported) · **Where:** `leaderboards.service.ts:85-86` (`window` null for `all_time`), `leaderboards.repository.ts:71-131`
- **Scenario:** cost grows without bound with the city's history; every Rank load on All time and every profile view pays it. Only the weekly delta is snapshotted.
- **Suggested fix:** precompute the all-time board in the weekly snapshot job, or bound the window.

### L9a-4 — Health series without `since` returns the OLDEST 2,000 readings
- **Severity:** high (as reported) · **Where:** `apps/api/src/health-data/health-data.repository.ts:117-129` (ascending + limit); Home calls `getHealthObservationSeries()` with no `since` (`apps/mobile/src/auth/apiClient.ts:668-671`); `health-data.service.ts:85-136`
- **Scenario:** after ~1-2 years of daily watch sync (> 2,000 rows across metrics), Home's health chart and Progress's Health tab show old data and never the recent readings, with no error.
- **Suggested fix:** order descending for "latest N" reads, or default `since` to a recent window.
- **Note:** same root cause as L4-2 (stale weight for targets).

### L9a-5 — Nutrition screen fetches every distinct food of the log AND every saved meal, one request each, on every focus
- **Severity:** high (as reported) · **Where:** `apps/mobile/src/app/nutrition.tsx:125-134,143-164`; no batch food endpoint in `apps/api/src/nutrition`
- **Scenario:** 15 saved meals × 3 items ≈ 45 authenticated cross-region requests on each visit/refocus.
- **Suggested fix:** `GET /nutrition/foods?ids=…` batch read; resolve saved-meal foods only when a meal is expanded.
- **Note:** lane 9b judged this acceptable (deduplicated, parallel); lane 9a counts the number of requests. To be settled in verification.

### L9a-6 — Stats streak, "ready to progress" and first-session reads scan a user's entire session history
- **Severity:** medium · **Where:** `apps/api/src/workouts/workout-sessions.repository.ts:340-349`, `progress.repository.ts:486-542`, `:545-562`
- **Suggested fix:** bound the scans (e.g. two years) or precompute on session write.

### L9a-7 — No `--min-instances` / `--cpu-boost`: 14.6 s measured cold start
- **Severity:** medium · **Where:** `.github/workflows/deploy-api.yml:162-198`
- **Suggested fix:** `--cpu-boost` (no idle cost); `--min-instances 1` for production is a paid option (free-tier constraint), for the user to decide.

### L9a-8 — Leaderboard snapshot job processes cities × periods sequentially
- **Severity:** medium · **Where:** `apps/api/src/leaderboards/leaderboard-snapshot.service.ts:41-77`
- **Suggested fix:** bounded concurrency (4-8), failures already isolated per city.

## Screen table (server side)
| Screen | HTTP calls | DB round trips | Shape | Estimate |
|---|---|---|---|---|
| Home | 6 | ~7 | parallel | ~1 round trip |
| Train | 5 | 5 | groups parallel; previous-workout chain of 2 | ~2 round trips |
| **Progress** | 4 | 10 | **4 sequential** | **~4 round trips (~2.5-3 s)** |
| Rank | 1 | 4 sequential internal | control-flow | 1 round trip; `all_time` unbounded |
| Nutrition | 3 + N foods | 3 + N | parallel, N unbounded | 1-2 round trips, N requests |
| Athlete profile | 1 | ~9 incl. a full leaderboard | mostly parallel | heaviest read in the app |
| InBody, library, programs, run history, profile | — | small, batched | — | clean |

## Checked and clean
H4 bound holds (only direction is new); H14 compression and catalogue ETag hold; library offline-first; body scan reads batched; FKs on hot joins indexed; month leaderboard uses `workout_sessions_city_started_idx`; progress strength sub-queries parallel; Home loader parallel; DB secrets from Secret Manager.

## Unconfirmed
`pg` pool defaults (max 10, no statement timeout); whether the API's `DATABASE_URL` uses the Supabase pooler (6543); no `EXPLAIN` against real volumes.
