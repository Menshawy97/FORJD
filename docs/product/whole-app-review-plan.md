# Phase 8.5 — Whole-app review plan

**Status:** 8.5A (this plan) written 2026-09-25. 8.5B (the review) runs next in the same session.
Stops at 8.5C: nothing is fixed until the user has triaged the findings table.

**Pinned SHA:** `b1f006a502d93919a3ea8ff645461fc5626e084f` (`main`, 2026-09-25, after #263).
Every lane reviews this SHA and no other. A finding at a later SHA is out of scope and is noted
as such, not reported.

Parent: [roadmap.md § Phase 8.5](roadmap.md). Precedent: the 2026-09-10 audit
([2026-09-10-whole-repo-audit.md](../reviews/2026-09-10-whole-repo-audit.md)) and its remediation
(ADR-038, [audit-remediation-plan.md](audit-remediation-plan.md)).

## What changed from the roadmap outline

The user asked (2026-09-25) that **speed be a first-class part of the audit**: any point where the
app is slow, for example opening a screen or loading the user's data from the database. So the
roadmap's single lane 9 is split into two lanes with measurements, not only a code read:

- **9a. Server and database speed**
- **9b. App speed: screens, start-up and data loading**

That makes 13 lanes.

## Rules for every lane

1. **Read-only.** No lane edits code, config, migrations or data. Lanes return findings; the
   session writes them to `docs/reviews/2026-09-25-<lane>.md`.
2. **Evidence, not impressions.** Every finding has: the file and line (at the pinned SHA), a
   concrete failing scenario (inputs or state leading to a wrong result, a crash, a leak, or a
   measured delay), severity, and the CLAUDE.md rule or ADR it breaks (if any).
3. **Severity:**
   - **blocker:** data loss, a health-data leak, a security hole, or a crash on a main path.
   - **high:** a wrong result a user will see; a main screen measurably slow (see the speed
     budgets below); a rule broken in a way that matters.
   - **medium:** a real defect on a side path, or a maintainability problem likely to cause one.
   - **low:** polish.
4. **Already known is not new.** The roadmap's "Known engineering gaps" list is the baseline.
   A lane that hits one of them references it instead of reporting it again, and adds any detail
   the gap list lacks.
5. **Already fixed is not a finding.** Check the 2026-09-10 audit's item before re-reporting
   something similar; if the old fix regressed, say so and point to the fix.
6. **Health data stays put (rule 15).** Database measurements use the **dev** project
   (`forjd-dev`) only, and read query text and statistics, never row contents. The production
   project is read only for advisors (metadata).

## Speed budgets (what "slow" means for 9a and 9b)

Set here so findings are measurable and the fixes have a target:

| What | Budget | Why |
|---|---|---|
| A tab or screen shows its content on revisit | Instant (under 100 ms): cached data shown first, refreshed in the background | Revisiting a screen should never show a spinner |
| A screen's first visit shows content | Under 1 s on a good connection | Anything longer reads as "loading" |
| An API read endpoint, server time | p95 under 300 ms | Leaves room for the network |
| A database query on a main path | Under 50 ms, uses an index | The table sizes are small; more means a scan or a bad plan |
| Queries per API request | A small constant, never one per list item (N+1) | N+1 grows with the user's history |
| App cold start to first screen | Under 2 s on a mid-range Android phone | Measured on device later; the review looks for blocking work at start |
| A live workout or run screen update | Never waits on the network (rule 6) | Already a rule; speed is how it shows |

## Lanes

Each lane brief is what the reviewing agent gets, plus the rules above.

| # | Lane | Looks at |
|---|---|---|
| 1 | Architecture conformance | CLAUDE.md rules 1-17 beyond the grep check: domain purity, the `HealthProvider` / `AuthProvider` / `StorageProvider` abstractions, `integrations/` isolation, API versioning, recompute-not-patch (rule 9), source preservation (rule 10) |
| 2 | Security and authorization | NestJS guards on every route (rule 12), object-level access (one user reading another's rows), input validation, secrets, CORS, the waitlist and Turnstile, the WHOOP webhook, rate limits, token lifetime |
| 3 | Privacy and health data | rule 15 end to end; consent enforcement (ADR-043); deletion and export completeness against `data-inventory.md`; sign-out clean-up; logs and crash reports; location precision (ADR-048/049) |
| 4 | API correctness | services, repositories, migrations vs schema, transactions, idempotency, time zones and dates, jobs (leaderboard snapshot, aggregation), error paths |
| 5 | Mobile correctness | offline-first sessions and runs (rule 6), the queue and crash recovery, navigation and back paths, state after sign-out, units, loading and error states |
| 6 | Domain calculations | every formula against its citation (FAQ, `body-calculations.ts`, `nutrition-targets.ts`, `run-calculations.ts`, readiness, activity score); edge cases; rounding |
| 7 | InBody pipeline | prompt, parser, confidence thresholds, unit conversion, golden fixtures and eval coverage, the confirm and manual screens |
| 8 | Accessibility and UI | roles and labels, touch targets, contrast, font scaling, small screens, consistency with the approved designs |
| 9a | **Server and database speed** | see below |
| 9b | **App speed** | see below |
| 10 | Tests | coverage gaps, weak assertions, flaky patterns (leaking renders, unawaited promises), missing adapter contract tests (rule 8) |
| 11 | Docs and ADR consistency | `docs/architecture/*.md`, plan status lines and ADRs against the code; stale statements; decisions that exist only in code |
| 12 | Website and dependencies | `apps/web` (privacy copy, form, headers), dependency versions and advisories, the Expo SDK 57 pin (ADR-027), CI and deploy workflows |

### 9a. Server and database speed

**Code read**, for every `/api/v1` read endpoint the app calls on a main screen (Home, Train,
Progress, Rank, Nutrition, Profile, InBody, exercise library, programs):

- count the database round trips per request; flag N+1 loops and independent queries awaited one
  after another that could run together;
- check each query's `WHERE` / `ORDER BY` / `JOIN` columns against the indexes the migrations
  (`apps/api/drizzle/`) actually create;
- flag unbounded reads (no `LIMIT`, or a whole-history read where a window would do), `SELECT *`
  of wide rows, and large JSON payloads sent to the phone;
- check the aggregation and leaderboard jobs for full-table work on each run;
- check response compression and caching headers (the 2026-09-10 audit's H14 fix).

**Deploy topology:**

- The staging API runs on Cloud Run in `us-central1`
  (`apps/mobile/eas.json`), and both Supabase projects are in `eu-west-1`. Every query therefore
  crosses the Atlantic, and a screen needing several sequential queries pays that many times.
  Confirm the production region (`deploy-api.yml` uses `vars.GCP_REGION`) and measure the cost.
- Cloud Run cold start (min instances, start-up work in `bootstrap.ts`), and the database
  connection pool settings.

**Measurements** (dev database only, statistics not rows):

- Supabase performance advisors for `forjd-dev` and `forjd-prod` (unindexed foreign keys, unused
  indexes, RLS policies that re-evaluate per row).
- `pg_stat_statements` on `forjd-dev`: the top queries by mean and total time.
- `EXPLAIN` (no `ANALYZE` on anything that writes) for the heaviest main-path queries.
- `curl` timings of unauthenticated staging endpoints (health check) for network and cold-start
  cost.

### 9b. App speed: screens, start-up and data loading

For every screen in `apps/mobile/src/app/`, starting with the tabs:

- **What blocks first paint:** requests awaited one after another on mount (waterfalls) that could
  run together; a spinner shown on every visit because nothing is cached; data refetched on every
  focus with no cache (the app has no query-cache library, so check how each store caches).
- **Start-up:** work in the root `_layout.tsx` and the stores before the first screen shows:
  fonts, SQLite set-up and migrations, sync and queue drains, network calls blocking the splash.
- **Lists:** long lists (exercise library, food search, history, leaderboards) rendered with
  `ScrollView` + `map` instead of a virtualized list; missing keys; heavy rows.
- **Re-renders:** store subscriptions that re-render whole screens on any change; timers and GPS
  ticks re-rendering more than the part that changes (the 2026-09-10 audit's H15 fix, and the
  known "route rebuilt every second" gap).
- **Images and media:** exercise media size and caching (`expo-image` cache policy), avatars.
- **Local database:** SQLite queries on hot paths without an index, or run on every render.
- **Bundle:** production bundle size from `npx expo export --platform android` (measured against
  the pinned SHA), and the biggest contributors.

Measured result to include: the list of main screens with, for each, the requests made on first
visit and on revisit, whether they run in parallel, and whether cached data is shown first.

## Method (8.5B)

1. Run the 13 lanes as parallel read-only review agents (`forjd-code-reviewer`), each against the
   pinned SHA, each returning findings in the template below.
2. Write each lane's findings to `docs/reviews/2026-09-25-<lane>.md`.
3. **Verify every blocker and high** with a second, independent agent: reproduce it or trace the
   code path. A finding that is not confirmed is marked "unconfirmed" and is not fixed blind.
4. Merge duplicates across lanes (note which lanes found it: cross-corroboration raises
   confidence, as in the 2026-09-10 audit).
5. Write the combined table to `docs/reviews/2026-09-25-whole-app-review.md`, sorted by
   severity, with the roadmap's known gaps included, and a proposed disposition for each (fix now,
   schedule, close) for the user to decide in 8.5C.

## Findings template

```markdown
### <LANE>-<N> — <one-line claim>
- **Severity:** blocker | high | medium | low
- **Where:** `path/to/file.ts:123` (at b1f006a)
- **Scenario:** <inputs or state> → <wrong result, crash, leak, or measured delay>
- **Rule / ADR:** <CLAUDE.md rule N, ADR-0NN, or none>
- **Evidence:** <code path, measurement, or query plan>
- **Suggested fix:** <one or two lines; the fix slice decides the details>
- **Known gap?** <no | the roadmap gap it extends>
```

## After the review

- **8.5C Triage (the user):** one table; each finding marked fix now, schedule into a phase, or
  close with a reason.
- **8.5D Fix slices:** grouped by area, test-first (a failing test showing the finding, then the
  fix), one PR each, merged with `main` green, as ADR-038 did. Speed fixes carry a before and
  after measurement against the budgets above.
- **8.5E Close:** re-run lanes 1-3 and 9a/9b on the new `main`; update the roadmap, the
  architecture docs and any ADR the fixes changed.

**Exit criteria (from the roadmap, plus speed):** no open blocker or high finding; every medium
fixed or scheduled; lanes 1-3 re-run clean; every main screen within the speed budgets or with a
scheduled fix; the owed device tests done or explicitly carried into the beta with the user's
agreement.
