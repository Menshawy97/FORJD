# FORJD whole-repo audit — 2026-09-10 (completed 2026-09-12)

Multi-agent read-only review, 17 of 17 scoped audits now complete. Nothing was edited.
Cross-corroboration is noted where two independent agents found the same issue.

---

## CRITICAL

### C1 — No account-deletion path exists; health data is never erasable
Found independently by the privacy and database agents.
- No `DELETE /users/me`, no erasure service, no `db.delete(users)` anywhere.
- Health observations, body scans, nutrition logs, profile, and WHOOP tokens persist forever.
- DB cascades are wired, but nothing deletes the parent row. InBody scan photos in Supabase
  Storage have no FK and are never removed even if rows cascade.
- Fails Apple Guideline 5.1.1(v) (in-app account deletion), GDPR Art. 17 (erasure).
- Fix: authenticated `DELETE /users/me` that removes storage objects (scan photos, avatars)
  AND the user row, revokes + deletes WHOOP tokens, with a test asserting no orphan survives.

### C2 — AI consent not enforced before an InBody scan image is sent to OpenAI
`apps/api/src/body/body.service.ts:51-53`, `body.controller.ts:31-35`.
- `body.service.extract()` sends the scan image to OpenAI vision with no read of privacy settings.
- The `aiFeaturesConsent` flag and its audit logging are fully built but never checked on this path.
- Health data (a scan of an identifiable person) leaves to a third-party LLM regardless of consent.
- Fix: read privacy settings in the extract path, reject with 403 when consent is false; add a test.

### C3 — Finished workouts silently lost after 5 failed sync attempts
`apps/mobile/src/store/workout-session.ts:372,384-395`; found by the silent-failure and offline agents.
- After `MAX_ATTEMPTS` (5) a queued session is set `status='failed'` and every later drain skips it.
- Nothing in the app ever reads the `failed` state — no banner, no retry, no report. Workout gone forever.
- The user was told "will sync when you're back online." That promise silently becomes false.
- Worse: the catch treats a permanent 4xx (contract drift, bad payload) the same as a transient
  offline error, so a deterministic rejection burns all 5 attempts in seconds and strands every
  finished session hitting that bug.
- Fix: give `failed` rows a read path + user-visible retry; classify non-retriable (4xx) vs
  retriable so a permanent failure surfaces immediately instead of after 5 silent tries.

---

## HIGH

### H1 — WHOOP disconnect neither revokes the grant nor deletes stored tokens
`apps/api/src/integrations/whoop/whoop.provider.ts:63-65`, `whoop-connection.repository.ts:135-140`.
- `disconnect()` only flips status to `disconnected`; encrypted access/refresh tokens stay intact
  and the grant stays live on WHOOP's side. Fix: call WHOOP revoke, then null/delete the tokens.

### H2 — No data-export path
- `GET /users/me` returns profile + privacy only; no export of observations, scans, nutrition.
- Fails GDPR Art. 15 (access) / Art. 20 (portability). Fix: authenticated full-export endpoint.

### H3 — Body-scan write is a non-transactional multi-write → orphaned scans
`apps/api/src/body/body.repository.ts:46-71`.
- `insert(bodyScans)` then a separate `insert(bodyMeasurements)`, no transaction, after the photo
  is already uploaded. A crash between them leaves a scan row + storage photo with zero measurements,
  unrecoverable (vision extraction is not re-run). Fix: wrap both in `db.transaction`.

### H4 — Unbounded full-history load of `health_observations` on every read
`apps/api/src/health-data/health-data.repository.ts:94-95`.
- `getObservationsForUser` is `SELECT * WHERE user_id = ?` with no LIMIT, metric, or time filter.
  Series and readiness both pull the user's entire history into Node memory; readiness needs only a
  trailing window. The `(user_id, metric_type, start_time)` index is never used. Latency/memory grow
  without bound. Fix: push a bounded window (metric + `start_time >= now() - interval`) into SQL.

