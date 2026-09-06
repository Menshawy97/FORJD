# ADR-029: Progress-Strength analytics are computed on read, not by a scheduled rollup

**Status:** Accepted
**Date:** 2026-09-06

## Context

`docs/architecture/analytics.md` specifies a five-layer pipeline — Raw → Normalized →
Aggregated → Derived → Insight — and states plainly that "aggregation jobs are scheduled, not
computed on read". The Progress tab's Strength view (Phase 4) is the first real construction
of that pillar, and it needs several genuinely aggregate figures: an athlete's two most
recently achieved personal records, an 8-week estimated-1RM trend, a week of daily training
volume, a month's training calendar, and a muscle-group split.

Building these as scheduled rollups, as the architecture doc's default prescribes, would
require a job scheduler and a place to run it. Neither exists in the stack: there is no
BullMQ, no Redis-backed queue, and no cron-style runner in `apps/api`. `docker-compose.yml`'s
`forjd-redis` service is explicitly commented as "unused until Phase 5" — introducing a
scheduler now would mean standing up new infrastructure for one screen, ahead of the phase
that actually needs it, and would collide with the project's free-tier hosting constraint
(a memory attests the user has already declined a paid Redis instance and rejected assuming a
paid tier is acceptable without asking first).

There is also a direct precedent already in the codebase for the other approach:
`WorkoutSessionsService.stats` / `WorkoutsRepository.statsForUser` (Phase 3J-c) already
compute Home's stat-strip counters, "This week" and "Recent PR" on every request, with no
rollup table behind them, and that endpoint has shipped and been in production use since
2026-09-03 with no reported latency problem.

## Decision

`GET /workouts/sessions/progress/strength` computes every figure on read, inside
`ProgressRepository`, the same way `statsForUser` already does. No new table, no scheduled
job, no queue.

This does not violate CLAUDE.md rule 9 ("never directly mutate analytics aggregates... derived
from raw/normalized data by the aggregation jobs — recompute, don't patch"). Compute-on-read
is not a violation of that rule; it is the strictest possible way to honor it — every response
is recomputed from raw data on every request, so there is no stored aggregate that could ever
be hand-patched or drift from its source.

Each read is bounded and indexed: the query window is at most 8 weeks of one athlete's own
sessions, filtered by `workout_sessions_user_started_idx (user_id, started_at)`, which already
exists from Phase 3B. This is not a scan of the whole table, and it is not shared load across
many users' requests the way a leaderboard or a global feed would be.

## Consequences

- No new infrastructure for this phase: no Redis dependency, no scheduler, no new migration.
- Every figure is always current — there is no staleness window to reason about, and no
  "when did this last run" question for a support conversation.
- The read does more work per request than a rollup lookup would. Acceptable today because the
  window is small and per-athlete; not free at unbounded scale.

## Revisit trigger

Phase 6 (Health Connect) introduces per-minute health observations — heart rate, steps,
sleep stages — at a volume this approach was never sized for. When Progress's Health tab (or
any dashboard reading health observations) needs to aggregate across that volume, that is the
point to introduce the scheduled-rollup pattern `analytics.md` already specifies, most likely
alongside the BullMQ/Redis infrastructure Phase 5 (InBody) is expected to bring in anyway. The
Strength view's compute-on-read approach can stay as it is; it was never the bottleneck this
trigger is about.

## Related

- [`../architecture/analytics.md`](../architecture/analytics.md) — the five-layer pipeline this
  ADR carves out a documented, bounded exception to.
- [`../product/phase-4-plan.md`](../product/phase-4-plan.md) — the plan this ADR was written
  alongside.
- Phase 3J-c's `statsForUser` — the precedent this ADR generalises.
