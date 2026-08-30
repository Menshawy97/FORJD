# Phase 2 — Exercise database: re-plan and execution

## Context

Phase 1 is complete and closed (2026-08-24). Staging is live and auto-deploys on green
`main`. Phase 2 is next and has no blockers.

CLAUDE.md and the roadmap's "Working method" both require later phases to be **re-planned**
rather than executed from the original outline — later phases were deliberately left thin so
earlier ones could teach their lessons. A Phase 2 re-plan was sketched in an earlier session
but never written down (roadmap line 516), and that context is gone, so it is being redone
from scratch.

The roadmap sketched Phase 2's opening slices as *canonical exercise model + ingest →
browse/search API → on-device catalogue with local FTS5 search*. **That shape is confirmed**,
with one scope addition decided during this planning pass: the design's custom-exercise
creation flow and per-exercise favourites are **in**, not deferred.

The intended outcome is a real exercise library in the app — ~870 exercises ingested from
free-exercise-db (ADR-005), normalized into the canonical `Exercise` model, searchable both
server-side and offline on device, reachable from the Train tab, with users able to favourite
catalogue exercises and author their own.

### The media question, and how it was settled

The user rejected free-exercise-db's imagery on quality grounds (two static photographic JPGs
per exercise) and named **Hevy** as the bar. Investigating Hevy directly produced a useful
fact: its exercise demos are **3D-rendered MP4s served from Hevy's own S3 bucket** —
`pump-app.s3.eu-west-2.amazonaws.com/exercise-assets/02871201-Dumbbell-Arnold-Press-II_Shoulders.mp4`.
The `02871201` prefix is a licensed third-party asset id; the issuing vendor could not be
confirmed and is deliberately not guessed at here.

Two conclusions:

1. **Hevy's architecture is the one this plan already had** — license media, own the bytes,
   serve from your own storage, keep a *key* in the database rather than a third-party URL.
2. **No free source has that look.** Every library producing it is commercial: ExerciseDB Pro
   (~$299–599 one-time, licence explicitly permits self-hosting), ExerciseAnimatic (~$329,
   MP4 to 4K), MoveKit (412 clips, $149–299), GymVisual (per-asset $3–10, ~$4,000 for our
   catalogue). Everything advertising itself as *free* animated exercise media traced back to
   re-uploaded commercial assets the uploader had no right to relicense —
   `hasaneyldrm/exercises-dataset` states its GIFs are *"© Gym visual and redistributed here
   with permission"*; `omercotkd/exercises-gifs` carries an MIT file over content whose README
   says *"I do not own any of the content in this repository."* The only genuinely clean free
   media is free-exercise-db's own public-domain photos and Everkinetic's CC BY-SA line-art,
   the latter carrying the same unresolved share-alike question ADR-005 already parked for
   wger.

There is no budget, so **free-exercise-db's photos ship as an explicit stopgap**, mirrored into
our own Supabase Storage bucket. The database stores a **storage key**, never a URL, and the
API resolves it through a configurable `mediaBaseUrl` — which is what makes replacing the
stopgap a re-run of one script rather than a migration and a contract break.

### What exploration established

