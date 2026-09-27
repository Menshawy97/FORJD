# Weekly Forge — plan

**Status:** Phase 1 accepted, Phase 2 merged (#290), Phase 3 (domain rules) in review, 2026-09-27. Every phase stops for the
user's review, and **no mobile code is written until the Phase 7 mock-ups are approved**.

ADRs: [ADR-056 Weeks start on Saturday](../decisions/ADR-056-weeks-start-on-saturday.md),
[ADR-057 Weekly Forge](../decisions/ADR-057-weekly-forge.md).

## Tier table (for approval)

**How the values were built:**
- Ore is written by hand.
- From Ember up, each level is 12% above the one before, computed on the unrounded chain.
- Rounding: Volume to 50 kg, Distance to 0.5 km, Minutes to 5 minutes.
- Ember gets 7 levels and Anvil 8, so each band's width matches the brief's anchors. Six steps of 12% only span ×1.97.

### Volume (kg per week)

| Band | Levels |
|---|---|
| Ore (1–6) | 2 000 · 2 500 · 3 000 · 3 500 · 4 200 · 5 000 |
| Ember (7–13) | 5 600 · 6 250 · 7 000 · 7 850 · 8 800 · 9 850 · 11 050 |
| Anvil (14–21) | 12 400 · 13 850 · 15 550 · 17 400 · 19 500 · 21 800 · 24 450 · 27 350 |
| Tempered (22–27) | 30 650 · 34 350 · 38 450 · 43 050 · 48 250 · 54 000 |
| Forged (28–33) | 60 500 · 67 750 · 75 900 · 85 000 · 95 200 · 106 600 |

### Distance (km run per week)

| Band | Levels |
|---|---|
| Ore (1–6) | 3 · 5 · 7 · 9 · 11 · 13 |
| Ember (7–13) | 14.5 · 16.5 · 18.5 · 20.5 · 23 · 25.5 · 28.5 |
| Anvil (14–21) | 32 · 36 · 40.5 · 45 · 50.5 · 56.5 · 63.5 · 71 |
| Tempered (22–27) | 79.5 · 89.5 · 100 · 112 · 125.5 · 140.5 |
| Forged (28–33) | 157.5 · 176 · 197.5 · 221 · 247.5 · 277 |

### Active minutes (per week)

**The top of this ladder is shortened (risk R6).** At 12% a level, six levels each for Tempered and Forged would reach about 40 hours a week. This proposal gives each of them 3 levels.

- Ore tops out at WHO's 150-minute floor.
- Ember spans WHO's 150–300 range.

| Band | Levels |
|---|---|
| Ore (1–6) | 60 · 80 · 100 · 120 · 135 · 150 |
| Ember (7–12) | 170 · 190 · 210 · 235 · 265 · 295 |
| Anvil (13–19) | 330 · 370 · 415 · 465 · 520 · 585 · 655 |
| Tempered (20–22) | 735 · 820 · 920 |
| Forged (23–25) | 1 030 · 1 155 · 1 290 |

### Consistency (workouts per week)

| Band | Levels |
|---|---|
| Ore | 1 · 2 |
| Ember | 3 |
| Anvil | 4 |
| Tempered | 5 |
| Forged | 6 |

### Nourish (days with meals logged, per week; private, no Forged)

| Band | Levels |
|---|---|
| Ore | 1 · 2 |
| Ember | 3 · 4 |
| Anvil | 5 · 6 |

**Settled 2026-09-27 (the user accepted the table as proposed):** the shortened top of the Minutes ladder stays, Consistency's Forged target is 6, and the Ore values stand.

## Context

FORJD gets a weekly progression system, "Weekly Forge". Each user has an independent level on five ladders: Consistency, Volume, Distance, Active minutes and Nourish. The bands are Ore, Ember, Anvil, Tempered and Forged. The user's level sets their weekly target, and every target is standard across the app. A job judges each closed week, rewards go to an append-only ledger, and celebrations scale with how big the change is.

It is computed only from data the app already logs. It must fit into the existing app without restyling anything, ship dark behind a flag, and stop for your review after every phase. Backend first, then UI.

**Your decisions from this session:**

| Topic | Decision |
|---|---|
| Consistency ladder | One step per band: Ore 1–2 workouts, Ember 3, Anvil 4, Tempered 5, Forged 6 (through the 4-week hold) |
| Losing Forged | Drop to the top Tempered level. Re-forge by holding 4 weeks again |
| Leaderboards | **No Forge ranking anywhere.** Bands, badges and Forged status show on the public athlete profile, only when `public_profile` is on. Nourish is never public |
| What counts | All logged workouts, live-timer or not |
| Late sync | No grace. A week is judged at close, and anything that reaches the server afterwards doesn't count for it |
| Week start | **Saturday to Friday (Egyptian calendar), across the whole app.** Home's This week, the streak, Progress and the leaderboard snapshot all switch |
| Time zone | Each user's phone zone, stored on the server. Default `Africa/Cairo` until the app has sent one |
| Warm-ups | Counted in Volume, matching the rest of the app |
| Band floor | Protected for one week only. Older bands can be lost through repeated misses |
| UI | **Every screen, card, sheet and celebration is shown to you as a visual mock-up and approved before any mobile code is written** |

---

## 1. Repo study

### Mismatches with the brief (flagged, not blocking)

1. **The app is Expo React Native, not Flutter.** The roadmap records the Flutter-to-Expo pivot. Every "Flutter" deliverable becomes React Native:
   - TSX components instead of widgets.
   - Jest + RNTL tests instead of widget tests.
   - Fidelity tests instead of goldens.
2. **The app is dark-only.** `userInterfaceStyle: 'dark'` and `DarkTheme` is forced. So "light and dark like the existing theme" means dark only.
3. **There are no friends or followers.** This is moot now that there is no Forge board.
4. **There are no haptics.** `expo-haptics` would be the one new dependency. It needs your approval in Phase 7.

### Architecture and conventions

**Repository layout.** A pnpm monorepo:
- `apps/api`: NestJS.
- `apps/mobile`: Expo SDK 57, pinned by ADR-027.
- `packages/domain`: pure TypeScript with no dependencies. Specs sit next to the code.
- `packages/contracts`: Zod schemas plus pinned JSON fixtures, diffed by CI.

**API modules.** Each is one flat folder: module, controller, service and repository, each with a spec next to it. `apps/api/src/leaderboards/` is the model to follow.
- There are no DTO classes. Routes validate with `ZodValidationPipe(schema)`.
- Responses have no envelope.
- Routes use `JwtAuthGuard`, and read the user from `request.user.id`.
- Everything is under `api/v1`, and changes are additive only (rule 7).

**Database.**
- Drizzle schema lives in `apps/api/src/database/schema/`.
- Migrations are `apps/api/drizzle/NNNN_kebab.sql`, generated by `db:generate`. The latest is `0028`.
- Raw SQL goes through `executeValidated(...)` with a Zod row schema.
- Vocabularies are `text` columns backed by domain tuples. Values are stored in kg and metres (ADR-016).
- There is no RLS. Guards enforce authorization (rule 12).

**Reference data.** Idempotent upsert scripts run on every deploy after `db:migrate`: `exercises:load`, `nutrition:load` and `programs:seed`.

**Jobs.**
- The only scheduler is a GitHub Actions cron (`leaderboard-snapshot.yml`). `@nestjs/schedule` was rejected (ADR-047 §6).
- The script pattern to copy is `apps/api/src/leaderboards/snapshot/snapshot.ts`.
- Idempotency comes from unique keys or delete-and-reinsert, inside one transaction.

**Analytics.** Figures are computed on read (ADR-029). ADR-047's weekly snapshots are the one stored derived table.

**Feature flags.** A `feature_flags` table exists (key, enabled, description), but nothing reads it and it has no endpoint. Mobile has no flag system.

**Tests.**
- **API:** Jest, with repository specs against real local Postgres, controller metadata specs and `test/*.e2e-spec.ts`. Services have 100% coverage gates.
- **Mobile:** jest-expo + RNTL through `render-app.ts`. No snapshots.

**Mobile.**
- Routing: expo-router tabs plus flat stack routes.
- State: `useState` + `useFocusEffect` with a generation ref. No zustand or react-query.
- API calls: all endpoints are typed functions in `src/auth/apiClient.ts`.
- Storage: raw `expo-sqlite` for offline data, AsyncStorage keys `forjd.*` for preferences.

### Existing data we build on

| Ladder | Source | Weekly total |
|---|---|---|
| Consistency | `workout_sessions` completed, not deleted | count |
| Volume | completed `workout_sets`, every type including warm-up | `sum(weight_kg*reps)` |
| Distance | `activity='running'` sessions → `workout_sets.distance_meters` (what the leaderboard sums) | km |
| Active minutes | `duration_seconds` (pauses excluded), capped at 2 h per session like ADR-046 (`ACTIVITY_SESSION_CAP_SECONDS`) | minutes |
| Nourish | `nutrition_log_entries.logged_date` (already the user's local day) | distinct days, max 6 |

**Time zone.** `preferences.timezone` exists but nothing reads or writes it.

**Streak.** It lives in `calendar-utils.ts:54` (`countWeekStreak`).

**Rewards.** No badges, XP or achievements exist anywhere.

**Timestamps.** Sessions, sets and meal entries all have `created_at`, `updated_at` and `deleted_at`.

### Design system (reused as is)

**Tokens.**
- The source of truth is `tailwind.config.ts`. `src/theme/tokens.ts` mirrors it and `__tests__/tokens.test.ts` guards against drift.
- Accent: `#E9712F`, with `#F4894C` (lighter) and `#A84D1D` (darker).
- Surfaces and text: surface `#17181A`; elevated `#191A1C`, `#1C1D20` and `#232326`; text `#F6F5F3`; dim `#9A9A92`; dimmer `#8A8A82`.
- `badgeGold #C9A03C` exists but is unused.

**Type, spacing and radius.**
- Font: Archivo.
- Spacing: screen-x 22, card 16, gap 12.
- Radius: button 12, card 14, hero 16.
- Background: the ember atmosphere from `screen-background.tsx`.

**Components.** There is no shared Card, Button or Sheet component.
- Cards are `rounded-card border border-border bg-surface`, or a LinearGradient wrapped around a bordered View.
- Sheets are hand-built on `scrim` (`meal-sheets.tsx`) or use RN `Modal`.
- Toasts come from `useToast()` (1900 ms).
- For progress there is the rail in `features/home/this-week.tsx`.
- Icons come from `icon.tsx`: 24-grid, stroke 1.6, round caps. The set includes calendar, dumb, runner and clock.
- The logo is `brand/logo-mark.tsx`.

**Motion.**
- Reanimated 4.5 and react-native-svg are installed. Moti, Lottie, Skia and haptics are not.
- Reduce motion is read through `AccessibilityInfo.isReduceMotionEnabled()`, as in `intro-splash.tsx`.

**Share.** `media/share-card-shot.tsx` and `share-capture.ts`.

**Copy voice.** Plain, direct, second person and short, with no hype and no emoji.

**Home order.** Header, date, sync banner, Readiness, Nutrition today, StatStrip, Insight, Start workout, This week, Recent PR.

---

## 2. Rules as implemented (pure domain, fully unit-tested)

**Weekly result.**
- **Hit** (total ≥ target): up one level.
- **Overshoot:** move to the highest level whose target the total clears, capped at +3.
- **Miss:** stay at the same level and add one to the miss count.
  - On the 3rd consecutive miss, drop one level and reset the count.
  - A band entered in that same week is protected. In practice this never triggers, because a miss week enters no band, so drops can cross bands.
  - Level 1 is the floor.

**Forged.**
- **Getting in:** a climb can't pass the top Tempered level until the user has ended 4 consecutive weeks inside Tempered. After that the Forged band opens, and the +3 cap still applies.
- **Losing it:** any miss while Forged drops the user to the top Tempered level and resets the Forged streak and the hold counter. The best streak is kept.
- **Nourish** has 6 levels ending at Anvil, and no Forged.

**Rewards ledger.** Append-only, with unique keys so it is idempotent.
- `forge_mark`: the first time a level is reached on a ladder. Re-climbing after a drop shows the level-up but earns no new mark.
- `band_badge`: the first entry into a band on a ladder.
- `forged`: every week the user enters Forged, first time or re-forge.

**Lock.**
- A week counts rows with `created_at ≤ closes_at` and with (`deleted_at is null or deleted_at > closes_at`).
- The locked total is stored with the result, so later edits never change a closed week.

**Enrolment.**
- Everyone starts at Ore 1 the first time the flag is on for them.
- The first judged week is the week they enrolled, counting that whole week.
- No historical backfill.

### How tier values are built (full table at the top of this file)

**How they're built.**
- Ore is hand-written.
- From Ember up, each level is 12% above the one before.
- Ember gets 7 levels and Anvil gets 8, so that the band widths match your anchors. Six steps at 12% only spans ×1.97.

| Ladder | Ore (hand) | Ember | Anvil (widest) | Tempered | Forged |
|---|---|---|---|---|---|
| Volume kg | 2 000, 2 500, 3 000, 3 500, 4 200, 5 000 | 5 600 → ~11 050 (7) | ~12 400 → ~27 400 (8) | ~30 650 → ~54 000 (6) | ~60 500 → ~106 600 (6) |
| Distance km | 3, 5, 7, 9, 11, 13 | 14.5 → 28.5 (7) | 32 → 71 (8) | 79 → 140 (6) | 156 → 276 (6) |
| Minutes | 60, 80, 100, 120, 135, 150 (the WHO floor) | 165 → 291 (6, WHO's 150–300 range) | 326 → 643 (7) | 720 → 1 270 (6) | see R6 |
| Consistency | 1, 2 | 3 | 4 | 5 | 6 |
| Nourish (days) | 1, 2 | 3, 4 | 5, 6 | none | none |

**Where they live.**
- The single source is `packages/domain/src/forge-tiers.ts`.
- Specs check the values rise monotonically, grow 12% ±1% from Ember up, and respect the band boundaries.
- A `forge:seed` upsert copies them into a seeded table on every deploy, the same way `programs:seed` works.

---

## 3. Phases

Each phase follows the same loop: plan or ADR, tests first, PR, green `main`, **then stop for your review**.

### Phase 1: Decisions and docs (docs only)

- **ADR-056, "Weeks start on Saturday".** Covers the whole app, and what changes: leaderboard labels, streak and Progress.
- **ADR-057, "Weekly Forge".** Records:
  - Stored weekly evaluation, extending ADR-047. Levels depend on history, so they can't be computed on read.
  - Rule 9 still holds: locked inputs are stored, and state can always be refolded from them.
  - The rules in section 2, the lock, the time-zone source, cron plus evaluate-on-read, no ranking, and Nourish staying private.
- **`docs/product/weekly-forge-plan.md`** with the full tier table, plus a roadmap entry.
- **Your review:** the tier table and both ADRs.

### Phase 2: Saturday weeks, backend (ADR-056)

- A domain constant `WEEK_START_DOW` drives `weekStartOf` and `countWeekStreak` in `apps/api/src/workouts/calendar-utils.ts`.
- Update every Monday assumption:
  - `workout-sessions.repository.ts`
  - `progress.repository.ts`
  - `athletes/athlete-stats.repository.ts`
  - `leaderboards/city-time.ts` (`snapshotWeekStart` labels the coming local Saturday)
  - `leaderboard-snapshot.repository.ts`
  - the doc strings and fixtures in `packages/contracts/src/{workouts,progress}.ts`
- `leaderboard-snapshot.yml` moves its cron to Saturday 00:20 UTC (02:20 or 03:20 in Cairo, after the week closes). The existing half-day nudge keeps labels stable across Egypt's summer time.
- The delta fallback already copes with the old Monday-labelled rows.
- Update the FAQ wording in `faq-content.ts`.
- Tests are updated first, so they fail on the Monday expectations.

### Phase 3: Domain (`packages/domain`)

**Files.**
- `forge-vocabulary.ts`: ladder keys, bands, reward types, celebration kinds, and flavour copy ("Struck.", "Heat rising.", "Forged.", "Cooled to Tempered. Hold 4 weeks to re-forge.").
- `forge-tiers.ts`: the tier values, plus `bandOf`, `targetOf` and `maxLevel`.
- `forge-evaluation.ts`: the pure function `evaluateWeek(state, total, tiers) → { next, outcome, rewards[] }`.
- `forge-celebration.ts`: `summariseWeek(results[]) → { biggest: forged|band|level|cooled|none, perLadder[] }`. Nourish is always calm.
- `forge-week.ts`: `forgeWeekStart(instant, tz)` and `weekClosesAt(weekStart, tz)` using Intl. Handles Egyptian DST and offsets from UTC-12 to UTC+14.

**Tests first.**
- Overshoot: +2, +3, and the +3 cap.
- Misses: one and two (stay), three (drop and reset), a drop across a band, the floor.
- The Forged gate at 3 weeks versus 4.
- The Forged streak, best streak, loss to top Tempered, and re-forge.
- The Nourish ceiling, and Consistency's short ladder.
- Reward idempotency.
- Friday 23:59 versus Saturday 00:00 local, DST weeks, and far-east and far-west zones.

### Phase 4: Schema and seed

**Migrations.** Generated by drizzle-kit. Re-check the next free number right before generating, because other sessions add migrations too.

| Table | Purpose | Columns and keys |
|---|---|---|
| `forge_ladders` | seeded | key, unit, max_band, is_public, sort |
| `forge_tiers` | seeded | ladder_key, level, band, target; primary key (ladder_key, level) |
| `forge_user_ladders` | current state | user_id, ladder_key, level, best_level, miss_streak, tempered_hold_weeks, forged_streak, best_forged_streak, enrolled_week, last_evaluated_week, updated_at |
| `forge_weeks` | locked week results | user_id, ladder_key, week_start, time_zone, closes_at, locked total, target, level and band before and after, outcome, streaks after, rules_version, evaluated_at; unique (user, ladder, week_start) |
| `forge_rewards` | append-only ledger | user, ladder, type, level, band, week_start, created_at; partial unique indexes, written with `on conflict do nothing`, and no update or delete path |
| `forge_week_acks` | celebrations seen | user_id, week_start, acked_at |

- Every table cascades on user deletion.
- A custom migration inserts `feature_flags('weekly_forge', false)`.

**Seeding and privacy.**
- `apps/api/src/forge/seed/seed.ts` becomes the `forge:seed` script, added to `deploy-api.yml`.
- `data-inventory.md`, the account export and account deletion all cover the new tables.

### Phase 5: Totals, evaluation and the job

**Totals.** `forge-totals.repository.ts` runs one bounded query per user and week that returns all five totals, applies the lock filter, and uses the existing indexes.

**Evaluation.** `forge-evaluation.service.ts` catches up every closed week that hasn't been judged yet, in order, with one transaction per week:
- It takes `select … for update` on the state rows.
- It only proceeds when `last_evaluated_week` is the previous week.
- It inserts the week rows, updates state, and writes ledger rows with `on conflict do nothing`, so a re-run changes nothing.

**Recompute.** A maintenance path refolds state from the stored locked totals, for rule-9 recovery. It never removes ledger rows.

**The job.**
- The `forge:evaluate` script, `apps/api/src/forge/evaluate/evaluate.ts`, follows the snapshot pattern: one user's failure doesn't stop the others, and the script exits 1 if any failed.
- `.github/workflows/forge-evaluate.yml` runs at `10 * * * 5,6` (hourly on Friday and Saturday UTC). That covers every zone's Saturday 00:00, for both staging and prod, and it can be dispatched by hand.
- **Evaluate on read:** `GET /forge` runs the same service for the caller first, so a late cron never delays anyone's results.

**Tests.**
- Repository specs on real Postgres covering:
  - the lock filter: created after close is excluded, deleted after close is still counted
  - every ladder's total
  - warm-ups
  - the 2 h cap
  - distinct Nourish days
  - a Friday 23:30 Cairo session counting in the right week
- A double run leaves identical rows. Catching up two missed weeks works. Service coverage is 100%.

### Phase 6: API and contracts (additive only)

**Contracts.** `packages/contracts/src/forge.ts` and `feature-flags.ts`, with fixtures.

**Endpoints.**
- `GET /api/v1/feature-flags` returns the enabled keys.
- The app writes `preferences.timezone`, validated with Intl. It uses the existing preferences route, extended with an additive field if needed.
- `GET /api/v1/forge` returns, per ladder: band, level, target, this week's live total, progress, days left, miss streak, the Forged streak and best, and badges. It returns 404 while the flag is off.
- `GET /api/v1/forge/weeks/pending` and `POST /api/v1/forge/weeks/:weekStart/ack` handle the celebrations.
- `GET /api/v1/athletes/:userId` gains an optional `forge` block with the 4 public ladders. It appears only when `public_profile` and the flag are both on, and never includes Nourish.

**Tests.** Controller metadata, e2e for every route, and regenerated fixtures.

### Phase 7: UI mock-ups for your approval (no mobile code before this)

One HTML replica built with the existing tokens, at pixel level:

1. **Band finishes**, dark only. Existing tokens are reused wherever possible, and the minimum is new:

   | Band | Colours |
   |---|---|
   | Ore | `#232326` → `#8A8A82` (existing, no new token) |
   | Ember | `#A84D1D` → `#E9712F` → `#F4894C` (existing, no new token) |
   | Anvil | **new** `forgeSteelDark #2B2F35`, `forgeSteelLight #5A626D` |
   | Tempered | **new** `forgeTemperStraw #D8B26A`, `forgeTemperBlue #5B7FB8`, over the steel |
   | Forged | **new** `forgeWhiteHot #FFF3DC`, `forgeGold #F0B43C`, plus `badgeGold #C9A03C` |

2. **Forge mark matrix**, 5 ladders × 5 bands.
   - An ingot or maker's-mark outline on the 24-grid, stroke 1.6, matching `icon.tsx` and the logo.
   - Glyphs: calendar, dumb, runner and clock, plus one new Nourish glyph in the same style.
3. **Weekly Forge card on Home.** One row per ladder: glyph, finish, level, progress rail, days left. Proposed position: between "Start workout" and "This week", with nothing else moved.
4. **Level-up toast or sheet**, non-blocking, about 2 s.
5. **Band-crossing full screen** with Share.
6. **Forged moment** with the week count and Share.
7. **Quiet states:** "Cooled to Tempered" (gentle, no red), the neutral missed week, and the calm Nourish version with no Share.
8. **The week-close summary.**
9. **Profiles:** the Forge section on your own profile (5 ladders), and the public athlete profile block (4 ladders).
10. **The share card** with the logo mark.
11. **Before and after for the Saturday week** on Home's This week, the Progress training calendar and the volume bars.
12. **Reduce-motion static versions** of items 4–6.

Also for approval here: **`expo-haptics`**.
- It is Expo's own module, runs in Expo Go, and needs no config plugin.
- Nothing already installed can do light, medium and heavy haptics.
- It sits behind the seam `src/components/haptics.ts`, so Jest never touches it.

### Phase 8: Mobile foundations (after Phase 7 approval)

- The approved tokens go into `tailwind.config.ts`, `src/theme/tokens.ts` and the tokens test.
- `features/forge/band-finish.ts` holds the finish definitions.
- `features/flags/use-feature-flag.ts`:
  - Fetches once per launch.
  - Caches in `forjd.flags`.
  - Is cleared by `local-data.ts`.
- Time-zone sync on launch, sent only when it changes.
- `components/haptics.ts` and a reduce-motion hook.
- `features/forge/forge-mark.tsx`: one SVG component, parameterised by ladder × band × level.
- Saturday ordering in:
  - `home/this-week.tsx`
  - `home/date.ts`
  - `progress/training-calendar.tsx`
  - `progress/volume-bars.tsx`
- **Tests:** forge-mark renders for every band and ladder (gradient stops, glyph, level), the flag hook, the time-zone sync, and the Saturday ordering.

### Phase 9: Card and profiles

- `features/forge/weekly-forge-card.tsx` goes into `(tabs)/index.tsx`, only when the flag is on.
- `profile-forge-section.tsx` goes into `(tabs)/profile.tsx`, and the public block into `athlete/athlete-sections.tsx`.
- New client calls in `apiClient.ts`: `getForge`, `getPendingForgeWeeks`, `ackForgeWeek`.
- **Tests:**
  - Home looks the same as today with the flag off, and correct with it on.
  - The profile shows the Forge section.
  - The athlete profile never shows Nourish.

### Phase 10: Celebrations, summary and share

**When Home comes into focus**, it fetches pending weeks and shows the biggest celebration once:

| Biggest change | What plays |
|---|---|
| Forged | `forge-forged.tsx` |
| New band | `forge-band.tsx` |
| New level | toast (never blocking) |
| Cooled or none | no celebration |

After the celebration, `forge-week.tsx` shows the week summary, and the week is acked.

**Animation.**
- Reanimated plus SVG sparks, with the particle count capped for mid-range Android.
- Reduce motion swaps in static reveals.
- Haptics go through the seam.

**Share.** `forge-share-card.tsx` reuses `share-card-shot.tsx` and `share-capture.ts`. It is hidden for Nourish.

**Tests:**
- The celebration picker and the navigation flow.
- The ack is sent only once.
- Reduce motion.
- No Share button for Nourish.
- No shame wording, checked against a banned-word list.

### Phase 11: Close

- Update `analytics.md`, `domain-model.md` and the roadmap.
- The production flag stays **off**.
- Owed to you: a device walk (a dev-client build, for share and haptics), and turning the flag on in staging.

---

## 4. Risks and conflicts

**R1: Saturday weeks change existing behaviour.**
- The streak can shift by a week at the switch.
- Leaderboard weekly movement is blank on the first Saturday.
- Progress's weekly buckets move.

**R2: GitHub Actions minutes.**
- The repo is **private**, which gets 2 000 free minutes a month.
- The Friday–Saturday hourly cron adds about 200–400 minutes a month.
- Evaluate-on-read keeps results correct even when the cron slips.

**R3: The lock window.**
- New and deleted rows lock exactly.
- An in-place edit to an existing set made between the close and the evaluation can still leak in. The cron keeps that window to about an hour.

**R4: No grace.** A Friday workout that syncs after Saturday 00:00 is lost for that week. Expect some "it didn't count" reports.

**R5: Stored derived state versus rule 9 and ADR-029.** Justified in ADR-057.

**R6: The top of the Minutes ladder.** At 12% per step, Tempered and Forged reach 20–40+ hours a week. I'll propose fewer upper levels for Minutes in Phase 1.

**R7: Consistency's Forged target.** It is 6 a week, the maximum. You can lower it to 5 in Phase 1.

**R8: Concurrent sessions.**
- All work happens in a dedicated worktree.
- Migration numbers are re-checked right before generating.
- `gh pr list` is checked before editing `this-week.tsx` or `calendar-utils.ts`.

**R9: Share cards in Expo Go.** View-shot doesn't run in Expo Go, so share cards are verified on a dev-client build.

**R10: A new public surface on the athlete profile.** It is gated by `public_profile`, never shows Nourish, and gets a privacy re-check.

## 5. Verification

**Every phase runs:**
- `pnpm --filter @forjd/domain test:cov`
- contracts `test:cov` and the fixture diff
- api `lint test:cov test:e2e`, with local Postgres from docker-compose
- mobile `typecheck lint test:cov`
- the conformance script

**End to end:**
1. Seed users with sessions on either side of a Saturday boundary, in Cairo and Pacific zones.
2. Run `forge:evaluate` twice. The week rows and the ledger must be identical after both runs.
3. `GET /forge` and `/forge/weeks/pending` must return the expected celebration.

**Before and after each PR:** a code-review agent reviews the diff before it opens, and after the merge I watch CI on `main` until it passes.

**UI:** the Phase 7 artifact must be approved before any mobile code. After that, every built screen is checked pixel by pixel against the approved mock-up.