### H5 — Same WHOOP account can link to two users → webhook health misroute
`external-connections.schema.ts:74-81` (no unique on `external_user_id`); `whoop-connection.repository.ts:55-62`.
- No constraint stops two FORJD users connecting the same WHOOP account. `findByExternalUserId` takes
  an arbitrary matching row, so one WHOOP user's data can ingest into the wrong FORJD account.
- Fix: partial unique index on `(provider, external_user_id)`, reject the second link, add `.limit(1)`.

### H6 — Finish-session enqueue in an uncaught fire-and-forget IIFE
`apps/mobile/src/app/live.tsx:567-577` (and start-snapshot `:231-235`).
- If `enqueueSessionUpload` throws (SQLite error), the session is never queued, the screen has already
  navigated to workout-done, and the loss is silent — plus an unhandled promise rejection. If `db` is
  null the finished session is silently dropped from sync entirely.
- Fix: wrap both IIFEs in try/catch; surface the "not saved" state; only transition after enqueue is durable.

### H7 — One denied Health Connect record type aborts the whole sync
`apps/mobile/src/integrations/health/health-connect.provider.ts:116-130`.
- `sync()` loops record types with no per-type try/catch; one revoked/denied permission rejects and
  discards every observation already collected. A user who granted HR but not sleep gets zero data.
- Fix: try/catch per record type, collect what succeeds, report per-metric failures.

### H8 — CI domain-purity check is defeated by the codebase's own quote style
`scripts/ci/check-architecture-conformance.sh:116`; found by the supply-chain and architecture agents.
- The rules 1-2 guard greps `from '...'` (single quote only), but `packages/domain` is mostly
  double-quoted and prettier's quote rule is NOT enforced in CI. A domain file adding
  `import { createClient } from "@supabase/supabase-js"` passes CI green. The allow-list also omits
  `openai`, `drizzle-orm`, `pg`, `@sentry/*`, `axios`. The flagship "enforced, not just stated" rule
  does not fire. Fix: `['\"]` quote-agnostic pattern + broaden the module list.

### H9 — `apps/api/src/body/` is 0% unit-covered (health-data storage)
- `body.service.ts`, `body.repository.ts`, `body.controller.ts` have no unit tests; only an e2e spec
  that needs Postgres and did not run. A scan saved under the wrong user would fail no unit test.
- Fix: `body.service.spec.ts` asserting ownership scoping on store and compare.

### H10 — Untested set-expansion feeding the synced session
`apps/mobile/src/workouts/start-session.ts` — `toLiveExercise` (defaults, `setCount` handling) has no test.
A time exercise silently getting `reps:10` instead of a duration would ship. Fix: dedicated unit tests.

### H11 — All 11 API controllers 0% unit-covered
Route authorization correctness rides entirely on e2e specs that need Postgres (unrun here). Fix: fast
controller specs with a mocked service, or a CI-runnable DB container.

---

## MEDIUM

- **Coverage gates contradict the 80% law.** `apps/api` global gate is 43/47/35/44%; domain, contracts,
  and mobile have no coverage config at all — the law is unmeasured on 3 of 4 packages.
- **Vision client has no request timeout** (`openai-vision-client.ts:13-15`, `nvidia-vision-client.ts:14-16`)
  — a hung vendor can occupy a request handler for minutes (WHOOP caps every call at 10s). Also retries
  non-retryable 4xx. Fix: `timeout: 30_000`, `maxRetries: 0`.
- **AI vision endpoints have only the global 60/min rate limit** (`body.controller.ts:31,43`) — cost-exhaustion
  on a free-tier budget (~86k billable inferences/day/account). Fix: tight per-route `@Throttle`.
- **Unbounded arrays in write DTOs** (`packages/contracts/src/index.ts`: health observations, workout sets/
  exercises, saved-meal items) — backstopped only by the framework's ~100kb body default, not an explicit cap.
- **Unvalidated physical ranges.** `value: z.number()` with no bounds feeds `Math.log(0) = -Infinity` in
  readiness → NaN score (`readiness.ts:97`). Body-scan (5000 kg), workout (reps 10000), and food (900000 kcal)
  values are accepted and corrupt aggregates from one bad row. Fix: per-metric bounds at the contract boundary.
