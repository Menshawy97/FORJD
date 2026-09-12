# Audit remediation — plan

Fixes every finding in [`docs/reviews/2026-09-10-whole-repo-audit.md`](../reviews/2026-09-10-whole-repo-audit.md)
(3 critical, 16 high, ~25 medium, ~9 low), in severity order, test-first throughout.

## Context

The audit was a 17-agent read-only review completed 2026-09-12 against `main` at `d5643da`
(Phase 7 complete). Nothing was edited during it. This document turns those findings into
executable slices; it does not re-argue them.

### Decisions confirmed with the user (2026-09-12)

1. **Scope is everything, in severity order.** No finding is dropped. Low-severity and
   config items get smaller slices, not silence.
2. **Account deletion (C1) and data export (H2) get built now**, not deferred to the Phase 8
   privacy slice. Deletion is an Apple 5.1.1(v) and GDPR Art. 17 blocker — nothing reaches a
   tester without it — and building it here unblocks Phase 8 rather than duplicating it.
3. **The CTA contrast fix (H13) stops before any colour changes.** The accent orange came from
   the design, and design fidelity on this project is exact. Slice R19 produces rendered
   before/after samples against the screenshots and returns to the user for a decision. The
   three failing *text* tokens (`dimmer`, `tabInactive`, `label`) are not brand colours and are
   fixed without asking.

### One correction to the audit's framing

The audit repeatedly describes the API e2e suites as "needing Postgres and did not run."
That is true of the audit sandbox, not of CI: `.github/workflows/ci.yml` runs a
`postgres:16-alpine` service, applies migrations, and runs `pnpm --filter @forjd/api test:e2e`
serially on every pull request and every push to `main`. So route authorization **is** exercised
in CI today. H9 and H11 remain real — a unit test that runs in 20 ms is a different tool from a
90-second e2e boot, and the coverage gate counts only unit tests — but they are test-speed and
coverage-gate debt, not "authorization is unverified."

### Method

Every slice below is strict TDD, per `.claude/rules/ecc/common/testing.md`:

1. **RED** — write the named test, run it, paste the failure into the pull-request body. A test
   that passes before the fix is not a test of the fix; rewrite it.
2. **GREEN** — the smallest change that passes.
3. **REFACTOR** — tidy under a green suite.
4. **VERIFY** — `pnpm --filter <pkg> test` (or `test:cov` where a gate is involved), `lint`,
   `pnpm -r build`, plus `bash scripts/ci/check-architecture-conformance.sh`.
5. **CHECKPOINT** — one pull request per slice, merged, then confirm the run on `main` is green
   (`gh run list --branch main`, `gh run watch <id>`) before starting the next.

Slices are ordered so each lands on a green `main`. Where two slices touch the same file, the
dependency is called out.

### Test placement conventions already in this repo

| Package | Runner | Unit tests | Integration/e2e |
|---|---|---|---|
| `apps/api` | jest, `rootDir: src`, `*.spec.ts` | beside the source file | `apps/api/test/*.e2e-spec.ts`, real Postgres |
| `apps/mobile` | jest-expo | `src/**/*.test.ts(x)` | route-tree tests via `renderRouter` |
| `packages/domain` | jest | beside the source file | n/a |
| `packages/contracts` | jest | beside the source file | committed fixtures, diffed in CI |

---

# Stream 1 — Data loss, consent, erasure (critical)

## R1 — Finished workouts are no longer silently lost (C3 + H6 + drain race)

The worst finding. After five failed uploads a finished session is marked `failed`, every later
drain skips it, and nothing in the app ever reads that state. A deterministic 4xx burns all five
attempts in seconds.

**RED — `apps/mobile/src/store/workout-session.test.ts`**

- `drainSyncQueue` marks a row `failed` immediately, on attempt 1, when the upload rejects with
  a non-retriable error (a 4xx other than 408/429), instead of consuming five attempts.
- `drainSyncQueue` keeps a row `pending` and schedules a backoff when the upload rejects with a
  network error or a 5xx.
- A new `getFailedSessions(db)` returns rows with `status='failed'` together with `lastError`.
- A new `retryFailedSession(db, sessionId)` resets `status='pending'`, `attempt_count=0` and
  `next_retry_at` to now, so the next drain picks it up.
- Two overlapping `drainSyncQueue` calls on the same failing row produce `attempt_count = 2`,
  not 1 — the lost-update race the audit flagged.

**RED — `apps/mobile/src/app/live.test.tsx`**

- When `enqueueSessionUpload` rejects, the Finish handler does **not** navigate to workout-done,
  and surfaces the "not saved" state instead.
