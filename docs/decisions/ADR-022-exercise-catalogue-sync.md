# ADR-022: On-device exercise catalogue — sync contract and local schema

**Status:** Accepted, shipped Phase H.

**Note on numbering:** `phase-2-plan.md`'s original Phase H bullet list cites "ADR-019" for
this decision. That number was already claimed by ADR-019 (username and avatar) by the time
this phase was implemented — a stale reference from an earlier draft of the plan, not a
deliberate reuse. This is ADR-022, the next free number.

## Context

Phase G shipped the exercise API (browse/search, custom exercises, favourites). Workout
execution (Phase 3) must work fully offline — CLAUDE.md rule 6: "the network is never in the
critical path of a live workout session" — which means the device needs the whole exercise
catalogue (~1,700+ rows once custom exercises are added) available locally, searchable,
before a session starts, not fetched exercise-by-exercise as it comes up mid-workout.

Three questions needed answers before writing any code: what does the sync endpoint return,
how does the client know when to bother re-syncing, and what local store holds it.

## Decision

### The endpoint returns the whole visible set, unpaginated, plus a version

`GET /exercises/catalogue` returns `{ exercises: ExerciseResponse[], catalogueVersion: string }`
— catalogue rows plus the caller's own custom exercises, every field `exerciseResponseSchema`
already defines for the detail screen. Deliberately not the leaner `exerciseSummarySchema`
the browse list uses: a device that synced only summaries would still need a network call the
first time a workout referenced an exercise's instructions, which is exactly the round trip
rule 6 forbids.

Deliberately unpaginated, unlike `GET /exercises`: pagination exists there to bound a
scrolling UI's page size, not because 1,700 rows is too many to send in one response body (at
the measured ~1-2 KB/row this JSON shape produces, the whole catalogue is a few megabytes,
comparable to a handful of the exercise images Phase F already accepts sending over mobile
data). A sync endpoint has no scroll position to bound.

### `catalogueVersion` is a content hash, not a counter or a timestamp

`ExercisesService.deriveCatalogueVersion` runs SHA-256 over every visible row's `id:updatedAt`
pair, in the repository's stable `(name, id)` order, and returns the hex digest. Two
alternatives were rejected:

- **A monotonic counter** needs a place to live (a new table or column) and something to
  remember to increment on every write path that touches a catalogue-visible row — a
  requirement `upsertCatalogueExercise`, `createCustomExercise`, `updateCustomExercise` and
  `softDeleteCustomExercise` would all have to honour forever, with no test able to catch a
  future write path that forgets.
- **A bare `MAX(updatedAt)`** looked simpler but is wrong on a soft-delete: removing a row
  from the visible set changes nothing about any *surviving* row's `updatedAt`, so the maximum
  would not move and a client would never notice a delete happened.

A content hash needs no storage and no write-path discipline — it is recomputed from the same
query `listForSync` already runs, and it changes if and only if the visible *set* or any row's
*content* actually changed, covering the add/edit/delete cases in one mechanism.

**The hash deliberately ignores `isFavourite`.** Favouriting an exercise is a materially
higher-frequency action than adding or editing one, and hashing it in would force a full
1,700-row re-sync on every star tap. The mobile store instead writes a favourite toggle into
its own local mirror immediately after `PUT`/`DELETE /exercises/:id/favourite` succeeds
(`setLocalFavourite` in `exercise-catalogue.ts`), independent of the version-gated bulk sync —
two different frequencies of change, two different invalidation paths, deliberately not
unified into one.

### The device store is SQLite with an FTS5 index, behind a function seam

`apps/mobile/src/store/exercise-catalogue.ts`, mirroring `notification-preferences.ts`'s
AsyncStorage wrapper exactly: screens never touch SQLite directly, and
`check-architecture-conformance.sh` pins the `expo-sqlite` import to this one file, the same
enforcement `expo-secure-store` already has (ADR-011).

- **SQLite over AsyncStorage**, because this is genuinely relational data at a size
  `notification-preferences.ts`'s own comment already carves out as SQLite's job (that file:
  "AsyncStorage is the right store for five scalars... `expo-sqlite` is a table holding
  something relational").
- **FTS5 for search**, matching Phase E's server-side approach (GIN + trigram indexes) with
  the mobile-appropriate equivalent: a contentless FTS5 virtual table indexing name, muscles
  and equipment, joined back to a plain table (`exercises_cache`) that holds the row's real
  JSON. `content=''` semantics keep exactly one place a row's real content lives, rather than
  duplicating it into the index.
- **A full replace on every re-sync, not a diff.** There is no id-level change feed from the
  server to diff against — `catalogueVersion` proves *that* something changed, not *what*.
  Wiping and rebuilding both tables inside one `withTransactionAsync` is simple and, at ~1,700
  rows, cheap enough that building a diffing path would cost more engineering than it saves.
- **Every function takes its `SqliteConnection` as an argument, injected**, not opened inside
  the module's own top-level code. Same fix as `SupabaseStorageProvider`'s constructor
  (ADR-011 again): `expo-sqlite`'s native module cannot run under plain Jest, so a module that
  built its own connection would be verifiable only by hand on a device. `openExerciseCatalogueDb()`
  is the one function that calls the real `expo-sqlite` API and is the one piece of this file
  a device walk, not Jest, has to prove — the same "Jest cannot prove a screen renders on a
  device" limitation already accepted for HealthKit/Health Connect (CLAUDE.md rule 16), even
  though rule 16 itself is scoped to health providers specifically.

## Consequences

- A client that has never synced, or whose stored version no longer matches, pays for a full
  rebuild (parse + insert ~1,700 rows, twice — once into `exercises_cache`, once into
  `exercises_fts`). Not yet measured on a physical device; if this proves slow in practice,
  the fix is `execAsync`-batched inserts inside the same transaction rather than one
  `runAsync` per row, without changing anything about the version contract above.
- Favourite state on the device can only ever be as fresh as the last successful
  `PUT`/`DELETE /exercises/:id/favourite` call that reached `setLocalFavourite`. A favourite
  toggled on a second device is invisible locally until the *next* full re-sync happens to
  fire for an unrelated reason (a catalogue edit, a new custom exercise) — there is no
  independent low-cost favourite-only sync. Acceptable for a single-user, mostly-single-device
  app at this phase; revisit if multi-device favourite consistency becomes a real complaint.
- The FTS5 query in `searchExercises` treats every whitespace-separated term as an independent
  prefix match (`term*`) ANDed together, which is deliberately simple relative to Phase E's
  server-side `tsquery`/trigram combination — the device index exists for offline continuity
  during a workout, not to reproduce the browse screen's full search quality without a
  network.
