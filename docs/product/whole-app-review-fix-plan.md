# Phase 8.5D — Fix plan for the 2026-09-25 whole-app review

**Status:** triage done 2026-09-25 (8.5C). Slices run in the order below, one PR each, test-first,
merged with `main` green (post-merge CI confirmed), in a dedicated git worktree so concurrent sessions
are not disturbed.

Findings: [2026-09-25-whole-app-review.md](../reviews/2026-09-25-whole-app-review.md).
Plan: [whole-app-review-plan.md](whole-app-review-plan.md).

## Triage decisions (the user, 2026-09-25)

| Question | Decision |
|---|---|
| Which findings to fix | **Everything**: slices S1-S13 |
| Move the API from `us-central1` to Europe | **Yes** (free) |
| Cold start (14.6 s) | **Free speed-up only**: `--cpu-boost`; no `--min-instances` (paid, breaks the free-tier rule) |
| Minimum suggested calories | **1,200 kcal/day women, 1,500 kcal/day men** |
| Minimum when sex is unknown | **1,350 kcal/day** (the midpoint, matching how Mifflin-St Jeor's unknown-sex case already works) |

Citation for the calorie minimum, **approved by the user 2026-09-25**:
Harvard Health Publishing, "Calorie counting made easy" (updated 2024-04-03): calorie intake "should
not fall below 1,200 a day in women or 1,500 a day in men", except under a health professional's
supervision. <https://www.health.harvard.edu/staying-healthy/calorie-counting-made-easy>

## Rules for every slice

- A failing test that shows the finding first, then the fix (the user's standing TDD rule).
- Typecheck, lint and the affected suites pass locally; a code-review agent reviews the diff before
  the PR; `main` CI confirmed green after the merge.
- No new UI unless it is already designed. Where a fix would need a new screen or message, the slice
  stops and the user is shown a replica first.
- Contract changes are additive only (rule 7).

## Slices, in order

### S1 — Sign-out and account scoping (blocker L3-1, L5-2, known gaps)
- **Local SQLite:** add a nullable `user_id` column to `session_queue` (and the crash-recovery
  snapshot and event rows) via the store's existing migration mechanism in
  `apps/mobile/src/store/workout-session.ts` (and the run-session migration that shares the table).
- **Who is the user offline?** The Supabase `sub` claim decoded from the stored access token
  (`apps/mobile/src/auth/secureStorage.ts`), no network needed. A small `currentAccountId()` helper,
  unit-tested.
- **Enqueue** stamps the row with that id. **Drain** (`workouts/sync-sessions.ts`) uploads only rows
  whose `user_id` matches the signed-in account; other accounts' rows stay queued until that account
  signs back in (no data loss for the first person). Legacy rows with no `user_id` are claimed by the
  first account that drains them after the migration (today's behaviour, existing dev installs only).
- **Crash recovery** offers only a snapshot stamped with the current account.
- **Sign-out** (`clearSession`, manual and expired) also clears the per-account AsyncStorage keys:
  recent exercises, notification preferences, exercise unit preferences (L5-2).
- **Late `getMe`** (known gap): discard a `getMe` result that resolves after sign-out.
- Tests: queue drain with rows from two accounts; sign-out clears the named keys; recovery ignores
  another account's snapshot; migration adds the column to an existing database.

### S2 — Newest-first health reads (L4-2, L9a-4)
- `apps/api/src/health-data/health-data.repository.ts` `getObservationsForUser`: select the newest
  `limit` rows (`ORDER BY start_time DESC LIMIT n`), return them in ascending order, so every caller
  keeps its chronological input.
- Tests: more rows than the limit → the newest are returned, in ascending order; the macro suggestion
  picks the newest weight; the series endpoint returns the most recent points.

### S3 — Nutrition correctness and speed (L4-1, L9a-5, L4-3, L6-1)
- **Double log (L4-1):** an in-flight guard on `food/[id].tsx`'s primary button (the
  `saved-meals.tsx` pattern), plus an optional client-generated `id` on `logFoodRequestSchema`
  (additive) with `onConflictDoNothing` in `NutritionRepository.logEntry`.
- **Refetching foods (L9a-5):** pass the current foods map (via a ref) instead of `{}` at
  `nutrition.tsx:156`, so a revisit fetches only foods it has not seen.
- **Saved meal log (L4-3):** one `inArray` read for all items.
- **Calorie floor (L6-1):** `suggestDailyTargets` clamps to 1,200 (female) / 1,500 (male) / 1,350
  (sex unknown). Constants named and cited in `packages/domain/src/nutrition-targets.ts`; macros derived
  after the clamp; the spec's `tiny` case updated; the FAQ/citation list gains the Harvard Health source.

### S4 — Export completeness (L3-2, L11-8)
- A repository read of `workout_run_summaries` / `workout_run_splits` per session; an additive `run`
  field on the session response used by the export (and available to session detail).
- Tests: an uploaded run appears in `GET /users/me/export` with distance, splits and (with consent)
  heart rate and calories. `data-inventory.md`: drop "(planned)".

### S5 — App speed (L9b-1..5)
- Progress: one `Promise.allSettled` for its four loads.
- Train: `Promise.all` for the previous-workout exercise lookups; programs load on focus.
- `getMe`: one shared in-memory cache with in-flight de-duplication, invalidated on profile writes and
  sign-out.
- Tab refetch: skip a focus refetch within a short minimum interval (15 s) of the last successful load.
- Tests for each (ordering, call counts).

### S6 — Leaderboard and history reads (L9a-2, L9a-3, L9a-6, L9a-8, advisors)
- A short-lived in-process cache of a computed board keyed by (city, metric, period), shared by the
  leaderboard read and the profile's `standingFor`.
- `all_time`: bounded by the same cache (design detail decided in the slice, documented in its PR).
- Bound the whole-history streak / "ready to progress" / first-session scans.
- Snapshot job: bounded concurrency across cities.
- Migration (drizzle-kit, rule 14): indexes for the 4 unindexed foreign keys; a primary key on
  `exercise_favourites`.

### S7 — Server location and cold start
- Add a `GCP_RUN_REGION` repository variable (**europe-west1**, Belgium, a Tier 1 price region, nearest
  Tier 1 region to Supabase's `eu-west-1`), used only by `gcloud run deploy`; images stay in the existing
  `us-central1` Artifact Registry repository (no new registry needed). Add `--cpu-boost`.
- Staging first: deploy, measure warm and cold latency against the numbers above, then update the
  staging URL in `apps/mobile/eas.json` and the fallback in `apps/web/src/components/WaitlistForm.astro`.
- Production next. **User steps** (only the user can do them): update the website's
  `PUBLIC_API_URL` in Cloudflare Pages to the new production URL, then delete the old `us-central1`
  services. Written as numbered steps when reached.
- An ADR recording the region decision and the free-tier reasoning for `--cpu-boost` without
  `--min-instances`.

### S8 — Accessibility (L8-1..4)
- Rank chip → `accentDark`; segmented control and share button hit areas ≥ 44; `lineHeight` derived
  from `fontSize` (or `maxFontSizeMultiplier` on tight numeric displays); check `label`/`dimmer`
  contrast and fix where below 4.5:1. Token tests extended.

### S9 — InBody reliability (L7-1..3)
- A total time budget (45 s) with a short backoff between attempts; a generic error message to the
  client; golden fixtures for the InBody 770 Score misread and an FFMI sheet (synthetic values).

### S10 — Health Connect (L5-1, L1-1)
- Build the run reader from the metrics actually granted; lazy-load the library like the sibling
  adapters. Physical Android test still owed (rule 16); recorded, not claimed.

### S11 — Web and CI hardening (L12-1..3, L2-2, L2-3)
- Pin actions by SHA in the deploy and snapshot workflows; `apps/web/public/_headers` with CSP, HSTS,
  `X-Frame-Options`, `Permissions-Policy`; `npx expo install --fix` (patch updates) with an export check;
  confirm WHOOP OAuth `state` is cleared after use; document the reset-email throttle decision.

### S12 — Tests (L10-1)
- Remove the wall-clock assertion from the leaderboard scoring spec.

### S13 — Docs (L11-1..8)
- README, `analytics.md`, `domain-model.md`, website plan status, CLAUDE.md wording and CI-check list,
  an ADR-035 amendment for the 2026-09-22 decision.

## Exit (8.5E)

Re-run lanes 1-3 and 9a/9b on the new `main`; update the roadmap and any architecture doc or ADR the
fixes changed.