- When `db` is null at finish time, the same path is taken rather than dropping the session.
- The start-of-session snapshot at `live.tsx:231` handles its own failure with no unhandled
  promise rejection.

**RED — the home surface's test**

- With one `failed` row in the queue, a banner naming the lost workout and a retry control
  render. Tapping retry calls `retryFailedSession` then `drainSyncQueue`.

**GREEN**

- Add an error classifier to the sync module. The injected `uploadSession` currently rejects
  with an opaque `Error`; give it a typed rejection carrying `status` so the store can classify
  without importing the API client — preserving the injection seam that makes this module
  testable with no running server.
- `drainSyncQueue`: on catch, branch on retriability. Non-retriable becomes `failed` at once;
  retriable keeps the existing backoff up to `MAX_ATTEMPTS`.
- Serialize drains with a module-level in-flight promise. JavaScript is single-threaded here, so
  the mutex is one `let inFlight: Promise<…> | null`.
- Add `getFailedSessions` and `retryFailedSession`.
- `live.tsx`: replace both bare immediately-invoked async functions with `try`/`catch`; navigate
  only after the enqueue resolves; on failure show the data-loss warning.
- Add the failed-sync banner to the home surface.

**Note for R18:** the "this session may be lost" warning is the most safety-critical message in
the app and is visual-only. R1 writes it; R18 makes it announce.

## R1b — One denied Health Connect permission no longer discards the whole sync (H7)

Folded into this stream rather than given its own slice, since it is a single function.
`health-connect.provider.ts:116-130` loops record types with no per-type `try`/`catch`: one
revoked permission rejects and discards every observation already collected, so a user who
granted heart rate but not sleep gets zero data.

**RED — `apps/mobile/src/integrations/health/health-connect.provider.test.ts`** — with one record
type rejecting, `sync()` still returns the observations from every other type and reports the
failed metric. Runs against the existing fake, so no device is needed for the test; the Phase 6F
device walk stays owed per ADR-035 either way.

## R2 — AI consent is enforced before a scan image leaves the building (C2, plus two mediums)

`body.service.extract()` sends an identifiable person's health document to OpenAI without ever
reading `aiFeaturesConsent`. The flag and its audit log are fully built and simply not consulted.

**RED — `apps/api/src/body/body.service.spec.ts`** (new file; also the start of H9)

- `extract()` throws `ForbiddenException` and **never calls** `visionProvider.extractBodyScan`
  when `PrivacyService.get()` returns `aiFeaturesConsent: false`.
- `extract()` proceeds when consent is true.
- `confirm()` is gated the same way — the image is re-uploaded and re-encoded there.
- The consent read happens before `reencode`, so a non-consenting user's image is never decoded.

**RED — `apps/api/test/body.e2e-spec.ts`**

- `POST /body/scans/extract` returns 403 for a user whose consent is off, with no vision call.

**RED — `apps/api/src/ai/providers/openai-vision-client.spec.ts`**

- The OpenAI client is constructed with `timeout: 30_000` and `maxRetries: 0`. The same
  assertion for `nvidia-vision-client.ts`. A hung vendor currently occupies a request handler
  for minutes, and retries are attempted on non-retryable 4xx responses.

**RED — `apps/api/test/body.e2e-spec.ts`**

- The two vision routes carry a tighter per-route throttle than the global 60 per minute, which
  today permits roughly 86,000 billable inferences a day per account.

**GREEN**

- Inject `PrivacyService` into `BodyService`; `BodyModule` imports `UsersModule`, which already
  exports it. `extract()` gains the `user` argument the controller already holds.
- Throw `ForbiddenException` with a message the client can act on, matching the fail-closed
  posture Sentry already uses for unconsented user data.
- `timeout: 30_000, maxRetries: 0` on both vision clients. WHOOP already caps every call at ten
  seconds; this brings vision into line.
- `@Throttle` on both vision routes.

## R3 — `DELETE /users/me` actually erases everything (C1)

Health observations, body scans, nutrition logs, profile and WHOOP tokens persist forever.
Cascades are wired but nothing ever deletes the parent row, and Supabase Storage objects have no
foreign key at all.

**RED — `apps/api/src/users/account-deletion.service.spec.ts`** (new)

- Deletes every storage object for the user: each InBody scan key **and** the avatar. Asserts
  the exact keys passed to `StorageProvider.delete`.
- Revokes the WHOOP grant and deletes the stored tokens before deleting the user row.
- Deletes the user row last, so a crash mid-way leaves a user who can retry rather than an
  orphaned data set with no owner.
