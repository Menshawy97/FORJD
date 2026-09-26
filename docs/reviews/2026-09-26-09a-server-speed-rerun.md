# Lane 9a — Server and database speed (8.5E re-run, 2026-09-26, at 445fcf0)

## Previous findings

| ID | Claim | Status | Evidence |
|---|---|---|---|
| L9a-1 | Progress loads four sections one after another | **Fixed (S5, #272)** | `app/(tabs)/progress.tsx:62` `Promise.allSettled` |
| L9a-2 | Profile view recomputes the whole city leaderboard | **Fixed (S6, #275)** | `leaderboards.service.ts:63-181` `cachedCityAthletes`: a board's totals computed at most once per 15 s and shared by `get` and `standingFor`; membership, names, photos and opt-in read live every request (`leaderboards.repository.ts:169-194`, ADR-054) |
| L9a-3 | `all_time` board aggregates full history every request | **Fixed by reuse (S6)** | Same cache, key `slug\|all_time`. The query itself still scans full history when it runs, as ADR-054 intends |
| L9a-4 | Health series without `since` returns the oldest rows | **Fixed (S2, #268)** | `health-data.repository.ts:117-150`: newest `limit` rows (`desc(startTime), desc(id)`), reversed to keep callers' oldest-first order |
| L9a-5 | Nutrition refetches every food and saved meal on every visit | **Partly fixed (S3, #269)** | Revisits reuse known foods (`app/nutrition.tsx:112-151`); saved-meal logging reads all items in one `inArray`. A first visit still makes one `GET /nutrition/foods/:id` per missing food (see 9a-2 below) |
| L9a-6 | Stats streak, ready-to-progress, first-session scan full history | **Fixed (S6, #277)** | `workout-sessions.repository.ts:389-462` (400-day window, `count(*)` total, rescan only when a streak reaches the boundary); `progress.repository.ts:486-562` bounded to the athlete's templates and read through the `(user, started_at)` index |
| L9a-7 | Cold start 14.6 s, no `--cpu-boost` | **Fixed as scoped (S7)** | `deploy-api.yml`: `europe-west1` and `--cpu-boost`; `--min-instances` deliberately absent (paid; free-tier rule) |
| L9a-8 | Snapshot job processes cities sequentially | **Fixed (S6, #277)** | `leaderboard-snapshot.service.ts:43-67`: 4 workers, failures isolated per city |
| Advisors | 4 unindexed foreign keys; no PK on `exercise_favourites` | **Fixed (S6, #278)** | Migration `0028` (drizzle-kit generated, rule 14): the four indexes and a composite PK |

## Measurements

`GET /api/v1/health` on staging (europe-west1), warm, 5 samples: 0.65, 0.32, 0.32, 0.46, 1.26 s (median ~0.46 s, best ~0.32 s), in line with S7's ~0.30 s. Cold start was not re-measured (would need forcing scale to zero).

## New findings

### 9a-1 — The 15 s city-board cache never evicts old keys
- **Severity:** low
- **Where:** `apps/api/src/leaderboards/leaderboards.service.ts:66,166-181` (at 445fcf0)
- **Scenario:** entries are keyed by city and window start and are only deleted when their own read fails. A month key changes every month, so each past month's entry for every viewed city stays in memory for the instance's lifetime. Growth is small (cities × months alive) and Cloud Run recycles instances, so it is unlikely to matter yet.
- **Rule / ADR:** none.
- **Suggested fix:** drop expired entries on each access (or cap the map to the most recently used keys).
- **Known gap?** no.

### 9a-2 — L9a-5's batch food read was not built
- **Severity:** low (the original was high; the cache and parallel reads remove most of it)
- **Where:** `apps/mobile/src/app/nutrition.tsx:112-118` (`Promise.all(missing.map(getFood))`); no batch route in `nutrition.controller.ts`.
- **Scenario:** a first visit, a cleared app, or many new foods still sends one request per distinct food id, in parallel.
- **Rule / ADR:** none.
- **Suggested fix:** schedule `GET /nutrition/foods?ids=…`, or record that L9a-5 was resolved as "cache, not batch".
- **Known gap?** extends L9a-5.

## Unconfirmed
- Cold start in europe-west1 (S7's 8.3 s) not re-measured.
- `pg` pool settings and whether `DATABASE_URL` uses the pooler port: unchanged since the first run, still unconfirmed.
- No `EXPLAIN` against real volumes (static review only).

## Checked and clean
Leaderboard cache specs cover reuse, recompute and "a failed read is not kept"; the snapshot job's shared counters cannot interleave (single-threaded, mutations between awaits); migration 0028 is generated, not hand-edited; the export's run-summary read is two queries for any number of sessions, both on indexed columns; no query added in `b1f006a..445fcf0` filters or sorts on an unindexed column.
