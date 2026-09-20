# ADR-047: Leaderboard standings are computed on read; weekly snapshots are the only stored copy

**Status:** Accepted
**Date:** 2026-09-21

## Context

ADR-029 blesses computing analytics on read for one person's own data and explicitly leaves
leaderboards out, so the extension needs its own argument. A leaderboard is many people's data, it
changes privacy state without warning (someone withdraws), and the design shows movement ("up 3 this
week") that needs a past to compare with.

## Decision

1. **Standings are computed on read.** `LeaderboardsRepository.cityAthletes` aggregates one city over
   one window and `scoreCohort` ranks it. The query is bounded by the partial index
   `workout_sessions_city_started_idx` (migration 0020), and beta scale is a dozen testers. A stored
   standings table would be an aggregate that CLAUDE.md rule 9 forbids patching, so it would need a
   recompute job anyway: all the cost, on the hot path.
2. **Eligibility is decided inside the query, by joining the athlete's privacy settings live.** There
   is no cache. A withdrawal is therefore true on the very next request. A TTL cache was considered
   and rejected because it would hold user ids whose opt-in may have been withdrawn seconds ago: a
   privacy window, not just staleness. **Revisit** when a single city-month aggregate exceeds about
   200 ms at p95.
3. **Movement needs a past, so a weekly snapshot table stores it.** `leaderboard_rank_snapshots`
   (migration 0021) holds one row per athlete, city, metric, period and week, with rank, score and
   cohort size. It is derived data: a week is deleted and re-inserted in one transaction from a fresh
   computation, never updated (rule 9), which also makes the job safe to re-run. The job uses the same
   `rankCity` as the read, so a snapshot is exactly what the board would have shown.
4. **The delta is previous rank minus current rank** (positive means moved up), read from the snapshot
   labelled with the Monday of the current local week, falling back to the latest earlier one. It is
   `null` when there is nothing usable: none captured, older than two weeks, or (for a month) from a
   different month, because comparing September's rank with October's is not movement.
5. **A week is labelled with the coming local Monday.** The job runs Monday 00:20 UTC, which is still
   Sunday evening in the Americas and Monday afternoon in Oceania, so the run instant is moved half a
   day forward before its local date is read. Every city then labels the run with the Monday of the
   week that is starting, and a re-run a few hours later gets the same label.
6. **The schedule is a GitHub Actions cron, not `@nestjs/schedule`.** Cloud Run scales to zero, so an
   in-process timer would never fire, and with several instances it would fire once per instance.
   `.github/workflows/leaderboard-snapshot.yml` runs `pnpm --filter @forjd/api leaderboard:snapshot`
   on Monday 00:20 UTC against staging and production, and can be dispatched by hand. The database URL
   comes from Secret Manager, as in the deploy workflow.
7. **A public profile shows a rank only if the board does.** `LeaderboardsService.standingFor` is the
   same computation as `get`, so a profile never shows a rank for someone not on the leaderboard
   (Phase 10N).

## Consequences

- GitHub disables scheduled workflows after 60 days without repository activity, and its cron is
  best-effort. Both are accepted: a missed week means the arrow reads from the last snapshot that is
  still fresh enough, or shows nothing, and the leaderboard itself never depends on the job.
- A manual dispatch in the middle of a week replaces that week's baseline with mid-week standings, so
  it should be run on a Monday.
- At a month's start every month board is empty, so month movement is blank until the first weekly
  snapshot of the new month.
- Snapshot rows are deleted with the account (`on delete cascade`), so a deleted athlete leaves no
  rank history.