- A storage failure does not abort the row deletion. It is logged and the run continues. Leaving
  an account undeletable because one object returned 404 is the worse outcome.
- Is idempotent: a second call on an already-deleted user does not throw.

**RED — `apps/api/test/users-deletion.e2e-spec.ts`** (new, real Postgres)

- The orphan assertion the audit asked for. Seed a user with a body scan and measurements,
  health observations, nutrition log entries, a workout template and session, a program
  enrolment, a privacy row and an external connection. Call `DELETE /users/me`, then assert
  **zero** rows remain for that user id in every one of those tables. Written as a table-driven
  loop over the schema, so a future table added without a cascade fails this test.
- A second user's data is untouched.
- Unauthenticated `DELETE /users/me` is 401.

**GREEN**

- `AccountDeletionService` in `apps/api/src/users/`, orchestrating: list scan keys, delete
  storage objects, revoke and delete WHOOP tokens, then `db.delete(users)` inside a transaction.
- `DELETE /users/me` on `UsersController`, behind `JwtAuthGuard`.
- Verify every child table's foreign key is `ON DELETE CASCADE`; add a versioned migration for
  any that is not. The e2e loop above is what proves it.
- A "Delete account" entry in mobile Settings with a typed confirmation, since Apple requires it
  be reachable in-app. A route test asserts it exists and calls the endpoint.

**Dependency:** the WHOOP revoke helper is shared with R5. Build it here; R5 reuses it.

## R4 — `GET /users/me/export` (H2)

GDPR Art. 15 and 20. `GET /users/me` returns profile and privacy only.

**RED — `apps/api/src/users/account-export.service.spec.ts`**

- The export contains observations, body scans with measurements, nutrition logs, workout
  templates and sessions, programs, privacy settings and connections.
- Every health observation retains its `source`, so rule 10 survives the export.
- No other user's rows appear.
- Encrypted WHOOP tokens are **excluded**. An export is a copy of the user's data, not of our
  key material.

**RED — `apps/api/test/users-export.e2e-spec.ts`** — 200 with a body matching a new contract
schema; 401 unauthenticated.

**GREEN** — `AccountExportService`, a versioned `accountExportSchema` in `packages/contracts`
with a committed fixture so the CI fixture-diff gate covers it, and the route. Mobile gets an
"Export my data" action that shares the file through `expo-sharing`.

---

# Stream 2 — API correctness and hardening

## R5 — WHOOP disconnect revokes and wipes (H1)

`disconnect()` flips a status column. The grant stays live at WHOOP and the encrypted tokens
stay in the row.

**RED — `apps/api/src/integrations/whoop/whoop.provider.spec.ts`**

- `disconnect()` calls WHOOP's revoke endpoint with the stored access token.
- It then nulls `encrypted_access_token`, `encrypted_refresh_token`, `expires_at` and `scopes`.
- A revoke that fails still wipes the local tokens. The user asked to disconnect, and keeping
  tokens because a vendor call failed is the wrong trade.
- Ordering: revoke before wipe, since the wipe destroys the token the revoke needs.

**GREEN** — `revokeGrant` on `WhoopClient` (shared with R3) and `clearTokens(userId)` on
`WhoopConnectionRepository`.

## R6 — One WHOOP account cannot link to two FORJD users (H5)

No unique constraint on `external_user_id`, and `findByExternalUserId` takes an arbitrary
matching row — so a webhook can ingest one person's health data into another person's account.

**RED — `apps/api/src/integrations/whoop/whoop-connection.repository.spec.ts`**

- Inserting a second connection with the same `(provider, external_user_id)` is rejected.
- `findByExternalUserId` applies `.limit(1)` and is deterministic.

**RED — `apps/api/test/whoop.e2e-spec.ts`**

- A second user completing OAuth against an already-linked WHOOP account gets 409, and the first
  user's connection is unchanged.

**GREEN** — a partial unique index on `(provider, external_user_id) WHERE external_user_id IS NOT
NULL`, as a drizzle-kit migration committed to the repo (rule 14), plus `.limit(1)` and a
`ConflictException` mapped from the constraint violation.

## R7 — Body-scan write is one transaction (H3)

`insert(bodyScans)` then a separate `insert(bodyMeasurements)`, after the photo is already
uploaded. A crash between them leaves an unrecoverable scan, because vision extraction is not
re-run.

**RED — `apps/api/src/body/body.repository.spec.ts`**

- `createScan` runs both inserts inside `db.transaction`.
- When the measurements insert throws, no scan row remains.

**RED — `apps/api/test/body.e2e-spec.ts`** — no scan row exists with zero measurements after a
forced measurement-insert failure.

**GREEN** — wrap both writes in `db.transaction`.