- **1RM formula doc/code mismatch** (`packages/domain/src/training-calculations.ts:12` vs `:50`) — docblock
  claims standard Epley, code uses a `reps-1` variant (~3% low). Relabel or correct.
- **API bootstrap hardening** (`main.ts`, `app.module.ts`): no `helmet()`, no env-var validation schema
  (empty Supabase/OpenAI keys fail open at first request, not at boot), no global `ValidationPipe` safety net.
- **Blank-on-error screens** (`scan/[id].tsx:27`, `inbody-compare.tsx:41`, `(tabs)/index.tsx:81`) — catch to
  null and render an empty screen indistinguishable from "no data", no retry. Sibling screens do this right.
- **SQLite stores have no schema versioning/migration** (`workout-session.ts:39-71`, `exercise-catalogue.ts:66-91`)
  — a future column change silently breaks sync on upgraded devices while passing fresh-DB tests.
- **Concurrent sync-drain race** (`workout-session.ts:362-399`) — no mutex; two drains lose-update the attempt
  counter. Idempotent upload limits the damage but muddies retry accounting.
- **Conformance script gaps** beyond H8: rule 15 is claimed in the header but not enforced (no analytics/ads
  grep); subpath imports (`openai/resources`, `@supabase/postgrest-js`, `rnhc/lib/...`) evade the quoted checks;
  a renamed/deleted target dir passes vacuously; GitHub Actions pinned to mutable tags not SHAs.
- **`setup-windows-dev.ps1:13-15` disables Windows Defender** on the repo dir silently — exactly where a
  malicious postinstall would land. Make opt-in or drop.
- **InBody scan photos orphaned in storage** — `StorageProvider.delete` exists but is never called for scans.
- **Mobile route-tree test suites are flaky by construction** (30s renderRouter timeouts) + one real
  post-teardown import leak in `privacy-navigation-location.test.tsx`. A real regression can hide in the noise.

---

## LOW / config to confirm

- **RLS is absent on every table** (ADR-008 design) — but ADR-008:91 and `security.md:18` claim RLS exists as
  defense-in-depth. It does not, and the app's DB role would bypass it anyway. Authorization via guards is
  genuinely correct (no live rule-12 violation), but a forgotten guard has zero SQL backstop. Reconcile doc vs code.
- **WHOOP webhook returns 500 not 401 when its secret is unset** (`whoop.controller.ts:162`, `getOrThrow`) —
  anonymous-reachable error path. Use `config.get(..., "")` then `UnauthorizedException`.
- **CORS reflects any origin** (`cors.ts:17`) — safe today (Bearer auth, no cookies, `credentials` off) and
  test-pinned, but a trap the day cookies or `credentials:true` are added.
- **`supabase/config.toml`**: `enable_confirmations=false`, 6-char password min. Confirm whether this reaches
  the hosted project (pushed vs dashboard-managed). If it governs prod, turn confirmations on, raise the floor.
- **docker-compose** binds Postgres/Redis to 0.0.0.0; Redis has no auth. Bind to loopback. API image runs as
  root (add `USER node`); `.dockerignore` env patterns miss nested files (use `**/.env`).
- **Missing FK indexes** (`nutrition_log_entries.food_id`, `goals.user_id`, others) and N+1 in food search /
  saved meals (`nutrition.repository.ts:291-315`). Prioritize `nutrition_log_entries(food_id)`.
- **`packages/contracts/src/index.ts` is ~1878 lines** (limit 800) — split per bounded context.
- **iOS `NSPhotoLibraryUsageDescription` missing**; `eas.json` prod API URL still a `REPLACE_WITH_...` placeholder.
- **`pnpm audit`: 74 findings (1 critical, 51 high)** — all in dev/build tooling (`eas-cli`), none on the API
  request path. Low urgency; clear with overrides.

---

## Verified clean (checked and correct)

