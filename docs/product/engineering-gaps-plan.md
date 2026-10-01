# Engineering gaps that need nobody (2026-10-01)

**Status:** planned 2026-10-01. Each slice is its own PR, test-first, reviewed, merged with `main` green.

**Why now:** the Android beta waits on the owner (device tests, Play Console) and on Phase 12A-12C.
Everything here can be finished without a device, an account or a product decision, and the
choices that *were* needed were put to the owner first and answered (below). Sources: the
roadmap's "Known engineering gaps", the 8.5E re-run reports (`docs/reviews/2026-09-26-*`) and
`live-run-plan.md` "Follow-ups".

## Owner decisions (2026-10-01)

1. **Crash reports when a user switched crash diagnostics off: not sent at all.** This is what
   `data-inventory.md` already promises. A crash tied to no known setting (server start-up, an
   unauthenticated request, a background job) is still sent, with no user and no text (decision 2),
   because there is no person whose choice it would override.
2. **Health values in crash reports: strip all text.** Every server report keeps only the error
   type and the stack frames (file, function, line). Exception messages, request data, breadcrumbs,
   `extra` and `contexts` are removed, whatever the consent. Watertight rather than pattern-based.
3. **`run_points` (on-phone table) is removed.** The snapshot carries the fixes.
4. **The two wall-clock timing tests in `nutrition.repository.spec.ts` are deleted.** The
   query-count tests beside them prove the same N+1 fix deterministically.

## Slices

### G1 — Sentry: drop on "off", strip all text (L3-3)
- **Files:** `apps/api/src/observability/sentry-scrub.ts` (+ spec), `apps/api/src/instrument.ts`,
  `docs/architecture/data-inventory.md` (close the "Known mismatch").
- **As built:** `JwtAuthGuard` → `markCrashSubject(user.id)`; `beforeSend` =
  `createCrashReportFilter` (reads the choice via `CrashConsentRegistrar` only when a crash
  happens); the old `GET /me` tag (`applyCrashDiagnosticsConsent`) was removed, since it covered
  only that one route. The original design notes follow.
- **Behaviour** (`scrubCrashReport(event)`, replacing `scrubUnlessDiagnosticsConsented`):
  - tag `crash_diagnostics` = `'off'` → return `null` (not sent);
  - tag `'on'` → keep `event.user`; anything else (absent, unknown) → delete `event.user`;
  - always: each `exception.values[].value` replaced by a fixed `'[redacted]'`; `message`,
    `logentry`, `request`, `breadcrumbs`, `extra` and `contexts` removed; each stack frame's
    `vars`, `pre_context`, `context_line` and `post_context` removed (source lines can embed
    literals). `beforeBreadcrumb` returns `null` so none are recorded in the first place.
  - `applyCrashDiagnosticsConsent` keeps its current shape.
- **Tests first:** off → null; on → user kept but text stripped; absent → user and text stripped;
  a message containing `"weight 82.4 kg"` never survives anywhere in the serialized event; stack
  frame function/file/line preserved; unknown tag value treated as absent.

### G2 — CI token least privilege
- `.github/workflows/ci.yml`: top-level `permissions: contents: read`, after checking no step
  needs more. Verified by the PR's own CI run passing.

### G3 — Leaderboard board cache eviction
- `apps/api/src/leaderboards/leaderboards.service.ts`: in `cachedCityAthletes`, before `set`,
  sweep entries whose `expiresAt <= now`.
- **Test first** (service spec, fake repository): fill boards for several past windows, advance
  `now` past the TTL, request one board → only live keys remain.

### G4 — Delete the flaky timing tests
- Remove the two `timing:` tests in `apps/api/src/nutrition/nutrition.repository.spec.ts`
  (around lines 729-775); note on the query-count tests that they are the guard.

### G5 — Batch food lookup (L9a-5)
- **Contract** (`packages/contracts`): extend the `GET /nutrition/foods` query schema with `ids`
  (comma-separated UUIDs, 1-100, deduplicated), mutually exclusive with `q`; response is the
  existing `FoodListResponse`. Additive (rule 7).
- **API:** controller branches on `ids`; `NutritionRepository.getFoodsByIds(viewer, ids)` — one
  query for the foods and one for their servings, with **the same visibility rule as
  `getFoodById`** (another user's custom food is simply absent). Order follows the request.
- **Tests first:** repository (visibility, order, missing ids omitted, bounded query count),
  controller/schema (both `q` and `ids` → 400, > 100 → 400, bad UUID → 400).
- **Mobile:** `getFoods(ids)` in `apiClient.ts` (chunked at 100); `nutrition.tsx`,
  `nutrition-share.tsx` and `edit-meal.tsx` switch from `Promise.all(getFood)` to it.

### G6 — Run follow-ups (mobile, no UI change)
- **Leftover snapshot:** in the finish path of `use-run-session.ts`, run `enqueueSessionUpload`
  and `clearRunSnapshot` inside one `db.withTransactionAsync` (both live in
  `openWorkoutSessionDb`). Test first: a clear that fails leaves nothing queued.
- **Route rebuilt every second:** compute the route in its own `useMemo` keyed on the fixes, so
  the 1 s clock tick no longer rebuilds it. Test: same array identity across ticks with no new fix.
- **Remove `run_points`:** delete its functions and add an append-only on-phone migration step
  `DROP TABLE IF EXISTS run_points` (never edit a shipped step).
- Update `live-run-plan.md` Follow-ups and the roadmap's known gaps.

### G7 — Phase 12 decisions, drafted (docs only, status **Proposed**)
- ADR-059 background run tracking, ADR-060 push transport, ADR-061 what a notification may say,
  ADR-062 widgets on both platforms. Each **Proposed**, for the owner to accept or change.
- **Spike for ADR-059** (evidence only): in a scratch copy, configure `expo-location` with the
  foreground service on and background location off, add `expo-task-manager`, run
  `expo prebuild --platform android`, and read the generated `AndroidManifest.xml` for
  `ACCESS_BACKGROUND_LOCATION` and `foregroundServiceType`. Record versions and manifest lines.
- 12A-12C implementation starts only after the owner accepts ADR-059.

## Not in this plan (needs the owner)
Health Connect fixes (rule 16: device before merge); anything with UI (replica first: miles, the
run share card, readiness baseline surfacing, a "discard failed" message); the website's Waitlist
privacy section (legal copy).

## Order
G2 + G4 (tiny) → G1 → G3 → G6 → G5 → G7. After each code merge: watch the run on `main`.
