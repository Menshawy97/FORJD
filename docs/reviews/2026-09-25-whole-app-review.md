# FORJD whole-app review — 2026-09-25 (Phase 8.5B)

Reviewed `main` at **`b1f006a`** with 13 read-only lanes ([plan](../product/whole-app-review-plan.md)).
Nothing was edited. Every blocker and high was checked by a second, independent agent; the verdict and
any severity change is recorded below. Per-lane detail is in `2026-09-25-<lane>.md` in this folder.

**Status: waiting for 8.5C triage by the user.** The "Proposed" column is a suggestion only; nothing
is fixed until the user decides.

## Summary

| | Blocker | High | Medium | Low |
|---|---|---|---|---|
| Verified | 1 | 7 | — | — |
| Reported (not needing verification) | — | — | 25 | 13 |

- **The one blocker:** a workout or run finished offline is uploaded as the **next person's** workout
  if the first person signs out before it syncs.
- **Security (lane 2) is clean:** all 74 API routes guarded or deliberately public; every user-owned
  read is scoped to the caller. Most 2026-09-10 fixes hold (C1, C2, C3, H3, H4, H8-H15 re-checked).
- **Speed:** the database itself is fast; the time goes to **network round trips across the Atlantic,
  a 14.6 s cold start, and screens that load things one after another or repeatedly**. See
  [Speed](#speed-what-makes-the-app-slow) below.

## Blocker and high findings (verified)

| ID | Finding | Verdict | Severity | Proposed |
|---|---|---|---|---|
| **L3-1** | Offline-queued workout/run uploads under the next signed-in account; the queue has no user id and sign-out never clears it (also forced sign-out) | Confirmed exactly; runs share the same queue | **Blocker** | Fix now (slice S1) |
| L3-2 | Account export (`GET /users/me/export`) omits run distance, splits, heart rate, calories; no route reads `workout_run_summaries`/`_splits`; `data-inventory.md` says they are exported | Confirmed | High | Fix now (S4) |
| L4-1 | A double tap on "Log" in a food creates two diary entries (no in-flight guard, no idempotency key) | Confirmed | High | Fix now (S3) |
| L4-2 + L9a-4 | Health reads sort **oldest first** then cut at a limit: stale weight behind suggested targets (> 1,000 weights/yr), and Home/Progress health charts show old data once an account passes 2,000 readings (no `since` is sent) | Confirmed, one root cause | High | Fix now (S2) |
| L6-1 | Suggested calorie target has no minimum: 45 kg, 150 cm, 60 y woman, mostly sitting, lose fat → **1,100 kcal/day** offered as a one-tap "Use"; extreme inputs go lower | Confirmed | High | Fix now (S3); **needs the user's approved floor and citation** |
| L8-1 | Rank tab's selected chip: white on `accent` = 3.06:1 contrast (AA needs 4.5:1); regression of the fixed H13 pattern | Confirmed | High | Fix now (S8) |
| L9b-1 = L9a-1 | Progress loads its four sections one after another (~4 round trips, ~2.5-3 s) instead of together (~1) | Confirmed (verifier: medium; the plan's speed rule makes a main screen over budget **high**) | High | Fix now (S5) |

Verification notes that changed a severity:
- **L1-1** (Health Connect library imported eagerly) — checked by the session in the library source:
  **no crash on iPhone** (a lazy `Proxy`); only **Android Expo Go** would crash at import. Low.
- **L9a-2 / L9a-3** (leaderboard recomputed per profile view; `all_time` scans a city's whole history):
  confirmed, verifier rated **medium-high** — real, but costs grow with data that does not exist yet.
- **L9a-5** (Nutrition refetches foods): confirmed and **worse than reported** — `loadFoods(foodIds, {})`
  at `nutrition.tsx:156` passes an empty cache, so **every visit** re-requests every food in today's log
  and every saved meal, one request each. Medium (high with a large saved-meal library).

## Medium findings

| ID | Finding | Proposed |
|---|---|---|
| L5-2 | Recent exercises, notification and unit preferences carry over to the next account after sign-out (same root cause as L3-1) | Fix with S1 |
| L5-1 | Denying only heart rate also discards granted watch calories on a run | Fix (S10) |
| L9a-2 | Opening an athlete profile recomputes the whole city leaderboard | Fix (S6) |
| L9a-3 | `all_time` leaderboard aggregates the city's full history on each request, uncached | Fix (S6) |
| L9a-5 | Nutrition screen: one request per food across log + all saved meals, on every visit (empty-cache bug) | Fix now (S3) |
| L9a-6 | Streak, "ready to progress" and first-session reads scan a user's whole history | Schedule (S6) |
| L9a-7 | Cloud Run has no `--cpu-boost` / min instances: **14.6 s measured cold start** | Decide (S7) |
| L9a-8 | Leaderboard snapshot job runs cities one at a time | Schedule (S6) |
| L9b-2 | Train's previous-workout card reads each exercise from SQLite one at a time | Fix (S5) |
| L9b-3 | `getMe` fetched three times at launch (layout, Home, Profile) | Fix (S5) |
| L9b-4 | Home, Train, Rank refetch everything on every tab switch | Fix (S5) |
| L4-3 | Logging a saved meal reads each food one query at a time | Fix (S3) |
| L7-1 | InBody reading can hold a request ~90 s (3 × 30 s, no backoff/deadline) | Fix (S9) |
| L7-3 | No golden fixture for the known InBody 770 Score misread or an FFMI sheet (rule 8) | Fix (S9) |
| L8-2 | Segmented control is a 38 px touch target | Fix (S8) |
| L8-3 | Nutrition share photo button 34 × 34 | Fix (S8) |
| L8-4 | `lineHeight` = `fontSize` everywhere, no `maxFontSizeMultiplier`: clipped text at large font sizes | Fix (S8) |
| L10-1 | Leaderboard scoring test asserts < 1 s wall clock; failed at 24 s under load (flaky CI) | Fix now (S12) |
| L12-1 | Deploy and snapshot workflows (GCP credentials) use unpinned action tags | Fix (S11) |
| L12-2 | getforjd.com sends no CSP, HSTS, `X-Frame-Options`, `Permissions-Policy` | Fix (S11) |
| L3-3 | Sentry does not scrub health values from exception messages (known, `data-inventory.md`) | Schedule |
| L11-1 | README describes Phase 0 Flutter/BullMQ | Fix (S13) |
| L11-2 | `analytics.md` documents a domain-event system that does not exist | Fix (S13) |
| L11-3 | `domain-model.md` lists unbuilt health tables; says nutrition has no schema | Fix (S13) |
| L11-4 | ADR-035's condition crossed by R8 with no ADR amendment | Fix (S13) |
| L1-1 | Health Connect library imported eagerly (Android Expo Go crash only, see above) | Fix, low (S10) |

## Low findings

L2-1 CORS reflects origins when unset (known, safe today) · L2-2 password-reset throttle per IP only ·
L2-3 WHOOP OAuth `state` reuse (unconfirmed) · L6-2 age uses the server's calendar day · L7-2 vendor error
text returned to the app · L9b-5 Train's programs section never refreshes · L10-2 contracts tests vs a
stale domain build (local only) · L11-5 website plan status line · L11-6 CLAUDE.md says "Flutter screen" ·
L11-7 CLAUDE.md lists 4 of ~16 CI checks · L11-8 `data-inventory.md` marks run tables "planned" ·
L12-3 Expo packages a few patches behind SDK 57. Proposed: fold into the slice for their area, or close.

## Speed: what makes the app slow

Measured this session, not estimated:

| What | Measurement | Where |
|---|---|---|
| Database query time | App reads ~0.1-0.3 ms each; exercise catalogue 20 ms mean (208 ms max, ~874 rows with every column) | `pg_stat_statements`, forjd-dev |
| One API round trip | **0.68-0.78 s warm** for a `select 1` health check | staging, `curl` × 5 |
| API cold start | **14.6 s** for the first request after idle | staging, `curl` |
| App bundle | 5.8 MB Hermes bytecode (fonts are the largest assets) | `expo export --platform android` |

So the database is not the bottleneck. In order of impact:

1. **Region mismatch.** The API runs in `us-central1`; both Supabase projects are in `eu-west-1`.
   Production uses the same `GCP_REGION` variable as staging (`deploy-api.yml`; not read live — the local
   `gcloud` is broken). Every query crosses the Atlantic, and a request with several sequential queries
   pays that several times. **Moving the API to a European region costs nothing** and helps every screen.
2. **Cold start (L9a-7).** Scale-to-zero means the first request after a quiet spell takes ~15 s.
   `--cpu-boost` shortens it; `--min-instances 1` removes it but is **paid** (free-tier constraint).
3. **Screens that wait on requests one after another:** Progress (L9b-1), Train's previous workout (L9b-2).
4. **Screens that repeat requests:** Nutrition refetches every food on each visit (L9a-5); `getMe` × 3 at
   launch (L9b-3); Home/Train/Rank refetch on every tab switch (L9b-4).
5. **Reads that grow with history:** leaderboard per profile view and `all_time` (L9a-2/3), whole-history
   streak scans (L9a-6), per-item saved-meal reads (L4-3).

Screen by screen (first visit):

| Screen | Requests | Shape | Cached on revisit | Verdict |
|---|---|---|---|---|
| Home | 6-7 | parallel | yes | OK once round trips are cheaper; refetches on every tab switch |
| Train | ~5 | mostly parallel; 2-step chain + N SQLite reads | yes (programs never refresh) | minor |
| **Progress** | 4 | **sequential** | yes | **over budget** |
| Rank | 1 (4 internal queries) | — | yes | OK for month; `all_time` grows unbounded |
| **Nutrition** | 3 + one per food | parallel | **no** (empty-cache bug) | **wasteful on every visit** |
| Athlete profile | 1 (~9 internal incl. a full leaderboard) | mostly parallel | — | heaviest read in the app |
| Library, InBody, programs, profile, run history | small / local-first | — | yes | clean |

Database advisors (both projects): 4 foreign keys without an index (`exercise_favourites.exercise_id`,
`program_enrollments.program_id`, `program_workouts.template_id`, `workout_templates.based_on_template_id`);
`exercise_favourites` has no primary key. Low; fold into S6. The slow `pg_timezone_names` query in the
stats (788 ms) is Supabase's own tooling, not this app.

## Proposed fix slices (8.5D), each test-first, one PR each

| Slice | Contents | Needs the user? |
|---|---|---|
| **S1** Sign-out and account scoping | L3-1, L5-2, the known snapshot and late-`getMe` gaps | No |
| **S2** Newest-first health reads | L4-2 + L9a-4 | No |
| **S3** Nutrition correctness and speed | L4-1, L9a-5, L4-3, **L6-1 floor** | **Yes: the calorie floor value and its citation** |
| **S4** Export completeness | L3-2, L11-8 | No |
| **S5** App speed | L9b-1..5 | No |
| **S6** Leaderboard and history reads | L9a-2, L9a-3, L9a-6, L9a-8, missing FK indexes | No |
| **S7** Server location and cold start | region move, `--cpu-boost`, min instances | **Yes: region move is an infra change; min instances costs money** |
| **S8** Accessibility | L8-1..4, contrast of `label`/`dimmer` tokens | No |
| **S9** InBody reliability | L7-1..3 | No |
| **S10** Health Connect | L5-1, L1-1 | Device test owed (rule 16) |
| **S11** Web and CI hardening | L12-1..3, L2-2, L2-3 | No |
| **S12** Tests | L10-1 | No |
| **S13** Docs | L11-1..8, ADR-035 amendment | No |

Suggested order: S1 (blocker) → S2, S3, S4 (wrong data) → S5 and S7 (speed the user sees) → S8 → the rest.