- **Rule 15 holds structurally.** No analytics, crash, ads, attribution, or session-replay SDK in the mobile
  app; no `console.log` in mobile production code; API Sentry has `sendDefaultPii:false`, bodies unlogged, user
  scrubbed without consent (fails closed). Suggested defense-in-depth: a `beforeSend` that also strips request bodies.
- **No IDOR, SQL injection, mass-assignment, or missing-auth** on API endpoints — every id-bearing route is
  user-scoped in the query itself; raw SQL binds parameters; DTOs strip unknown keys.
- **Auth core is sound** — JWT signature verified with pinned algorithms (no `alg:none`), AES-256-GCM tokens
  with per-message IV, WHOOP OAuth `state` + TTL, HMAC webhook with timing-safe compare and replay window.
- **Domain package is genuinely pure** — no UI/SDK/HTTP/ORM imports, no hidden clock/RNG; core unit conversions
  and readiness statistics are correct; `HealthObservation` makes a source-less observation unrepresentable.
- **Rule 10 (source preservation)** — upsert key includes `source`; one provider cannot overwrite another's row.
- **Rule 6 (offline)** — the live workout critical path awaits no network call; sync is post-finish and queued.
- **Rules 3, 4, 7, 11, 13, 14, 17 conformant.** Domain/contracts test suites green (335 tests); token cipher,
  auth guards, WHOOP services, and the InBody parser at 100% with real behavioural assertions.

---

---

## HIGH (accessibility, performance, type design — added 2026-09-12)

### H12 — Live-workout timers give zero screen-reader feedback
`apps/mobile/src/workouts/countdown-ring.tsx`, `rest.tsx`, `set-timer.tsx`.
- The rest and set timers render a countdown as plain `<Text>` with no `accessibilityLiveRegion`
  or `announceForAccessibility` call anywhere in the app (repo-wide grep: zero matches). A blind
  athlete gets no spoken countdown, no "time's up" — a core flow is unusable without sight.
- Same gap on the "not saving — this session may be lost" data-loss warning and set-completion
  toasts in `live.tsx` and `components/toast.tsx` — the single most safety-critical message in
  the app is visual-only.
- Fix: `accessibilityLiveRegion="polite"` + coarse-interval `announceForAccessibility` (not every
  250ms tick) on the countdown; same treatment for the toast component.

