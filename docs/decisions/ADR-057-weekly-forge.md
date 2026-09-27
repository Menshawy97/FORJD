# ADR-057: Weekly Forge — stored weekly evaluation of progression ladders

**Status:** Accepted (2026-09-27)
**Date:** 2026-09-27
**Extends:** ADR-047 (stored weekly snapshots are the one exception to computing on read).
**Related:** ADR-029, ADR-046, ADR-056, CLAUDE.md rules 9, 12, 15.
**Plan:** [weekly-forge-plan.md](../product/weekly-forge-plan.md)

## Context

Weekly Forge gives each athlete a level on five ladders: Consistency, Volume, Distance, Active
minutes and Nourish. The level sets that week's target. Each closed week moves the level up, holds
it, or eventually drops it. Bands run Ore → Ember → Anvil → Tempered → Forged.

Two properties make this unlike everything ADR-029 covers:

- **The result depends on history.** A level is the result of every earlier week, in order: misses
  in a row, a Forged hold, a +3 cap. It cannot be computed from one window of raw data on read.
- **A closed week must not move.** The user asked for three things: data edited after a week closes
  does not count toward it, the evaluation is idempotent, and it is safe to re-run.

## Decision

1. **Store the locked input and the result of each week.**
   - `forge_weeks` holds one row per user, ladder and week: the locked total, the target, the
     level and band before and after, the outcome, the streaks after, and `rules_version`.
   - `forge_user_ladders` holds the current state. It always equals `forge_weeks` folded in order,
     and a maintenance path can rebuild it from the stored totals at any time.
   - This keeps rule 9: nothing is hand-patched, and every derived value can be recomputed from
     stored inputs.
2. **The lock.**
   - A week's total counts only rows with `created_at ≤ closes_at`. A row deleted after
     `closes_at` still counts as present.
   - The total is then stored, so later edits never change a closed week.
   - There is **no grace period**, by the user's choice. A workout that reaches the server after
     the close does not count for that week.
   - Known gap: an in-place edit to an existing set, made between the close and the evaluation, can
     still leak in. The hourly cron keeps that window short, and it is accepted.
3. **Weeks and time zones.**
   - Weeks run Saturday to Friday (ADR-056) and close at Saturday 00:00 in the user's own time zone.
   - The phone sends its IANA zone, stored in the existing, unused `preferences.timezone`.
   - Until the phone sends one, the zone defaults to `Africa/Cairo`.
4. **When it runs.** Two triggers share one idempotent service:
   - **A GitHub Actions cron**, `forge-evaluate.yml`, hourly on Friday and Saturday UTC. That
     covers Saturday 00:00 in every zone from UTC-12 to UTC+14. As in ADR-047, it is a script
     rather than `@nestjs/schedule`, because Cloud Run scales to zero.
   - **Evaluate on read:** `GET /api/v1/forge` first evaluates any closed, unevaluated weeks for
     the caller. A slipped or disabled cron never delays anyone's result.

   The service only evaluates the week after `last_evaluated_week`, one transaction per week, with
   the state rows locked. A re-run finds nothing to do.
5. **Rules.** Pure functions in `packages/domain`, one run per ladder per week:
   - **Hit:** +1 level.
   - **Overshoot:** move to the highest level the total clears, capped at +3.
   - **Miss:** hold. The third miss in a row drops one level and resets the count.
     - A band entered in that same week is protected. A miss week never enters a band, so in
       practice drops can cross bands.
     - Level 1 is the floor.
   - **Forged:**
     - A climb cannot pass the top Tempered level until the athlete has ended 4 consecutive weeks
       inside Tempered.
     - Any miss while Forged drops the athlete to the top Tempered level and resets the hold.
     - Both the current and the best-ever Forged streaks are kept.
   - **Nourish** tops out at Anvil (6 days a week) and has no Forged tier.
6. **Tier values are configuration.** *Amended by [ADR-058](ADR-058-weekly-forge-fifteen-levels.md)
   (2026-09-27): 15 levels anchored to published sources replace the 12%-per-level table, and
   existing levels were recomputed from stored weeks rather than clamped.*
   - They live in `packages/domain/src/forge-tiers.ts`: hand-written for Ore, then 12% per level.
   - A `forge:seed` script upserts them into `forge_ladders` and `forge_tiers` on every deploy, as
     `programs:seed` does.
   - Changing a value changes future weeks only; stored weeks keep their recorded target.
   - If a ladder ever loses levels, an athlete above its new top is brought down to that top
     before their next week is evaluated. That is a deliberate refold, recorded by the week's
     `rules_version`, never a hand edit.
7. **Rewards are an append-only ledger.**
   - `forge_rewards` records user, ladder, type, level, band, week and timestamp.
   - Partial unique indexes make every insert idempotent (`on conflict do nothing`).
   - No code path updates or deletes a row, apart from the account-deletion cascade.
   - Reward types:
     - `forge_mark`: the first time a level is reached on a ladder.
     - `band_badge`: the first entry into a band on a ladder.
     - `forged`: every week the athlete enters Forged.
8. **No Forge ranking.** The user chose not to rank anyone by Forge.
   - Bands, badges and Forged status appear on the public athlete profile
     (`GET /api/v1/athletes/:userId`), only when that athlete's `public_profile` is on.
   - **Nourish is never public.** It appears only on the athlete's own profile, and it has no
     share card.
9. **Inputs are what the app already logs, from all logged workouts.** Workouts outside the live
   runner count too, because nothing is ranked. Only completed, non-deleted sessions count.
   - **Volume** includes warm-up sets, as the rest of the app does.
   - **Distance** comes from `workout_sets.distance_meters` on running sessions.
   - **Minutes** come from `duration_seconds`, capped at 2 hours a session
     (`ACTIVITY_SESSION_CAP_SECONDS`, ADR-046).
   - **Nourish** counts distinct `logged_date` days.
10. **Enrolment.**
    - An athlete starts at Ore 1 on every ladder the first time the `weekly_forge` flag is on for
      them.
    - Their first evaluated week is the week they enrolled.
    - There is no backfill from history.
11. **It ships dark.**
    - The existing, unread `feature_flags` table gains a reader, `GET /api/v1/feature-flags`, and a
      `weekly_forge` row that starts `false`.
    - With the flag off, `/forge` returns 404, the athlete profile omits the block, and the phone
      renders nothing new.

## Consequences

- **New tables:** six, all cascading on account deletion, and all listed in
  `docs/architecture/data-inventory.md` and in the account export.
- **Cron cost:** the Friday and Saturday hourly cron costs roughly 200-400 GitHub Actions minutes a
  month. The repository is private, with 2,000 free minutes. Evaluate on read means a cron outage
  costs nothing but freshness for athletes who do not open the app.
- **No grace:** an offline Friday workout synced after the close is lost for that week. Expect the
  occasional "it didn't count" question.
- **Rule changes:** a new rule changes future evaluations only. Re-evaluating the past under new
  rules is a deliberate refold keyed by `rules_version`, never an edit.