## R8 — Health observations are read through a bounded window (H4)

`SELECT * WHERE user_id = ?` with no limit, metric or time filter. Series and readiness both pull
the user's entire history into Node memory. The `(user_id, metric_type, start_time)` index is
never used.

**RED — `apps/api/src/health-data/health-data.repository.spec.ts`**

- `getObservationsForUser` accepts `{ metricTypes, since, limit }` and pushes all three into SQL,
  asserted against the generated query rather than by filtering in JavaScript.
- Omitting the window is a type error, not a silent full scan. The signature makes the unbounded
  call unrepresentable.

**RED — the readiness spec**

- Readiness requests only its trailing baseline window, not all history.

**RED — `apps/api/test/health-data.e2e-spec.ts`** — the series endpoint honours its range
parameters and returns no observation outside them.

**GREEN** — the bounded signature, threaded through both call sites, with an `EXPLAIN` in the
pull-request body showing the index is now used.

## R9 — API bootstrap hardening and response compression (medium, H14 part 1)

No `helmet()`, no environment-variable validation schema (empty Supabase or OpenAI keys fail open
at the first request rather than at boot), no global `ValidationPipe` safety net, and no
`compression()` — so every JSON response, including the roughly 1,700-row exercise catalogue,
ships uncompressed on free-tier egress.

**RED — `apps/api/test/security-headers.e2e-spec.ts`**

- Responses carry the helmet header set.
- A large JSON response is gzipped when the client sends `Accept-Encoding: gzip`.
- Booting with `SUPABASE_SERVICE_ROLE_KEY` empty throws at startup naming the variable, rather
  than succeeding and failing at first use.
- A body with an unknown key is still stripped when a route forgets its `ZodValidationPipe`.

**GREEN** — `helmet()`, `compression()`, a `ConfigModule` validation schema covering every
`getOrThrow` variable in the tree, and a global `ValidationPipe({ whitelist: true })` behind the
existing Zod pipes.

The catalogue-ETag half of H14 is R20, since it is a mobile change.

## R10 — Physical ranges and array sizes are validated at the contract boundary (two mediums)

`value: z.number()` with no bounds feeds `Math.log(0) = -Infinity` into readiness and produces
`NaN` (`readiness.ts:97`). A 5000 kg body scan, 10,000 reps and 900,000 kcal are all accepted and
corrupt aggregates from a single bad row. Write DTO arrays are backstopped only by the framework's
roughly 100 kb body default.

**RED — `packages/contracts/src/*.spec.ts`**

- Per-metric bounds. Heart-rate variability, resting heart rate, heart rate, respiratory rate,
  sleep durations, body mass, body-fat percentage, reps, weight, distance, duration, kcal and
  macros each reject values outside a documented physiological range and accept the extremes of
  it.
- Zero is rejected for every metric that feeds a logarithm.
- Each write array (observations, workout sets, workout exercises, saved-meal items) has an
  explicit `.max()`, asserted at the boundary and one over it.

**RED — `packages/domain/src/readiness.spec.ts`** — a guard so that even if a bad value reaches
the calculation, the score is a number and never `NaN`.

**GREEN** — bounds in `packages/contracts`, sourced from published physiological ranges and
recorded in each schema's docblock with the citation. Anything clinically arguable goes to the
user before it ships. Regenerate fixtures; the CI fixture-diff gate is the review of the wire
change.

## R11 — Low-severity security and configuration batch

Small, independent, one pull request.

**RED**

- `apps/api/test/whoop.e2e-spec.ts` — the webhook returns **401**, not 500, when
  `WHOOP_WEBHOOK_SECRET` is unset. Today `getOrThrow` produces an anonymously reachable 500.
- `apps/api/src/cors.spec.ts` — a regression test pinning that `credentials` stays off while the
  origin is reflected, with a comment naming the day that combination becomes unsafe.

**GREEN**

- `config.get(…, "")` then `UnauthorizedException`.
- `docker-compose.yml`: bind Postgres and Redis to `127.0.0.1`, give Redis a password, add
  `USER node` to the API image, and change the `.dockerignore` env patterns to `**/.env` so
  nested files are covered.
- `scripts/setup-windows-dev.ps1:13-15` silently adds a Windows Defender exclusion for the repo
  directory, which is exactly where a malicious postinstall would land. Remove it; if it is kept,
  make it an explicit opt-in flag with a printed warning.
- `pnpm audit` reports 74 findings, one critical and 51 high, all in `eas-cli` build tooling and
  none on the API request path. Clear what resolves cleanly with `pnpm.overrides` and record the
  remainder with a written rationale.