### H13 — CTA text fails WCAG contrast on every primary button
`apps/mobile/src/theme/tokens.ts`. White `onAccent` (#FFFFFF) on `accent` (#E9712F) = 3.06:1,
needs 4.5:1. Affects Finish, Complete Set, Log In, Save Changes — every primary CTA in the app.
Also `dimmer` (3.70:1), `tabInactive` (3.55:1), and `label` (4.22:1) fail against the screen
background app-wide. Fix: darken `accent` for button fills, or use near-black button text;
lighten the three failing text tokens to clear 4.5:1.

### H14 — No API response compression; full exercise catalogue re-downloaded every launch
`apps/api/src/main.ts` has no `compression()` middleware — every JSON response, including the
~1,700-row exercise catalogue, ships uncompressed (gzip typically cuts JSON 70-85%, a direct
egress cost on free-tier infrastructure). Compounding: `apps/mobile/src/store/exercise-catalogue.ts:129`
downloads the full catalogue body unconditionally on every app launch with no ETag/version-check
short-circuit. Fix: `app.use(compression())`; add a conditional-request check keyed on catalogue version.

### H15 — Rest/set-timer screens re-render at 4Hz for the full timer duration
`apps/mobile/src/app/rest.tsx:53-55`, `set-timer.tsx:51-55` tick every 250ms via `setState`,
re-rendering the screen and an SVG ring on the JS thread ~1,400-2,900 times per workout. The
live-workout elapsed clock correctly ticks at 1Hz for exactly this reason (`live.tsx:296-316`) —
copy that pattern, or move the ring onto a Reanimated shared value.

### H16 — Workout block types are a flat interface, not a checked discriminated union
`packages/domain/src/workout-vocabulary.ts:205-222`. Only `straight_sets` is implemented today,
so exhaustiveness is untestable — flagging as an open risk for whichever phase adds
`interval`/`amrap`/`superset`: there is no `never`-exhaustiveness guard to catch a missed handler.
Related: `WorkoutExercise`/`WorkoutSet` can carry `targetWeightKg`, `targetDistanceMeters`, and
`targetSeconds` simultaneously with no cross-field check in the contract schema (documented,
deferred-by-design; unverified whether a runtime service-layer check exists).

---

## MEDIUM (added 2026-09-12)

- **`live.tsx` (1270 lines) and `nutrition.tsx` (~810 lines) exceed the 800-line file cap**,
  each dominated by one 600-1100 line function. Extract sub-components (rest-timer overlay,
  set-row list, meal sheets) per the established pattern already used for `previous-workout-card.tsx`.
- **`apps/api/src/workouts/workouts.repository.ts` (1226 lines)** mixes template CRUD, session
  CRUD, and free-standing calendar utilities in one class — split into two repositories + a
  shared calendar-utils module.
- **`library.tsx`'s `SectionList`** uses an inline `renderItem` (re-created every render) with
  no `getItemLayout` on a ~1,700-row fixed-height list — a single favourite toggle re-renders
  every visible row. Wrap in `useCallback`, add `getItemLayout`.
- **Dozens of raw-SQL `db.execute<...>()` calls in `progress.repository.ts`** assert row shape
  from the driver with no validation — a silent column rename produces wrong Progress-tab numbers
  with no compiler signal. Same root cause across ~10 call sites; one Zod-validation wrapper fixes all.
- **`apps/mobile/tsconfig.json` omits `noUncheckedIndexedAccess`**, which `apps/api`, `packages/domain`,
  and `packages/contracts` all enable via `tsconfig.base.json`. The one platform that must tolerate
  offline/degraded state has the weaker compile-time array-access guard.
- **9 mobile screens suppress `react-hooks/exhaustive-deps` with no inline justification** — contrast
  the API side, which documents every lint-disable. Worth a pass to confirm each is deliberate.
- **Analytics pipeline (raw→normalized→aggregated→derived→insight) is prose-only**, by a documented
  ADR-029 decision to compute on read rather than persist staged types — not a defect, but rule 9
  ("never mutate an aggregate") is currently vacuous since nothing is persisted to mutate.
- **A handful of Expo dependencies appear unused** (`expo-glass-effect`, `expo-symbols`, `expo-device`,
  `@testing-library/jest-native`) — ask before removing; may be intentional Phase 11 iOS scaffolding
  per prior precedent in this repo (a past cleanup used the same "imported by nothing" criterion).
- **Two phantom-dependency gaps** (low severity, don't break today): `express` types used in
  `apps/api` guard/controller files with no direct `express` dependency declared (covered incidentally
  by `@types/express`); `eslint-plugin-react-hooks` used in `apps/mobile/eslint.config.mjs` but only
  declared in the monorepo root, resolving via Node's directory walk-up rather than the package's own manifest.

---

## Verified clean (added 2026-09-12)

- **No project-specific native-device hazards found anywhere in scope.** The `transform: cond ? [...] : undefined`
  Fabric-crash pattern and inline-style-on-Pressable pattern are both correctly avoided everywhere,
  every bottom sheet with a text input wraps in `KeyboardAvoidingView`, and every timer/effect has
  correct cleanup with no setState-after-unmount.
- **No dead code, no drifted duplicate logic.** Zero TODO/FIXME/HACK markers and zero stray
  `console.*` calls repository-wide. Unit conversion, date-boundary math, and the training-volume
  formula are each single-sourced or intentionally-duplicated-and-consistent between API and mobile.
- **Provider abstraction (`HealthProvider`/`AuthProvider`/`StorageProvider`) is the strongest of the
  four flagship designs** — genuinely enforced, with two independent implementations passing one
  shared contract test suite.
- **Per-item accessibility labeling and toggle/tab semantics are unusually thorough** where present —
  the accessibility gaps found are entirely about status-message announcements and contrast, not
  missing labels.
