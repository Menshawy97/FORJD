# Phase 6 — Health Connect + analytics: plan

## Context

Phase 5 (InBody) merged 2026-09-07, including a same-day device walk (PRs #119, #120) —
see the roadmap's two 2026-09-07 session-close entries. Phase 6 is next in
`docs/product/roadmap.md`'s timeline and is the second of CLAUDE.md's four
architecturally-critical pillars to actually get built in code: the canonical health model
(`HealthObservation`) and the provider abstraction (`HealthProvider`) are both fully specified
— `docs/architecture/health-data.md`, `docs/architecture/integrations.md`,
`docs/architecture/domain-model.md`, ADR-003, ADR-004 — and **0% implemented**. Nothing named
`HealthProvider`, `HealthObservation`, or `health_observations` exists anywhere in code; this
is a greenfield vertical, the same starting position Phase 3 (workouts) and Phase 5 (InBody)
each had.

**The device constraint.** CLAUDE.md rule 16: "HealthKit/Health Connect code does not merge
until it has run on a physical device." There is still no physical Android phone. Unlike
Phase 5/Spike B, which was blocked entirely on a missing credential, most of Phase 6 needs no
device at all — only the final adapter slice (6F) does, and an Android emulator
(`forjd_pixel7_api34`, Play Store image, `roadmap.md:1508`) already exists specifically so that
slice can be *exercised*, even though it cannot be what merges it.

## Locked decisions (from the architecture docs — not re-decided here)

1. **`HealthObservation` shape**, `docs/architecture/health-data.md`: `id, user_id,
   metric_type, value, unit, start_time, end_time, source, provider_record_id, device_id,
   quality, created_at`. `metric_type` is a fixed, provider-agnostic vocabulary.
2. **Source is never overwritten.** Duplicate observations from different providers are
   separate rows; reconciliation is a per-metric source-priority policy applied *at read time*,
   expressed as data, not branching. Built now, even with one provider, because retrofitting it
   at Phase 7 (WHOOP) means backfilling.
3. **`HealthProvider` interface** (`docs/architecture/integrations.md:5-12`): `connect()`,
   `disconnect()`, `getCapabilities()`, `requestPermissions(permissions)`, `sync(request)`.
   ADR-003: shaped by the union of providers, not by Health Connect alone —
   `getCapabilities()` is what lets a provider missing a metric degrade gracefully.
4. **Sync is checkpointed and incremental** (`last_successful_sync_at`), deduped on provider
   record ids where the provider supplies them.

## Three decisions this phase owns and must settle before 6A starts

**1. Aggregation: rollup job or computed-on-read?** ADR-029 names Phase 6 by name as its
revisit trigger, and expected Phase 5 to bring BullMQ/Redis along — which Phase 5 did not do
(ADR-032 decision 7 went synchronous instead, since Cloud Run shuts containers down between
requests). ADR-029's trigger is precise: "when Progress's Health tab needs to aggregate across
that volume." Slices 6A–6D do not build that tab, so they proceed under compute-on-read without
prejudging the answer; the decision lands with the dashboards (post-6F). Record as an open item
here, not as settled — do not let it default silently to either answer.

**2. The module name collides.** `apps/api/src/common/health/` already exists as the liveness
probe. Phase 6's domain module is named `health-data/` (chosen over `observations/`, since the
latter reads as workout-set terminology in this codebase) — `apps/api/src/health-data/`,
mirroring `apps/api/src/body/`'s flat four-file shape.

**3. The Health Connect library is an unresolved fork, and needs its own ADR before 6E/6F.**
CLAUDE.md rule 17, `integrations.md`, and the master plan all still prescribe the pub.dev
`health` package — Flutter-era text that predates ADR-013/ADR-027's move to Expo/React Native.
There is no RN equivalent named anywhere in the docs. This does not block 6A–6D, which contain
no provider code. Bring the library choice back to the user when 6E starts; do not assume
`react-native-health-connect` or any other candidate without confirming.

## Slices

Same vertical-slice discipline as Phases 3–5: migration → domain vocabulary → contracts →
repository → service → controller → unit + e2e tests → mobile screen, one bounded capability
per PR, merged and confirmed green on `main` before the next slice starts.

- **6A — domain vocabulary.** `packages/domain/src/health-vocabulary.ts`:
  `HEALTH_METRIC_TYPES` and `HEALTH_SOURCES` `as const` tuples with display-name maps and a
  canonical unit per metric, the `HealthObservation` interface, and the source-priority policy
  as data plus a pure `resolveByPriority()` reducer. Must include sleep-stage and
  respiratory-rate types from the start — ADR-031 (readiness, still `Proposed`) commits to four
  sleep-window inputs (HRV, resting HR, sleep performance, respiratory rate) compared against
  the athlete's own rolling baseline, decomposed and always visible, never a single opaque
  score, withheld with an explanation until roughly a month of history exists. Mirrors
  `body-vocabulary.ts` / `workout-vocabulary.ts`, including the `*-vocabulary.spec.ts`
  coverage/orphan-key pattern.

- **6B — schema, migration `0015`.** `apps/api/src/database/schema/health-data.schema.ts`:
  `health_observations` in the tall shape above, plus `health_connections` carrying
  `last_successful_sync_at` (naming from `domain-model.md:60-62`, building only the tables the
  slices actually need — not `health_permissions`/`health_workouts`/`sleep_sessions` yet).
  Partial unique index on `(user_id, source, provider_record_id)` for idempotent re-ingestion,
  the same property `exercises:load` relies on. House conventions from `body.schema.ts`: closed
  vocabularies as `text` columns backed by a domain tuple, never a Postgres enum; `numeric` for
  values; RLS off (guards enforce, rule 12); `index()` on `(user_id, <time>)` mirroring
  `workout_sessions_user_started_idx`. Generated with `db:generate`, never hand-edited (rule
  14). Constraint behaviour pinned against real Postgres. Reuse `body_measurements`'s
  `measuredAt` duplication precedent — its docblock says it exists "so Phase 6's read-time
  source-priority policy can query measurements directly without joining scans every time."