- **Needs the user:** `supabase/config.toml` sets `enable_confirmations=false` and a six-character
  password minimum. Whether that file governs the hosted project or the dashboard does is a
  question only the user can answer. If it reaches production, confirmations go on and the floor
  goes up. The slice stops and asks rather than guessing.

---

# Stream 3 — Make the enforcement real

## R12 — The conformance check stops being defeated by a quote character (H8 and the script's gaps)

The flagship "enforced, not just stated" rule does not fire.
`scripts/ci/check-architecture-conformance.sh:116` greps `from '(@supabase/|@nestjs/|react|flutter)`
— single quotes only — while `packages/domain` is mostly double-quoted and prettier's quote rule
is not enforced in CI.

**RED — `scripts/ci/check-architecture-conformance.test.sh`** (new; the script has no tests today)

A fixture-driven harness that writes temporary files into a scratch tree and asserts the script
exits non-zero. Each case is a violation that passes CI green today:

- `import { createClient } from "@supabase/supabase-js"` inside `packages/domain`, with **double
  quotes**.
- A subpath import: `openai/resources`, `@supabase/postgrest-js`,
  `react-native-health-connect/lib/…`.
- Each module missing from the allow-list: `openai`, `drizzle-orm`, `pg`, `@sentry/*`, `axios`.
- An analytics or advertising SDK import in `apps/mobile`. Rule 15 is claimed in the script's own
  header and never actually enforced.
- A renamed or deleted guarded directory, which passes vacuously today. Assert the script fails
  loudly when a path it guards no longer exists.
- One passing case, so the harness can fail for the right reason.

**GREEN**

- Quote-agnostic `['\"]` patterns throughout, and prefix matching so subpaths are caught.
- Broaden the module list.
- A real rule-15 grep for analytics, crash-reporting, advertising, attribution and session-replay
  SDKs.
- Guarded-path existence assertions.
- Pin GitHub Actions to commit SHAs rather than mutable tags.
- Enforce prettier's quote rule in CI, so the two never diverge again. That is the deeper fix — a
  quote-agnostic pattern is a workaround for an unenforced style.

## R13 — The 80% law becomes measurable (medium)

`apps/api`'s global gate is 43/47/35/44 percent. `packages/domain`, `packages/contracts` and
`apps/mobile` have no coverage configuration at all, so the law is unmeasured on three of four
packages.

**GREEN** (no RED; this slice is the gate itself)

- Add `collectCoverageFrom` and thresholds to all three, set at the **currently measured** number,
  and run `test:cov` for each in CI. A gate set where the code is today is a ratchet; a gate set
  at 80 percent today is a red build nobody can land.
- Raise `apps/api`'s global gate to whatever R1–R12 and R14–R16 leave it at.
- Record the ratchet target here and revisit at the end of the stream.

---

# Stream 4 — Test debt

## R14 — `apps/api/src/body/` gets unit tests (H9)

Zero percent unit-covered, and it handles health data. R2 creates `body.service.spec.ts`; this
slice finishes the directory.

**RED**

- `body.service.spec.ts` — `store` and `compare` scope by `user.id`, and a scan belonging to
  another user is not found rather than returned.
- The photo re-encode rejects a disallowed MIME type and an oversized buffer.
- `body.repository.spec.ts` — every query carries the user-id predicate.
- `body.controller.spec.ts` — routes pass `request.user` through and never accept a user id from
  the body or the query string.

## R15 — `toLiveExercise` is tested (H10)

A time-based exercise silently getting `reps: 10` instead of a duration would ship today.

**RED — `apps/mobile/src/workouts/start-session.test.ts`**

- Each measure type — reps, time, distance — expands to the right set shape.
- `setCount` governs the number of sets; zero and absent are both handled.
- Defaults are applied only where the template is silent, never over an explicit target.
- The result round-trips into the payload `enqueueSessionUpload` sends.

## R16 — All eleven controllers get fast unit specs (H11)

**RED — a `*.controller.spec.ts` beside each controller**, with a mocked service. Each asserts
that the guard is applied, that the authenticated user is what reaches the service, that an id in
the path is never trusted without the user scope, and that the Zod pipe is bound to the right
schema. These run in milliseconds and catch a dropped `@UseGuards` that an e2e suite would only
catch if someone had written the matching cross-user case.

## R17 — The mobile route-tree suites stop being flaky by construction (medium)

Thirty-second `renderRouter` timeouts, plus one real post-teardown import leak in
`privacy-navigation-location.test.tsx`. A genuine regression can hide in that noise.

**RED** — run the mobile suite ten times and record the flake rate in the pull-request body as
the baseline.