- **No exercise code exists anywhere** — Phase 2 is greenfield against well-set conventions.
- The API's house shape is `controller → service (policy) → repository (Drizzle, returning
  `@forjd/domain` interfaces)`, tables centrally in `src/database/schema/*.schema.ts`, DI via
  `Symbol` tokens, specs co-located with a docblock justifying the test strategy.
- **`ZodValidationPipe` has only ever been used on `@Body`.** Browse/search is the codebase's
  first `@Query` validation and needs `z.coerce`.
- **There is no list/pagination envelope anywhere** — every endpoint returns a single object.
  Phase 2 invents it and it becomes the house pattern.
- **No FTS infrastructure exists** — no `tsvector`, no `pg_trgm`, no GIN index in any of the
  four migrations.
- **`StorageProvider` is built but deliberately unconsumed.** Phase 2's media mirror becomes
  its first real consumer, a phase earlier than InBody needed it.
- On device: `expo-sqlite` is installed and registered as a config plugin but has **zero
  imports**. There is no local database at all today. `store/notification-preferences.ts`
  (AsyncStorage behind a function seam) is the pattern to copy for a storage module.
- The prototype's library screen is `s_library()` (line 1659); detail is `s_exercise()` (1783),
  which branches to `s_exerciseRun()` **by category, not by route**; custom creation is
  `s_newExercise()` (2838). `s_favorites()` (2780) computes a favourite-exercises list and
  **never renders it** — a prototype bug, not a spec.
- The handoff markdown disagrees with the prototype again: it omits the **`Favourites` chip**
  from the library's chip row, misses the Favourites empty-state copy, and its screen inventory
  has no entry for `newExercise` or `favorites` at all.
- Every icon the library needs (`search`, `dumb`, `star`, `chevron`, `plus`, `pencil`, `x`,
  `check`, `runner`) already exists in `components/icon.tsx`.

---

## Locked decisions (do not re-litigate)

| Decision | Choice |
|---|---|
| Seed dataset | **free-exercise-db**, Unlicense, vendored at a pinned commit (ADR-005) |
| Exercise media | **free-exercise-db's own photos, as an explicit stopgap** — mirrored to a public Supabase Storage bucket |
| Media indirection | DB stores a **storage key**, API resolves via configurable `mediaBaseUrl` — replacing the stopgap is one script, not a migration |
| Custom exercises | **In Phase 2** — full create / edit / soft-delete flow |
| Favourites | **In Phase 2** — including the `Favourites` filter chip |
| Search | **Both** — server browse/search endpoint *and* on-device `expo-sqlite` + FTS5 |
| On-device catalogue | Full ~870-row sync, version-gated re-sync |
| Library entry point | **Minimal Train quick-action rows only** — the rest of `s_train` stays placeholder |
| Custom + catalogue storage | **One `exercises` table**, `owner_user_id` nullable (null = catalogue) |
| Muscles / equipment | **`text[]` columns + `as const` tuples in `@forjd/domain`**, not join or reference tables |
| `exercise_variants` | **Not built** — nothing in Phase 2 produces a variant; deferred to the workout engine |
| Deleting a custom exercise | **Soft delete** (`deleted_at`) — Phase 3 sessions will reference exercises |
| Refusing someone else's exercise | **404**, never 403 — matches the `athletes` enumeration-defence precedent |
| Offline writes | **Out of scope.** Catalogue and favourites *read* offline; all writes are online-only. The sync queue is Phase 3's job per `workout-engine.md` |

Three of these overturn or extend what `docs/architecture/domain-model.md` currently names, so
each is written down rather than absorbed silently:

- **ADR-017 — canonical exercise model** *(number reserved; the file has not been written — the decision itself is recorded in this plan's locked-decisions table above, which is authoritative until it is)*. Arrays over join tables; custom exercises in the same
  table; `force`/`level`/`mechanic` kept as nullable canonical columns rather than adapter
  metadata; `goal` and `measure` **derived** by the adapter because free-exercise-db has
  neither; `exercise_variants` deliberately deferred.
- **ADR-018 — exercise media hosting.** The Hevy finding, the vendor price table, why the
  apparently-free animated datasets are not free, why free-exercise-db's stills are a
  *deliberate stopgap* rather than the intended end state, and the storage-key +
  configurable-base-URL design that makes replacing them cheap. Names both exit routes: buy a
  commercial pack, or get a legal read on Everkinetic's CC BY-SA share-alike.
- **ADR-019 — on-device exercise catalogue.** `expo-sqlite` + FTS5, full versioned sync, and
  why writes stay online-only until Phase 3.

`domain-model.md`, `integrations.md` and `workout-engine.md` are updated in the phase that
changes them — docs are memory.

---

## Build order

Each phase ends green and is independently mergeable: PR → full suite for the affected packages
+ typecheck + lint → merge → **confirm CI green on `main` itself**.

### Phase 0 — Make the plan and the screen spec durable *(docs-only)* — ✅ **DONE**

1. ✅ This plan is at `docs/product/phase-2-plan.md`, and the roadmap's "Current status",
   "Next action once resumed" and timeline table all point at it.
2. ✅ **The prototype spec was extracted before any screen was written** —
   `docs/design/phase2-screen-specs.md`. `s_library`, `s_exercise`, `s_exerciseRun`,
   `s_newExercise` and the shared primitives (`hdr`, `lbl`, `btn`, `chips`, `card`, `tabbar`),
   pulled out of `FORJD Mobile.dc.html` with a brace-matching script rather than by eye, with
   prototype line numbers against every section so any value can be re-checked in seconds.
   It also carries **five new places the handoff markdown disagrees with the prototype**,
   including the missing `Favourites` chip and the fact that `s_favorites()` computes a
   favourite-exercises list and then never renders it.
3. ✅ **ADR-018 written** while the media research was fresh — the Hevy finding, the vendor
   price table, the traced provenance of every apparently-free dataset, and both exit routes.

Slice 2's Phase 0 exists because this spec was nearly lost to a scratchpad. Same risk here.
Docs-only, so CI skips it — that absence is correct.

### Phase A — Vendor the dataset and measure the media — ✅ **DONE** ([PR #37](https://github.com/Menshawy97/FORJD/pull/37))

- ✅ Pinned `yuhonas/free-exercise-db` at commit `b0eed06`; `dist/exercises.json` vendored as
  `apps/api/src/exercises/ingest/data/free-exercise-db.json` (~1.0 MB, pretty-printed), with
  `SOURCE.md` recording the commit SHA, the Unlicense text (fetched at the pin, not quoted from
  memory), and the upstream image provenance.
- ✅ **Measured, not estimated:** 873 exercises, 1,746 image paths (exactly 2/exercise, none
  missing), a 51-image sample averaging ~52 KB, projecting to **~88.6 MB total** — confirms
  ADR-018's assumed range and updates its placeholder. The provenance re-check ADR-005 asked for
  was done independently via the GitHub API's declared licence on `wrkout/exercises.json`
  (`Unlicense`), not assumed from the credit line.
- ✅ **The images are not committed.** They are fetched at mirror time in Phase F.

No schema, no endpoints — nothing yet reads this file. CI (full API + mobile suite, since this
touches `apps/api/src` and `paths-ignore` doesn't apply) was green on the PR and confirmed green
on `main` after merge.

### Phase B — Domain vocabulary and canonical types — ✅ **DONE**

`packages/domain/src/exercise-vocabulary.ts` (re-exported from `index.ts`) — following the
existing `TRAINING_GOALS` pattern exactly: `MUSCLE_GROUPS` (19), `EQUIPMENT` (16),
`EXERCISE_CATEGORIES` (6), `EXERCISE_GOALS` (5), `EXERCISE_MEASURES` (3), `FORCES` (3),
`LEVELS` (3), `MECHANICS` (2) as `as const` tuples with derived types, a display-name map for
each, and the `Exercise` interface. Contracts will build `z.enum()` from the tuples in Phase E —
never a second literal union, which is the drift that bit `Sex` once already.

The categories are the design's chips (`Strength`, `Running`, `Cross Training`, `Calisthenics`,
`Yoga`, `Mobility`), **not** free-exercise-db's seven source categories (`strength`,
`stretching`, `plyometrics`, `strongman`, `powerlifting`, `cardio`, `olympic weightlifting`).
Mapping between them is the adapter's job (Phase D), which is the whole point of the adapter.

✅ **RED first, as planned:** `exercise-vocabulary.spec.ts` was written and run failing (missing
exports) before the vocabulary existed, then the implementation made it pass — 17/17 tests,
asserting every tuple member has a non-empty display name, no orphan map keys, and the category
order matches the design's chip row exactly.

**One addition beyond the plan's text, made because the package had none:** `packages/domain`
had `"test": "echo \"no tests yet\""` — real RED→GREEN needed a real runner, so `jest` and
`ts-jest` were added, mirroring the API's inline jest config exactly (same
`moduleFileExtensions`, `testRegex`, `transform`, `testEnvironment`).

Muscle groups and equipment are each a superset of the custom-exercise screen's own multi-select
lists (`docs/design/phase2-screen-specs.md` §6.1) plus the values free-exercise-db's source data
needs, so the Phase D adapter can map either direction without lossy collapsing.

### Phase C — Migration and repository *(no wire change)* — ✅ **DONE & MERGED** ([PR #40](https://github.com/Menshawy97/FORJD/pull/40), CI green on `main`)

> **Phases 0, A, B and C are merged and `main` is green.** (The "next session starts here"
> pointer has moved to Phase E, below — Phase D is done.)
> Nothing in Phase C is half-finished. The `UsersRepository` follow-up this phase discovered was
> also fixed and merged separately ([PR #39](https://github.com/Menshawy97/FORJD/pull/39)).
>
> The Expo Go device-rendering bug flagged in an earlier version of this note is **fixed** —
> confirmed working on a physical iPhone 2026-08-25. See the roadmap's callout and
> `docs/product/expo-go-duplicate-sdk-tree.md` for what was fixed and what remains only
> partially understood about the mechanism. The mobile phases (I–K) are unblocked. Jest still
> cannot prove a screen actually renders on a device — the device walk each mobile phase ends
> with remains the real check, not a substitute for one.

- ✅ `exercises.schema.ts`: `id`, `ownerUserId` (nullable FK), `name`, `slug`, `category`,
  `goal`, `measure`, `primaryMuscles`/`secondaryMuscles`/`equipment` (`text[]` NOT NULL
  default `'{}'`), `force`/`level`/`mechanic` (nullable `text`), `instructions` (`text[]`),
  `imageKeys` (`text[]`), `description`, `source`, `sourceId`, `deletedAt`, timestamps.
  **`text`, never `pgEnum`** — the house rule, and what made the `sex` narrowing free.
  `exerciseFavourites` lives in the same file (a join table, not a boolean column on
  `exercises` — a favourite is a fact about a (user, exercise) pair, and catalogue rows are
  shared across every user).
- ✅ Migration `0005` (generated) adds both tables and two partial unique indexes —
  `(source, source_id) WHERE owner_user_id IS NULL` and
  `(owner_user_id, lower(name)) WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL` —
  expressed directly in the typed schema DSL via `.where()`, no hand-written SQL needed for
  either. Migration `0006` (hand-written `--custom`, same precedent as `0004`) adds the
  generated `search_vector` tsvector column + GIN index and the `pg_trgm` extension + GIN
  trigram index — deliberately **not** reflected in `exercises.schema.ts`, since doing so
  would make a future `db:generate` believe it needs to (re)create what `0006` already did by
  hand, colliding with it. Both migrations applied cleanly to local Postgres and verified
  against `information_schema`/`pg_indexes` directly; a follow-up `db:generate` confirmed
  zero drift.
- ✅ `ExercisesRepository` (14 tests, real Postgres, matching the `UsersRepository`
  precedent): `upsertCatalogueExercise` (idempotent via `onConflictDoUpdate` targeting the
  partial index), `findById`, `createCustomExercise`/`updateCustomExercise` (case-insensitive
  duplicate-name rejection, enforced by the database, not only a read-then-write check —
  `ConflictException`), `softDeleteCustomExercise`, and `addFavourite`/`removeFavourite`/
  `isFavourite`. Never throws `NotFoundException` and never distinguishes "no such row" from
  "not yours" — both return `null`/`false`, matching `AthletesService`'s repo-returns-null /
  service-throws-404 split, which Phase G's controller will apply.
- **One real bug found and fixed along the way:** `isUniqueViolation` (the
  `UsersRepository`-style helper) only checked `error.code`, but this drizzle-orm version
  wraps every query failure in a `DrizzleQueryError` with the real pg error attached as
  `.cause`, confirmed by reading `drizzle-orm/errors.cjs`. Fixed to check both. **The
  equivalent helper in `UsersRepository` almost certainly has the same latent bug** — flagged
  as its own follow-up task rather than fixed here (out of this phase's scope), since it's a
  pre-existing file this phase didn't otherwise touch.

*Why first:* the only phase with a migration, so pausing here leaves the DB ahead of the API —
the safe direction. Same reasoning as slice 2's Phase A.

### Phase D — `ExerciseSourceAdapter` and the normalized snapshot — ✅ **DONE**

- `apps/api/src/exercises/ingest/`: the `ExerciseSourceAdapter` interface (the fourth use of
  the adapter pattern, alongside `AuthProvider` / `StorageProvider` / `HealthProvider`) and
  `FreeExerciseDbAdapter`.
- Deterministic mapping tables for category, equipment (free text → controlled vocabulary),
  `goal` (derived from category + mechanic + force) and `measure`, plus a version-controlled
  **override file** at `packages/domain/data/exercise-overrides.json` — the location
  `system.md` already designates, loaded as data so domain purity is untouched.
- `exercises:normalize` writes a checked-in snapshot; CI regenerates it and runs
  `git diff --exit-code`, exactly like the contracts fixtures gate. Ingest becomes reviewable
  in a PR diff instead of happening invisibly at deploy time.
- **Golden-fixture tests on the normalizer** (CLAUDE.md rule 8), covering every source category
  and each exercise an override exists for.
- **Add a fifth conformance check** to `scripts/ci/check-architecture-conformance.sh`: the raw
  dataset may only be read from the ingest directory. Watch it fail against a planted violation
  before committing it — that is the standing rule for every gate in this repo.

#### What Phase D produced

- `ingest/exercise-source-adapter.interface.ts` — `ExerciseSourceAdapter`, plus
  `NormalizedExercise` aliased to the repository's existing `UpsertCatalogueExerciseInput`
  rather than declared as a second shape, so the loader has nothing to translate.
- `ingest/mappings.ts` — the deterministic tables (7 source categories, 12 equipment strings,
  17 muscle names), the `goal`/`measure` derivations, and pass-through validation of
  `force`/`level`/`mechanic` against the canonical tuples. **Every lookup throws on a miss.**
  There is no fallback anywhere, on purpose: a default would let a re-vendor's new value be
  absorbed silently, and nobody would find out until a squat showed up under mobility.
- `ingest/free-exercise-db.adapter.ts` — **pure**: rows and overrides are constructor
  arguments and the class does no I/O. That is what lets the golden fixtures assert an exact
  record for a hand-built input, and it keeps a filesystem path out of what Phase E calls.
- `packages/domain/data/exercise-overrides.json` — 8 overrides, each with a written reason.
- `ingest/normalize.ts` + `pnpm --filter @forjd/api exercises:normalize` → the committed
  snapshot `ingest/data/normalized-exercises.json` (873 records, 1.15 MB, sorted by
  `sourceId` so a re-vendor that merely reorders produces no diff).
- **Golden-fixture tests**, all passing. Two are meta-tests that enforce the plan's own
  wording — one fails if a source category is added without a mapping test, the other if an
  override is added without a fixture assertion.
- CI gate: `exercises:normalize` then `git diff --exit-code` on the snapshot, mirroring the
  contracts-fixtures gate.
- **Fifth conformance check** in `scripts/ci/check-architecture-conformance.sh`: the raw
  dataset is readable only from `apps/api/src/exercises/ingest/`. Verified by planting a
  violating import and watching the check exit 1, then removing it.

#### Normalization outcome, and one finding Phase I needs

873 exercises in, 873 out. Distribution:

| | |
|---|---|
| category | strength 675, mobility 123, cross_training 71, running 4 |
| goal | strength 369, hypertrophy 250, mobility 123, power 117, muscular_endurance 14 |
| measure | weight 736, time 127, distance 10 |

**Two canonical categories end up with zero catalogue exercises: `yoga` and `calisthenics`.**
free-exercise-db has no source category that maps to either. The design's exercise library
draws a filter chip for both, so on a freshly ingested catalogue **those two chips would show
an empty list** — a real, visible product problem, not a cosmetic one.

This was left as a finding rather than papered over with a mapping, because every available
fix is a product decision, not a mechanical one:

- Reclassify the 111 `body only` strength exercises as `calisthenics` — defensible (pull-ups
  and push-ups genuinely are), but it silently moves an eighth of the catalogue on a guess,
  and it still leaves `yoga` empty.
- Source yoga and calisthenics content separately — a second adapter, which is exactly what
  the adapter pattern is for, but it is scope Phase 2 does not have.
- Hide chips with no results, or drop the two categories from the library's chip row.

**Phase I must pick one.** Do not let the chips ship pointing at nothing.

Also worth knowing: **4 of the 16 canonical `EQUIPMENT` values never appear** (`bench`,
`rack`, `trx`, `sled`) and **2 of the 19 `MUSCLE_GROUPS` never appear as a primary muscle**
(`hips`, `full_body`). Custom exercises can produce all of them, so these are gaps in the
seed data, not in the vocabulary. 122 exercises carry equipment `other` and 77 carry none at
all — the source's own limitation, transcribed rather than guessed at.

> **Next session starts here → Phase E.**

### Phase E — Loader and the browse/search endpoint

- `exercises:load` — idempotent upsert keyed on `(source, source_id)`, safe to re-run. Wired
  into `deploy-api.yml` after `db:migrate`, since idempotency is what makes that safe; **not**
  a migration, because 870 content rows are not schema.
- `GET /api/v1/exercises` — `q`, `category`, `muscle`, `equipment`, `favourite`, cursor
  pagination. **The first `@Query(new ZodValidationPipe(...))` in the codebase**, so the schema
  needs `z.coerce` for numeric params.
- `GET /api/v1/exercises/:id`.
- Define the list envelope in `@forjd/contracts` — `{ items, nextCursor }` — deliberately,
  since it becomes the house pattern for every list endpoint after this. Write every field out;
  do not derive projections with `.pick()`, per the `publicProfileResponseSchema` comment.
- Fixtures regenerated in the same commit. Unit + e2e tests.

### Phase F — Media mirror *(the stopgap)*

- Create a **public `exercise-media` bucket**; `exercises:mirror-media` fetches the images from
  the pinned upstream commit and uploads them through **`StorageProvider`** — rule 11, no
  Supabase SDK outside the provider directory. Idempotent: skip objects that already exist, so
  a re-run after a partial failure is safe.
- `mediaBaseUrl` config; the service resolves `imageKeys` → URLs at read time. **The database
  never stores a full URL.** That single choice is what keeps swapping to a licensed pack, or
  to Cloudflare in front of the bucket, a config change rather than a migration.
- Finalize **ADR-018** with the measured numbers, and record the free-tier ceiling that applies
  (Supabase free: ~1 GB storage, ~5 GB egress/month) alongside the note that `expo-image`'s disk
  cache means a device pays for each image roughly once.

This is `StorageProvider`'s first real consumer, a phase earlier than InBody needed it.

### Phase G — Custom exercises and favourites API

- `POST /exercises`, `PATCH /exercises/:id`, `DELETE /exercises/:id` (soft), owner-only.
  Duplicate-name rejection mirrors the prototype's check and is backed by the partial unique
  index, so the race is closed in the database rather than only in the service.
- `PUT` / `DELETE /exercises/:id/favourite`.
- Ownership and refusal policy live in `ExercisesService`, not only in SQL (rule 12), with a
  **100% coverage pin** on `exercises.service.ts` in `coverageThreshold` — the house pattern
  for policy-bearing code, matching `athletes.service.ts` and `privacy.service.ts`.

### Phase H — Catalogue sync endpoint and the on-device store

- `GET /exercises/catalogue` returning the full catalogue plus a `catalogueVersion`.
- `apps/mobile/src/store/exercise-catalogue.ts` — `expo-sqlite` behind a function seam, the way
  `notification-preferences.ts` wraps AsyncStorage. Screens never touch SQLite directly, and a
  source-text conformance test pins the import to that one module (the `apiClient.test.ts`
  precedent).
- FTS5 virtual table over name + muscles + equipment; version-gated re-sync on launch.
- **ADR-019.**

> ### ⚠ Reconcile with the 2026-08-30 design revision before starting Phase I
>
> The prototype was regenerated after this plan was written. Three things changed for phases
> I-K, and **every prototype line number cited in this file and in
> `docs/design/phase2-screen-specs.md` is now wrong** — the file grew by ~1,400 lines.
> Re-anchor with `grep -nE "^s*s_[A-Za-z0-9_]+s*("` rather than trusting a citation.
>
> 1. **`newExercise` is a real screen now** (`s_newExercise`, line 3065), not the sketch this
>    plan's Phase K was written against. Full spec, including its four validation messages and
>    the `Measured by` field: `docs/design/design-revision-screen-specs.md` §3.
> 2. **`favorites` is a real screen now** (`s_favorites`, line 3007) — previously dead code
>    reachable only from the prototype's screen index, which is why this plan folded favourites
>    into the library's filter chip alone. It ships **two** sections (programs, workouts) and
>    **not** the favourite-exercises section its own caption promises; that list is defined at
>    lines 3017 and 3040-3048 and never rendered. Spec: §2 of the same file. The programs half
>    depends on Phase 4, so Phase I can ship the chip and defer the screen.
> 3. **The vocabulary subset question is now explicit.** `newExercise` offers 13 muscle chips
>    against `MUSCLE_GROUPS`'s 19, and 12 equipment chips against `EQUIPMENT`'s 16. That is a
>    subset, not a conflict — but Phase K must decide and record whether the picker shows the
>    subset or the full enum. The category tuple still matches `EXERCISE_CATEGORIES` exactly,
>    so `exercise-vocabulary.spec.ts` is unaffected.

### Phase I — Library screen and the Train entry point

`/library` outside the `(tabs)` group with `<TabBar active="train" />`, following
`athlete/[userId].tsx`. Search box, the eight chips **including `Favourites`**, the `Recent`
section, `All exercises`, the star toggle, both empty states, and the three tap modes
(`browse` / `pick=workout` / `pick=routine`) as expo-router search params — the handoff itself
says `libraryPickMode` belongs in the URL.

Plus the two prototype quick-action rows on `train.tsx` (`Start a run`, `Exercise library`),
and nothing else on that screen.

Box-model styles go in NativeWind `className`, never a raw inline `style` callback on a
`Pressable` — the Phase I lesson from slice 2, which rendered correctly on web and broke on a
physical device.

### Phase J — Exercise detail, including the running variant

`/exercise/[id]`. The branch is **by category, not by route**: `s_exercise` returns
`s_exerciseRun` when `category === 'Running'`. Stat tiles, sparkline and history need Phase 3
session data — omit them entirely rather than rendering zeros, consistent with how the athlete
screen's stat tiles were handled.

### Phase K — Custom exercise create / edit / delete screen

`/new-exercise`, doubling as the edit screen as the prototype does. Multi-select muscles and
equipment, description, category, `Measured by`, and the ordered toast validation
(name → ≥1 muscle → ≥1 equipment → duplicate name). Delete confirmation sheet.

**Known deviation to apply without asking:** the prototype's delete copy says "permanently
removed. This can't be undone." We soft-delete, so reword to stay truthful to the user while
the row survives for Phase 3 session history. Record it in the deviations list.

---

## Files this touches

New, in the order they appear:

- `docs/product/phase-2-plan.md`, `docs/design/phase2-screen-specs.md`
- `docs/decisions/ADR-017-canonical-exercise-model.md` *(reserved, not yet written)*,
  `ADR-018-exercise-media-hosting.md` *(written)*,
  `ADR-022-on-device-exercise-catalogue.md` *(reserved — **renumbered from 019**, which the
  2026-08-30 design revision took for username/avatar; see "Note on numbering" below)*
- `apps/api/src/database/schema/exercises.schema.ts`, `exercise-favourites.schema.ts`
- `apps/api/drizzle/0005_*.sql`
- `apps/api/src/exercises/` — `exercises.module.ts`, `.controller.ts`, `.service.ts`,
  `.repository.ts`, `ingest/` (adapter, mappings, data, scripts), all with co-located specs
- `apps/mobile/src/store/exercise-catalogue.ts`
- `apps/mobile/src/app/library.tsx`, `exercise/[id].tsx`, `new-exercise.tsx`

Modified: `packages/domain/src/index.ts`, `packages/contracts/src/index.ts` + `fixtures.ts`,
`apps/api/package.json` (scripts + `coverageThreshold` pin), `apps/mobile/src/auth/apiClient.ts`,
`apps/mobile/src/app/(tabs)/train.tsx`, `scripts/ci/check-architecture-conformance.sh`,
`.github/workflows/deploy-api.yml`, `docs/architecture/domain-model.md` + `integrations.md`,
`docs/product/roadmap.md`, `docs/decisions/ADR-005-exercise-dataset.md`.

## Reuse, don't rediscover

`ZodValidationPipe`; the `Symbol` DI token pattern and `@Global() DatabaseModule`;
`SupabaseStorageProvider` (built in slice 5, still unconsumed); `AthletesService` as the model
for a read/projection service with a 404 refusal; `users.repository.spec.ts` as the model for a
real-Postgres repository test; `write-fixtures.ts` + `git diff --exit-code` as the model for
the ingest snapshot gate; `components/tab-bar.tsx`; `components/icon.tsx` (all nine needed
glyphs already exist); `components/screen-background.tsx`; `theme/tokens.ts`;
`classifyRequestFailure` / `actionableServerMessage` in `auth/failure.ts`; and
`store/notification-preferences.ts` as the model for a storage seam.

## Verification

Test-first per phase (RED → GREEN), not tests-eventually. Every gate is watched failing against
a planted violation before it is committed.

**PowerShell — development here is Windows.** Never run the API and mobile Jest suites at the
same time; they starve each other and report false failures (617 s / 504 s with failures versus
24 s / 72 s green when run alone).

```powershell
docker compose up -d
pnpm install; pnpm -r build
pnpm --filter @forjd/api db:migrate
pnpm --filter @forjd/api lint; pnpm --filter @forjd/api test:cov
pnpm --filter @forjd/api test:e2e
pnpm --filter @forjd/contracts fixtures; git diff --exit-code packages/contracts/fixtures
bash scripts/ci/check-architecture-conformance.sh
```

Then, separately:

```powershell
pnpm --filter @forjd/mobile typecheck; pnpm --filter @forjd/mobile lint
pnpm --filter @forjd/mobile test --ci
```

End to end, on the physical iPhone via Expo Go against deployed staging (Jest compiles neither
NativeWind nor native modules, so a real bundle is the only proof): Train → Exercise library →
the catalogue loads → search narrows it → each chip filters → star an exercise → the Favourites
chip shows it → open an exercise and confirm its images load from our bucket → open a Running
exercise and confirm the run variant → `＋ New` → create a custom exercise → it appears in the
library → edit it → delete it → **turn airplane mode on and confirm the library still browses
and searches**, which is the only check that proves the on-device FTS5 store is real rather than
a cache in front of the network.

Review agents (`code-reviewer`, `security-reviewer`, `typescript-reviewer`, `react-reviewer`,
`database-reviewer`) run over the changed code before any phase is called done.

## Open items — surfaced, not silently absorbed

1. **The imagery is a stopgap, and is recorded as one.** Replacing it needs either budget
   (ExerciseDB Pro at ~$299–599 is the cheapest with explicit self-hosting rights) or a legal
   read on Everkinetic's CC BY-SA share-alike — which is the *same* question ADR-005 already
   queued for wger, so it costs nothing extra to add to that conversation. ADR-018 records both
   routes so this does not have to be researched again.
2. **Custom SMTP is required before beta.** Supabase's built-in mailer caps a project at ~2–4
   emails/hour, which with email confirmation on *is* the signup ceiling — it was hit within
   minutes during the slice 14 walk. A project setting, not a code change.
3. **Production setup carries two known-wrong secrets** (`forjd-production-database-url` holds
   the IPv6 direct string, not the session pooler) **and will hit all five failure modes**
   recorded under slice 13 in the roadmap. Read that list before doing prod.
4. **RLS is still enabled on no table**, and Phase 2 adds a public storage bucket. The standing
   gating rule is "enable RLS before any client receives a Supabase credential." A *public*
   media bucket hands no client a credential, so this does not trip the rule — but it is the
   closest anything has come, and it remains a human decision.

## Note on numbering

This plan reserved **ADR-017** (canonical exercise model) and **ADR-019** (on-device exercise
catalogue) before either was written. ADR-018 was written; the other two were not.

The 2026-08-30 design revision then wrote **ADR-019 (username and avatar)**, **ADR-020**
(nutrition in MVP) and **ADR-021** (subscription UI without billing) as real files. A written
ADR outranks a reservation, so:

- **ADR-017 stays reserved** for the canonical exercise model. Nothing else may take it.
- **The on-device catalogue ADR moves to ADR-022.** Its old number is taken.
- The next free number after this plan and the design revision together is **ADR-023**.
