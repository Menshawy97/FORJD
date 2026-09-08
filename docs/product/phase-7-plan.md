# Phase 7 — WHOOP integration: plan

## Context

Phase 6 (Health Connect + readiness scoring + light-up-the-UI) is complete and merged — PRs
[#128](https://github.com/Menshawy97/FORJD/pull/128)–[#132](https://github.com/Menshawy97/FORJD/pull/132)
plus a doc-close commit, all confirmed green on `main`. The canonical health model
(`health_observations`), the read-time source-priority policy, the `HealthProvider` interface,
`HealthConnectProvider`, and the readiness endpoint all exist. Phase 7 is next in
`docs/product/roadmap.md`'s timeline (`| 7 — WHOOP | 29-30 | OAuth, webhooks, adapter | Not
started |`) and is the second `HealthProvider` implementation in `integrations.md`'s build order:
`HealthConnectProvider` (Phase 6) → `WhoopProvider` (Phase 7) → `AppleHealthProvider` (Phase 11).

Nothing WHOOP-specific exists in code yet, but Phase 6 deliberately pre-paid a lot of this
phase's cost. `"whoop"` is already a legal `HealthSource`
(`packages/domain/src/health-vocabulary.ts:117`) and already ranks **first** in
`HEALTH_SOURCE_PRIORITY` for HRV, resting heart rate, heart rate, respiratory rate, and all five
sleep metrics — `health-data.md`'s own docblock says this reconciliation layer was built with the
first provider specifically "because retrofitting it once WHOOP (Phase 7) arrives means
backfilling." The idempotent-upsert unique index `(user_id, source, provider_record_id)` on
`health_observations` is already in place, which is exactly what deduplicating a re-delivered
WHOOP webhook needs.

Four things this phase must build with **no existing house pattern to copy**: encryption at rest
(zero encryption code exists anywhere in this repo today), raw-body capture ahead of HMAC
verification (`NestFactory.create` is not passed `rawBody` anywhere), the
`apps/api/src/integrations/` directory (documented at `system.md:66`, never created), and a
stored OAuth token lifecycle (nothing in the repo currently manages token expiry/refresh).

## Decisions confirmed with the user (2026-09-08)

1. **No WHOOP membership for this phase.** WHOOP has no sandbox or demo-data mode; a membership
   is $30/mo, $239/yr, or $399/24mo, with the band included but non-functional without an active
   subscription. The user chose to build the entire integration against **recorded real WHOOP
   payload shapes** rather than wait on a subscription. Everything below gets built, tested, and
   merged to `main`; the live OAuth round-trip (an actual browser login completing against
   WHOOP's servers) stays explicitly owed — tracked in the roadmap and the closing ADR, the same
   way [ADR-035](../decisions/ADR-035-6f-merge-exception-rule-16.md) tracks the still-owed Health
   Connect physical-device test.
2. **The integration runs entirely server-side.** WHOOP's client secret never reaches the mobile
   bundle (`CLAUDE.md` rule 5). The phone renders a Connect button and a status; the API owns
   OAuth, token storage, webhooks, and sync.
3. **A new `external_connections` table**, the shape `integrations.md:57-59` already specifies
   (`user_id, provider, status, external_user_id, encrypted_access_token,
   encrypted_refresh_token, expires_at, scopes, last_sync_at`). `health_connections` (Phase 6)
   stays exactly as it is for on-device providers, rather than growing token columns that would
   be permanently null for Health Connect and Apple Health rows.
4. **Tokens encrypted in application code with AES-256-GCM, key held in Google Secret Manager**
   alongside the project's existing secrets, with a key-version column stored per row so the key
   can be rotated later without a data migration. Not Google Cloud KMS — a paid per-key,
   per-operation service that would also add a network round trip to every token read, in a
   project that runs on free tiers only (`docs/decisions/ADR-015`).

## Locked decisions (from the architecture docs — not re-decided here)

1. **`HealthProvider` is the interface, verbatim** (ADR-003;
   `apps/mobile/src/integrations/health/health-provider.interface.ts:74-81`): `source`,
   `connect()`, `disconnect()`, `getCapabilities()`, `requestPermissions(permissions)`,
   `sync(request)`. WHOOP is provider #2 through this exact interface, not a new one.
2. **`HealthObservation` shape and the never-overwrite rule** (ADR-004, `health-data.md`,
   `CLAUDE.md` rule 10): `id, user_id, metric_type, value, unit, start_time, end_time, source,
   provider_record_id, device_id, quality, created_at`. Duplicate observations from two
   providers are stored as separate rows and reconciled at read time by the source-priority
   policy, never collapsed at write time.
3. **Canonical units are the adapter's job** (`HEALTH_METRIC_UNITS` in
   `health-vocabulary.ts`) — normalization happens inside the WHOOP adapter, not at the caller.
4. **Sync is checkpointed and incremental**, deduped on provider record IDs where the provider
   supplies them (`health_connections`/`external_connections`' `last_sync_at`).
5. **No queue infrastructure exists, and none is added by this phase.** ADR-029 and
   [ADR-032](../decisions/ADR-032-nvidia-vision-for-inbody-development.md) decision 7 both ruled
   against BullMQ/Redis specifically because Cloud Run (ADR-015) shuts containers down between
   requests, making it a poor host for a long-lived worker.
6. **`apps/api/src/integrations/<provider>/` is the prescribed location** for API-side
   integrations (`CLAUDE.md` rule 4; `system.md:66-67`). This directory does not exist yet;
   `whoop/` is its first occupant.

## Decisions this phase owns and must settle

**A. `CLAUDE.md` rule 16 does not apply to WHOOP — stated explicitly, not assumed.** Rule 16
names HealthKit and Health Connect, and its rationale (ADR-007, ADR-035) is native on-device
sensor/permission code a green CI build cannot exercise. WHOOP is server-side HTTPS plus a
browser OAuth redirect — no native module, no on-device sensor API. `roadmap.md:1794`'s mention
of WHOOP alongside the physical-device list is about *having a band that produces data*
(decision 1 above), not about rule 16's merge gate. The one genuinely device-shaped surface is
the mobile Connect screen opening a browser (7G) — that gets a real-device walk via Expo Go as a
self-imposed check, not a merge-blocking gate the way Health Connect's native code is.

**B. Webhook processing is synchronous; WHOOP's own retry schedule is the queue.** WHOOP webhooks
are event-based, not data-based — the payload carries only an id, and the receiver must fetch the
actual record. WHOOP expects a 2XX response (recommended within ~1s) and retries **five times
over about an hour** on failure or timeout. The handler therefore verifies the signature, fetches
the one changed record, upserts it, and returns within the request — a cold Cloud Run start that
misses the window self-heals on WHOOP's next retry. No new table, no worker process, no Cloud
Scheduler, consistent with decision 5 above. A manual `POST /integrations/whoop/sync` endpoint is
the backstop for anything a webhook run genuinely misses.

**C. Token refresh is lazy, guarded by a row lock.** Checked against `expires_at` immediately
before every outbound WHOOP call and refreshed inline if needed — the direct analogue of
ADR-029's compute-on-read philosophy, requiring no scheduled job. WHOOP invalidates the prior
access token the instant its refresh token is used, so two concurrent refresh attempts for the
same user would race and break each other; a `SELECT ... FOR UPDATE` on the connection row
serializes refreshes per user.

**D. `strain` and WHOOP's own `recovery score` are out of scope for this phase, with the
reasoning recorded.** `docs/product/mvp.md:23` lists "recovery, sleep, strain, workouts" for
WHOOP, but `strain` and WHOOP's composite recovery score are WHOOP-proprietary values with no
entry in `HEALTH_METRIC_TYPES` — adding a `whoop_strain` metric type would break the
provider-agnostic-vocabulary rule the entire canonical model is built on, and FORJD deliberately
computes its own readiness score from raw inputs (ADR-031) rather than importing a vendor's.
Phase 7 ingests the raw metrics (HRV, resting heart rate, sleep stages, respiratory rate, active
energy, weight); storing WHOOP's own composite scores as FORJD data is a separate, un-taken
decision if it's ever wanted.

**E. Connecting WHOOP mid-baseline silently changes which rows readiness reads — flagged, not
solved.** `HEALTH_SOURCE_PRIORITY` already ranks `whoop` above `health_connect` for all four
readiness inputs, and ADR-031 states plainly that a chest-strap and a wrist-PPG HRV reading are
not fungible numbers. Nobody has decided what should happen when a user's readiness baseline is
built from one source and then a higher-priority source starts contributing rows mid-window.
Phase 7 records this as an open follow-up in its closing ADR rather than silently re-baselining
or hiding it; building a "your data source changed" UI surface is explicitly not part of this
phase.

## Metric mapping (WHOOP API v2 → canonical `HealthMetricType`)

| WHOOP field | Canonical metric | Note |
|---|---|---|
| `recovery.score.hrv_rmssd_milli` | `hrv` (ms) | WHOOP is source-priority #1 |
| `recovery.score.resting_heart_rate` | `resting_heart_rate` (bpm) | source-priority #1 |
| `sleep.score.stage_summary.*_milli` | `sleep_light_duration` / `sleep_deep_duration` / `sleep_rem_duration` / `sleep_awake_duration` (min) | per-stage milliseconds → minutes |
| sleep total minus awake time | `sleep_duration` (min) | derived, not a direct WHOOP field |
| `sleep.score.respiratory_rate` | `respiratory_rate` (breaths/min) | source-priority #1 |
| `workout.score.kilojoule` | `active_energy` (kcal) | kJ → kcal conversion at the adapter boundary |
| body measurement `weight_kilogram` | `weight` (kg) | InBody still outranks WHOOP for weight |

All four of ADR-031's readiness inputs (HRV, resting heart rate, sleep performance, respiratory
rate) are covered by this mapping. Exact WHOOP v2 endpoint paths, pagination, and field names are
confirmed against the live API reference during slice 7D rather than asserted from memory here —
see the sources at the bottom of this doc for what was confirmed during planning.

## Slices

Same vertical-slice, test-first, PR-per-slice discipline as Phases 3–6: write the failing test,
implement to green, one bounded capability per PR, merged and confirmed green on `main` before
the next slice starts.

- **7A — token encryption + ADR-036.** `apps/api/src/common/crypto/token-cipher.ts`:
  AES-256-GCM over Node's built-in `node:crypto`, key sourced from a `TOKEN_ENCRYPTION_KEY`
  environment variable (base64, 32 bytes) via the same `ConfigService` + `getOrThrow` factory
  pattern the AI vision clients already use (`apps/api/src/ai/providers/openai-vision-client.ts:17-21`).
  Ciphertext is self-describing and carries a key-version tag so a future key rotation is
  additive, not a rewrite. Written test-first: round-trip encrypt/decrypt, GCM tamper detection,
  wrong-key rejection, malformed-input handling. New `.env.example` entry with the same comment
  density as every existing entry. ADR-036 records the AES-256-GCM-in-app-code choice and why
  Cloud KMS was not chosen.

- **7B — `external_connections` schema, migration `0016`.** New schema file mirroring
  `health-data.schema.ts`'s conventions: columns per `integrations.md:57-59` plus
  `oauth_state` / `oauth_state_expires_at` (CSRF state bound to the authenticated user, short
  TTL — no separate state table needed) and `token_key_version`. New domain tuples
  `EXTERNAL_CONNECTION_PROVIDERS` and `EXTERNAL_CONNECTION_STATUSES` (`pending`, `connected`,
  `expired`, `revoked`, `disconnected`), stored as `text` columns backed by the tuples, never a
  Postgres enum — the same reason every other closed-vocabulary column in this schema directory
  gives. Unique index on `(user_id, provider)`. RLS not enabled, matching every other table in
  this directory (no client holds a Supabase credential; authorization is a NestJS-guard
  concern, rule 12). Generated with `pnpm --filter @forjd/api db:generate`, never hand-edited.
  Constraint behaviour pinned against real Postgres in a `*.schema.spec.ts`.

- **7C — move `HealthProvider` into `packages/domain`.** A mechanical refactor with no behaviour
  change: the interface types and the shared contract-test suite move from
  `apps/mobile/src/integrations/health/` to `packages/domain/src/health-provider.ts` and
  `health-provider.contract.ts`, exported from the domain package's index — mirroring the
  precedent `packages/contracts/src/fixtures.ts` already sets for sharing test support across
  consumers. `apps/mobile/src/integrations/health/` re-imports from `@forjd/domain` instead of
  defining its own copy; every existing mobile spec (`fake-health-provider.spec.ts`,
  `health-connect.provider.spec.ts`) stays green untouched. This is what makes "WHOOP is provider
  #2, not a new interface" literally true once the concrete implementation lives server-side —
  and it is correct on principle regardless of Phase 7: the provider abstraction is one of
  `CLAUDE.md`'s four architecturally-critical pillars, so its definition belongs in the shared
  domain package, not inside the mobile app.

- **7D — WHOOP client, OAuth service, and record mapping.** `apps/api/src/integrations/whoop/` —
  the first occupant of that directory. `whoop-client.ts`: a typed wrapper over Node 22's global
  `fetch`, an `AbortSignal`-based timeout, and the existing 3-attempt no-backoff retry convention
  from `openai-vision.provider.ts:31-73`, behind a `WHOOP_CLIENT` injection symbol so tests
  substitute a stub rather than hitting the network (mirroring the `ai`/`storage`/`auth` provider
  module shape). `whoop-oauth.service.ts`: builds the authorize URL with a bound `state`,
  exchanges an authorization code for tokens, and refreshes using the `offline`-scope refresh
  token. `whoop-record-mapping.ts`: pure functions mapping WHOOP recovery/sleep/workout/body
  records to `SyncedObservation[]` per the table above — the file ADR-004 warns is where an
  integration's normalization actually corrupts data silently if untested. All three tested
  against recorded real WHOOP v2 payload fixtures under `__fixtures__/`. No HTTP routes yet.

- **7E — `WhoopProvider implements HealthProvider`, plus its repository.** Constructed per-user
  from a factory so the shared five-method interface signature is unchanged for callers.
  `connect()` ensures a usable, non-expired token (refreshing via 7D's OAuth service if needed).
  `requestPermissions()` reports which canonical metrics the connection's actually-granted WHOOP
  scopes correspond to. `sync()` pulls incrementally from the stored `last_sync_at` checkpoint
  and returns `SyncedObservation[]`; the calling service writes them with `source: "whoop"`.
  Exercised against 7C's shared `HealthProvider` contract-test suite using a fake connection
  repository, proving `WhoopProvider` genuinely satisfies the same contract
  `HealthConnectProvider` does.

- **7F — routes, webhook, and raw-body capture.** `main.ts` gains `{ rawBody: true }` on
  `NestFactory.create`. `WhoopController` follows `auth.controller.ts`'s shape — a public class
  with per-method `@UseGuards(JwtAuthGuard)` and per-route `@Throttle`: authenticated
  `POST /integrations/whoop/authorize`, `POST /integrations/whoop/sync`, and
  `DELETE /integrations/whoop` (disconnect + best-effort token revocation); public
  `GET /integrations/whoop/callback` (validates `state`, exchanges the code, then redirects to
  `forjd://whoop-callback?status=...`) and `POST /integrations/whoop/webhook` (verifies
  `base64(HMAC-SHA256(timestamp header + raw body, client secret))` against the
  `X-WHOOP-Signature` / `X-WHOOP-Signature-Timestamp` headers, rejects stale timestamps, does a
  timing-safe comparison, and carries `@SkipThrottle()` since the global `ThrottlerGuard` would
  otherwise rate-limit WHOOP's own IPs). An e2e spec proves: unauthenticated rejection on every
  authenticated route, cross-user isolation, a forged/tampered signature is rejected, and
  re-delivering the same webhook event is idempotent (relies on 7B/7D's design and the existing
  `health_observations` unique index).

- **7G — mobile Connect screen.** Built pixel-by-pixel against the design's `s_connect()`
  (`FORJD mobile app design/FORJD Mobile.dc.html:1945-1969`) and
  `screenshots/connected sources.png`: three cards (Apple Health, WHOOP, Health Connect), each
  with Connect → busy-spinner → Disconnect states, the footer note ("You choose what each source
  shares..."), and the bottom Save CTA with its confirmation flash. Profile's currently-inert
  "Connected Sources" row (`apps/mobile/src/app/(tabs)/profile.tsx:133-137`) becomes live,
  routing to this new screen. **Only the WHOOP card is functionally wired this phase.** Apple
  Health is Phase 11 and genuinely does not exist yet. Wiring the Health Connect card here would
  cross ADR-035's actual deferred trigger — "before any UI screen wires real users to this
  provider" — while the Phase 6F physical-device test is still owed; both non-WHOOP cards render
  in a clearly labeled not-yet-available state instead, following the same "an inert control is
  more honest than a Pressable to nowhere" precedent `profile.tsx:22-25` already sets. This is a
  deliberate, explicitly stated deviation from the design (which shows all three as live), to be
  reconfirmed with the user during the eventual device walk.

- **7H — conformance rules, ADR-037, doc hygiene, close-out.** Two additions to
  `scripts/ci/check-architecture-conformance.sh`: WHOOP client/adapter code confined to
  `apps/api/src/integrations/whoop/` (mirroring the existing directory-prefix rule for
  `react-native-health-connect`), and a new rule *shape* the script doesn't have yet — a grep
  proving no WHOOP hostname or client-secret-like string appears anywhere under
  `apps/mobile/src`, the mechanically enforceable version of `CLAUDE.md` rule 5. New
  service/provider/mapping/cipher files added to the per-file 100%-coverage list in
  `apps/api/package.json`, following the existing pattern (every service and third-party
  provider adapter gets an entry). ADR-037 records the overall WHOOP integration shape and this
  phase's open items (decision E above; the still-owed live OAuth round-trip). Doc hygiene: fix
  the two confirmed-stale Flutter references — `integrations.md:54`'s
  `Flutter → Your API → WHOOP OAuth` diagram and `system.md:68`'s `mobile/ Flutter` repo-layout
  line. A full sweep of `docs/` during planning confirmed these are the **only two** genuinely
  stale Flutter references left anywhere in the docs tree; every other occurrence is either
  inside a historical ADR (correct as history) or already annotated as superseded. Roadmap
  session-close entry recording exactly which slices landed.

## Realistic scope

7A–7C is a full session's own work; 7D–7F is another; 7G–7H a third. Stop wherever a session
stops and record precisely which slice is done in the roadmap — do not attempt to reach 7H in
the same session that starts 7A, following Phase 6's own precedent.

## What will still be owed when Phase 7 closes

- **The live WHOOP OAuth round-trip will never have run.** Per decision 1, this phase is built
  and tested against recorded payload shapes, not a real WHOOP account. Tracked explicitly in
  the roadmap and ADR-037, not silently treated as done.
- **The Phase 6F Health Connect physical-device test (ADR-035) remains owed** — 7G deliberately
  does not wire the Health Connect Connect-screen card, so this phase does not change that
  status either way.
- **Decision E's readiness-baseline-crossover behavior** is flagged, not built.

## Doc-hygiene items this phase closes as it goes

- `docs/architecture/integrations.md:54` — stale `Flutter → Your API → WHOOP OAuth` diagram,
  corrected to `React Native (Expo) → Your API → WHOOP OAuth` as part of rewriting this section
  with the `external_connections` details anyway.
- `docs/architecture/system.md:68` — stale `mobile/ Flutter` repo-layout line, corrected
  alongside adding `apps/api/src/integrations/` as this phase's first real occupant of that
  documented-but-empty directory.

## Verification

Per slice: `pnpm --filter @forjd/domain test`, `pnpm --filter @forjd/api test:cov` (new
service/provider/mapping/cipher files added to the 100%-coverage list),
`pnpm --filter @forjd/api test:e2e` against real Postgres, `pnpm --filter @forjd/mobile test`,
`tsc --noEmit` in each affected workspace (rebuilding `@forjd/domain` and `@forjd/contracts`
first — a stale `dist/` produced a false-alarm type error in the Phase 6 session), and
`pnpm conformance`. Post-merge CI run on `main` confirmed green before starting the next slice.

## Related

- [`../architecture/integrations.md`](../architecture/integrations.md)
- [`../architecture/health-data.md`](../architecture/health-data.md)
- [`../architecture/security.md`](../architecture/security.md)
- [`../architecture/system.md`](../architecture/system.md)
- [`../decisions/ADR-003-health-provider-abstraction.md`](../decisions/ADR-003-health-provider-abstraction.md)
- [`../decisions/ADR-004-canonical-health-model.md`](../decisions/ADR-004-canonical-health-model.md)
- [`../decisions/ADR-008-auth-storage-provider-abstraction.md`](../decisions/ADR-008-auth-storage-provider-abstraction.md)
- [`../decisions/ADR-015-supabase-topology-and-free-host.md`](../decisions/ADR-015-supabase-topology-and-free-host.md)
- [`../decisions/ADR-029-progress-analytics-computed-on-read.md`](../decisions/ADR-029-progress-analytics-computed-on-read.md)
- [`../decisions/ADR-031-readiness-score-methodology.md`](../decisions/ADR-031-readiness-score-methodology.md)
- [`../decisions/ADR-035-6f-merge-exception-rule-16.md`](../decisions/ADR-035-6f-merge-exception-rule-16.md)
- [`phase-6-plan.md`](phase-6-plan.md) — the phase this one follows.
- WHOOP developer docs consulted during planning:
  [OAuth](https://developer.whoop.com/docs/developing/oauth),
  [Webhooks](https://developer.whoop.com/docs/developing/webhooks/),
  [App approval](https://developer.whoop.com/docs/developing/app-approval),
  [Getting started](https://developer.whoop.com/docs/developing/getting-started),
  [Recovery data](https://developer.whoop.com/docs/developing/user-data/recovery/).