**GREEN** — fix the import leak, replace fixed timeouts with `waitFor` on a real condition, and
extract the shared router harness. Re-run ten times and show zero flakes.

---

# Stream 5 — Accessibility and performance

## R18 — Timers and safety messages speak (H12)

A repository-wide grep finds zero `accessibilityLiveRegion` and zero `announceForAccessibility`.
A blind athlete gets no countdown and no "time's up", and the "this session may be lost" warning
R1 introduces is visual-only.

**RED — `countdown-ring.test.tsx`, `rest.test.tsx`, `set-timer.test.tsx`, `toast.test.tsx`**

- The countdown container carries `accessibilityLiveRegion="polite"`.
- `announceForAccessibility` fires on a coarse schedule — each of the last ten seconds, then
  every fifth second above that — not on every 250 ms tick. Assert the call count across a
  simulated 60-second countdown.
- "Time's up" is announced exactly once.
- The toast component announces its message, and the data-loss warning uses
  `accessibilityLiveRegion="assertive"`, the one place where interrupting is correct.

## R19 — Contrast (H13) — **stops for the user**

White `onAccent` on `accent` is 3.06:1 against a 4.5:1 requirement, affecting Finish, Complete
Set, Log In and Save Changes. `dimmer` (3.70:1), `tabInactive` (3.55:1) and `label` (4.22:1) also
fail app-wide.

**RED — `apps/mobile/src/theme/tokens.test.ts`** (new)

- A contrast-ratio function, itself tested against known WCAG pairs, asserts that every
  foreground and background token pair in use clears 4.5:1 for body text and 3:1 for large text
  and interface boundaries.
- The accent pair ships skipped, with a comment naming this slice. Asserting a value nobody has
  approved would be worse than a documented gap.

**GREEN, part 1 (no approval needed)** — lighten `dimmer`, `tabInactive` and `label` to clear
4.5:1, checked against the screenshots pixel by pixel.

**PAUSE, part 2** — render the two candidate treatments, a darker orange behind white text and
near-black text on the existing orange, side by side against the real screenshots, and put them
to the user. No brand colour changes without that answer.

## R20 — The exercise catalogue stops re-downloading every launch (H14 part 2)

`exercise-catalogue.ts:129` downloads the full body unconditionally on every app launch. R9 added
gzip; this stops the transfer entirely when nothing changed.

**RED — `apps/mobile/src/store/exercise-catalogue.test.ts`**

- With a stored catalogue version matching the server's, no full body is requested.
- With a changed version, the catalogue is fetched and replaced.
- A 304 is handled without clearing the local catalogue — the failure mode that would empty a
  user's library.

**RED — `apps/api/test/exercises.e2e-spec.ts`** — a conditional request against an unchanged
catalogue returns 304 with no body. The existing `catalogueVersion` hash is already the right
key, and the CI comment on suite serialization explains why it is stable.

## R21 — Timer screens stop re-rendering at 4 Hz (H15, plus `library.tsx`)

`rest.tsx:53-55` and `set-timer.tsx:51-55` tick every 250 ms through `setState`, re-rendering the
screen and an SVG ring on the JavaScript thread 1,400 to 2,900 times per workout. The live elapsed
clock already ticks at 1 Hz for exactly this reason (`live.tsx:296-316`).

**RED**

- `rest.test.tsx` and `set-timer.test.tsx` — across a simulated 60-second countdown the component
  renders about 60 times, not about 240. Assert with a render counter.
- `library.test.tsx` — toggling one favourite does not re-render every visible row. `renderItem`
  is referentially stable across renders, and `getItemLayout` is supplied on the fixed-height
  roughly 1,700-row list.

**GREEN** — 1 Hz `setState` for the displayed number, with the ring's sub-second motion on a
Reanimated shared value off the JavaScript thread. `useCallback` and `getItemLayout` on the
SectionList.

---

# Stream 6 — Maintainability and structure

## R22 — Workout block types become a checked union (H16)

`packages/domain/src/workout-vocabulary.ts:205-222` is a flat interface. Only `straight_sets`
exists, so exhaustiveness is untestable, and whichever phase adds `interval`, `amrap` or
`superset` has no `never` guard to catch a missed handler.

**RED — `packages/domain/src/workout-vocabulary.spec.ts`**

- A type-level test using `@ts-expect-error` proving that a new variant added to the union without
  a handler fails to compile.
- A runtime exhaustiveness helper throws on an unknown kind rather than silently doing nothing.