- **6C — contracts.** `packages/contracts/src/`: `z.enum(...)` schemas straight off 6A's
  tuples, a batch ingest request, a series response. Nothing the server already owns is
  client-supplied, following the three standing omissions precedent from Phase 3C. New
  fixtures in `fixtures.ts`.

- **6D — API module**, `apps/api/src/health-data/` (module/controller/service/repository),
  mirroring `apps/api/src/body/`: `@UseGuards(JwtAuthGuard)` at class level, `ZodValidationPipe`
  on every body/query, 404-never-403, registered in `app.module.ts`, importing
  `AuthProviderModule` + `UsersModule`. Routes: batch observation ingest (idempotent), a series
  read applying the source-priority policy at read time, connection state including the sync
  checkpoint. Cross-user isolation proven over real HTTP in an e2e spec, as `body.e2e-spec.ts`
  does.

- **6E — `HealthProvider` interface + contract tests**, `apps/mobile/src/integrations/health/`
  (currently an empty directory). Implements `integrations.md:5-12`'s interface verbatim. A
  shared contract-test suite any implementation must pass, exercised by an in-memory fake —
  CLAUDE.md rule 8's "contract tests for adapters," written before the adapter, and ADR-004's
  warning that per-adapter normalization (unit conversion included) is where data corrupts
  silently. Also adds the **missing conformance rule**: CLAUDE.md's "Enforced, not just stated"
  section and rule 17 both promise CI fails on a `health`-package import outside
  `integrations/`, but `check-architecture-conformance.sh` has no such rule today. Add it here,
  before the adapter that could violate it — decide deliberately whether it carries a
  `__tests__` exemption (the `expo-secure-store`/`expo-sqlite` rules do; the `openai` rules
  don't). Blocked on the library-choice ADR from decision 3 above.

- **6F — Health Connect adapter. Device-gated; does not merge until a physical device
  confirms it (rule 16).** Written and exercised against the `forjd_pixel7_api34` emulator,
  which cannot substitute for the device — it produces no real health data, no hardware-backed
  keystore, no real sensor behaviour. Ends any session that reaches it as an open branch with
  exactly what was and wasn't verified recorded in the roadmap, so the eventual device day is
  short rather than a rediscovery. If emulator verification is ever judged sufficient on its
  own, that is a deliberate amendment to rule 16 requiring its own ADR first, not a default to
  slide into.

- **Post-6F — light up the UI.** Not device-gated in principle, but has nothing real to render
  before a provider exists, so it waits. The seams are already cut:
  - `features/home/readiness-card.tsx` takes no props today; its docblock states the contract:
    "When Phase 6 lands, this file takes a `readiness` prop and the em dashes become values;
    the layout does not move." Ring is drawn track-only, no progress arc yet. Per ADR-031 the
    prop must carry decomposed components and the not-enough-history reason, not just a score.
  - `features/home/stat-strip.tsx` exports `StatStripProps` for the three workout counters
    today; the four health metrics (sleep, HRV, RHR, steps) are hardcoded em dashes and need to
    become four nullable props.
  - `app/(tabs)/progress.tsx` already has a `'health'` tab in its segmented control, rendering
    an inline honest-empty `Card` (lines 111–116) — the insertion point for a `HealthView`,
    which should be its own file under `features/health/` following `features/body/body-view.tsx`
    rather than inlined like `StrengthView`.
  - `features/progress/step-count-card.tsx` is a second em-dash consumer with an inert
    Day/Week/Month control.

## Realistic scope

6A–6D is a full session's own work. Stop wherever a session stops and record precisely which
slice is done in the roadmap — do not attempt to reach 6F in the same session that starts 6A.

## Doc-hygiene items this phase should close as it goes

- Rule 17 and `integrations.md` still name Flutter's pub.dev `health` package — resolved by the
  library ADR (decision 3).
- **ADR-031 is still `Proposed`.** Phase 6 either accepts it or amends it; it should not stay
  Proposed once readiness code exists.

## Verification

Per slice: `pnpm --filter @forjd/domain test`, `pnpm --filter @forjd/api test:cov` (new
service/cursor files added to the 100%-coverage list), `pnpm --filter @forjd/api test:e2e`
against real Postgres, `pnpm conformance`, and the post-merge CI run on `main` confirmed green
before starting the next slice.

## Related

- [`../architecture/health-data.md`](../architecture/health-data.md)
- [`../architecture/integrations.md`](../architecture/integrations.md)
- [`../architecture/analytics.md`](../architecture/analytics.md)
- [`../decisions/ADR-003-health-provider-abstraction.md`](../decisions/ADR-003-health-provider-abstraction.md)
- [`../decisions/ADR-004-canonical-health-model.md`](../decisions/ADR-004-canonical-health-model.md)
- [`../decisions/ADR-029-progress-analytics-computed-on-read.md`](../decisions/ADR-029-progress-analytics-computed-on-read.md)
- [`../decisions/ADR-031-readiness-score-methodology.md`](../decisions/ADR-031-readiness-score-methodology.md)
- [`phase-4-plan.md`](phase-4-plan.md) — the phase this one follows.