**RED — `packages/contracts`** — a workout set carrying `targetWeightKg`, `targetDistanceMeters`
and `targetSeconds` simultaneously is rejected. The audit left open whether a service-layer check
exists; this slice confirms it and, either way, puts the check at the boundary.

## R23 — Files over the 800-line cap get split (three mediums)

`live.tsx` (1,270 lines), `nutrition.tsx` (about 810), `workouts.repository.ts` (1,226) and
`packages/contracts/src/index.ts` (about 1,878). Each is dominated by one very large function or
one class doing three jobs.

These are pure refactors, so the discipline inverts: **the existing suites must stay green with no
test edits**. Any test that needs changing means behaviour moved, and that change gets its own RED
test first.

- `live.tsx` splits into a rest-timer overlay, a set-row list and a session header, following the
  `previous-workout-card.tsx` pattern already established here.
- `nutrition.tsx` splits into meal sheets, a day summary and an entry list.
- `workouts.repository.ts` splits into a template repository, a session repository and a shared
  calendar-utils module — whose free-standing calendar functions then get the direct unit tests
  they lack today.
- `packages/contracts/src/index.ts` splits into one module per bounded context, re-exported from
  `index.ts` so no consumer import changes. Fixtures must regenerate byte-identical, and the CI
  fixture-diff gate is the proof.

## R24 — Raw SQL row shapes are validated (medium)

Dozens of `db.execute<…>()` calls in `progress.repository.ts` assert row shape from the driver with
no validation. A silent column rename produces wrong numbers on the Progress tab with no compiler
signal, across roughly ten call sites with one root cause.

**RED — `apps/api/src/workouts/progress.repository.spec.ts`**

- A wrapper that parses each raw result through a Zod schema throws a named error when a column is
  missing or has the wrong type, instead of yielding `undefined` into arithmetic.
- One test per call site, using the real column list.

**GREEN** — a single `executeValidated(sql, schema)` helper, applied to every call site.

## R25 — Local SQLite gets schema versioning (medium)

`workout-session.ts:39-71` and `exercise-catalogue.ts:66-91` run `CREATE TABLE IF NOT EXISTS` with
no version. A future column change silently breaks sync on upgraded devices while passing
fresh-database tests.

**RED**

- Opening a database created at version 1 with version-2 code runs the migration and preserves
  existing rows — the case a fresh-database suite structurally cannot catch.
- A downgrade, meaning a newer database opened by an older app, fails loudly rather than
  corrupting data.

**GREEN** — `PRAGMA user_version` with an ordered migration list in both stores.

## R26 — Error states stop rendering as empty screens (medium)

`scan/[id].tsx:27`, `inbody-compare.tsx:41` and `(tabs)/index.tsx:81` catch to null and render an
empty screen indistinguishable from "no data", with no retry. Sibling screens already do this
correctly, so this is consistency work with a pattern to copy.

**RED** — for each screen, a failing load renders an error state with a retry control, distinct
from the empty state, and retry re-issues the request.

## R27 — Compiler and lint parity (four mediums)

- `apps/mobile/tsconfig.json` omits `noUncheckedIndexedAccess`, which `apps/api`,
  `packages/domain` and `packages/contracts` all enable through `tsconfig.base.json`. The one
  platform that must tolerate offline and degraded state has the weaker array-access guard. Enable
  it and fix the fallout. Expect this to surface real nullable-access bugs; each gets its own RED
  test before its fix.
- Nine mobile screens suppress `react-hooks/exhaustive-deps` with no inline justification, while
  the API side documents every lint disable. Audit each one: justify it in a comment or fix the
  dependency array. A wrong array is a stale-closure bug, so any that turn out to be real get a
  RED test.
- Declare `express` directly in `apps/api`, where guard and controller files use its types and it
  resolves only incidentally through `@types/express`. Declare `eslint-plugin-react-hooks` in
  `apps/mobile`, where it currently resolves by Node's directory walk-up from the monorepo root.
- **Needs the user:** `expo-glass-effect`, `expo-symbols`, `expo-device` and
  `@testing-library/jest-native` appear unused. A past cleanup in this repository used the same
  "imported by nothing" criterion and removed Phase 11 iOS scaffolding that was intentional. Ask
  before removing.

## R28 — Database indexes and the nutrition N+1 (low)

**RED** — `EXPLAIN` assertions in a repository spec, plus timing against a seeded dataset for the
food-search and saved-meals paths (`nutrition.repository.ts:291-315`).

**GREEN** — migrations adding `nutrition_log_entries(food_id)` first, then `goals(user_id)` and the
remaining missing foreign-key indexes. Batch the N+1 into a single query.

## R29 — Documentation reconciliation (low, plus the ADR this work owes)

Documentation is memory in this repository, so this slice is not optional tidying.

- **Row-level security.** ADR-008:91 and `docs/architecture/security.md:18` both claim RLS exists
  as defense-in-depth. It does not, on any table, and the application's database role would bypass
  it anyway. Authorization through guards is genuinely correct and rule 12 is not violated, but a
  forgotten guard has no SQL backstop. Either implement RLS or correct both documents to say
  plainly that guards are the only layer. The recommendation is to correct the documents and write
  an ADR recording why, since the bypassing role makes RLS largely theatre here.
- **The one-rep-max formula.** `packages/domain/src/training-calculations.ts:12` documents standard
  Epley; line 50 implements a `reps-1` variant reading about 3 percent low. This changes numbers
  the user sees, so both curves go to the user before either is chosen. Then make the docblock and
  the code agree, citing the published reference.
- **Rule 9 and the analytics pipeline.** ADR-029 chose compute-on-read over persisted staged
  types, which makes rule 9 — never mutate an aggregate — vacuous, since nothing is persisted to
  mutate. Not a defect. Note it in `docs/architecture/analytics.md` so the next reader is not
  confused by a rule with no referent.
- **Store metadata.** `eas.json` still carries a `REPLACE_WITH_…` production API URL, and the iOS
  `Info.plist` is missing `NSPhotoLibraryUsageDescription`, which is a submission rejection given
  the app picks scan photos.
- **A new ADR** recording this remediation pass: what the audit found, what changed, and the three
  rules that were being claimed but not enforced — rule 15's missing grep, the quote-defeated
  domain-purity check, and RLS. Those three are the durable lesson.

---

# Sequencing and checkpoints

| # | Slice | Package | Notes |
|---|---|---|---|
| R1 | Sync failure classification, retry surface, finish handlers | mobile | — |
| R1b | Per-record-type Health Connect sync | mobile | ships with R1 |
| R2 | AI consent gate, vision timeouts, vision throttle | api | — |
| R3 | Account deletion | api + mobile | shares the revoke helper with R5 |
| R4 | Data export | api + mobile + contracts | after R3 |
| R5 | WHOOP revoke and token wipe | api | reuses R3's helper |
| R6 | WHOOP unique external user | api + migration | — |
| R7 | Body-scan transaction | api | — |
| R8 | Bounded observation reads | api | — |
| R9 | helmet, env schema, ValidationPipe, compression | api | — |
| R10 | Contract bounds and array caps | contracts + domain | — |
| R11 | Low security and config batch | api + infra | asks about Supabase config |
| R12 | Conformance script and its own tests | scripts + CI | — |
| R13 | Coverage gates on all four packages | all | after R1–R12, R14–R16 |
| R14 | `body/` unit tests | api | after R2 |
| R15 | `toLiveExercise` tests | mobile | — |
| R16 | Eleven controller specs | api | — |
| R17 | De-flake the route-tree suites | mobile | — |
| R18 | Timer and toast announcements | mobile | after R1 |
| R19 | Contrast — **pauses for the user** | mobile | — |
| R20 | Catalogue conditional fetch | mobile + api | after R9 |
| R21 | 1 Hz timers, SectionList | mobile | after R18 |
| R22 | Block-type union, cross-field targets | domain + contracts | — |
| R23 | File splits | mobile + api + contracts | after R1 and R21 |
| R24 | Validated raw SQL | api | — |
| R25 | SQLite schema versioning | mobile | after R1 |
| R26 | Error states | mobile | — |
| R27 | Compiler and lint parity | mobile + api | asks about the Expo packages |
| R28 | Indexes and the nutrition N+1 | api + migrations | — |
| R29 | Documentation, the ADR, store metadata | docs | last |

R1 through R4 are the ones that matter most. If the work has to stop early, stopping after R4
leaves an app that no longer loses finished workouts, no longer sends health data to a third-party
model without consent, and is legally deletable. That is the difference between shippable and not.

## What is deliberately out of scope

The two device walks the roadmap already owes stay tracked where they are and are unchanged by
this pass: the Phase 6F Health Connect physical-Android test (ADR-035) and the live WHOOP OAuth
round-trip (ADR-037).

## Points where this plan stops and asks

Three, all flagged above rather than guessed:

1. **R19** — the accent colour behind primary buttons, with rendered samples.
2. **R11** — whether `supabase/config.toml` governs the hosted project.
3. **R27** — whether the four apparently-unused Expo packages are deliberate iOS scaffolding.

A fourth is likely: **R29**'s one-rep-max formula changes numbers users already see, so the choice
between the documented Epley and the implemented variant goes to the user with both curves.
