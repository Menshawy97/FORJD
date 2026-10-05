# ADR-017: Canonical exercise model

**Status:** Accepted. Decided 2026-08-24 in the Phase 2 re-plan and shipped in Phase 2; this file was
written on 2026-10-05 to close a gap. The number was reserved by `phase-2-plan.md` and cited from code
and docs for six weeks before the file existed, so this record states what was decided then and what the
code does now. It introduces no new decision.

## Context

Phase 2 ingests ~870 exercises from free-exercise-db (ADR-005) and lets people author their own, and
Phase 3's workout sessions reference exercises by id. `docs/architecture/domain-model.md` had sketched
`Exercise`/`ExerciseVariant` with join tables for muscles and equipment. Four questions had to be
settled before any schema existed: where custom exercises live, how muscles and equipment are stored,
what to do with fields only the source dataset has, and what to do about fields the dataset lacks.

## Decision

1. **One `exercises` table for catalogue and custom exercises.** `owner_user_id` is a nullable foreign
   key: `null` marks a catalogue row, a user id marks that user's custom exercise. A separate
   `custom_exercises` table was considered and rejected, because it would duplicate every column and
   every feature that touches exercises (favourites, workout logging, search) would have to query both
   tables and merge.
2. **Muscles and equipment are `text[]` columns, not join or reference tables**, and every closed value
   set is an `as const` tuple in `@forjd/domain` (`exercise-vocabulary.ts`) with a display-name map.
   Contracts build `z.enum(...)` from the tuples, and the UI never hardcodes a label. Columns are `text`,
   never Postgres enums, because narrowing a tuple is free and removing a value from a PG enum is
   impossible.
3. **`force`, `level` and `mechanic` are nullable canonical columns, not adapter metadata.** They come
   from free-exercise-db, so a custom exercise leaves them `null`. Keeping them canonical costs nothing,
   and a future source may supply them too.
4. **`goal` and `measure` are derived by the ingest adapter**, because free-exercise-db has neither.
   For a custom exercise the user chooses them. The categories are the design's own filter chips, not
   the source's seven categories; mapping between the two is the adapter's job (ADR-003's pattern).
5. **`exercise_variants` is not built.** Nothing in Phase 2 produces a variant, so the table is deferred
   to the workout engine (YAGNI).
6. **Deletion is soft** (`deleted_at`), because Phase 3 sessions reference exercises by id and a hard
   delete would orphan the foreign key or erase a session's own history. Refusing access to someone
   else's custom exercise is a **404, never a 403**, matching the athlete-profile enumeration defence.
7. **Media is a storage key, never a URL** (ADR-018).

## Consequences

- Every future feature queries one table. The cost is that catalogue-only columns (`force`, `level`,
  `mechanic`, `source`, `source_id`) are nullable and meaningless for custom rows, so readers must not
  assume they are set.
- Repositories map the array and nullable columns into the `Exercise` interface in `@forjd/domain`; the
  row is not the model.
- Full-text search (`search_vector`, a trigram index on `name`) is added by a hand-written migration
  and deliberately left out of the Drizzle schema object, so drizzle-kit does not try to recreate it. It
  is queried through raw `sql`, never the typed column builder.
- Adding a muscle group or equipment value is a tuple edit plus a catalogue re-ingest; there is no
  migration. The price is that the database does not enforce the set: the contract and the tuple do.
- A variant model, if one is ever needed, is a new table and a new ADR.

## Related

- [ADR-003](ADR-003-health-provider-abstraction.md): the adapter pattern the ingest follows
- [ADR-005](ADR-005-exercise-dataset.md): the dataset
- [ADR-018](ADR-018-exercise-media-hosting.md): storage keys and the media stopgap
- [ADR-022](ADR-022-exercise-catalogue-sync.md): the on-device copy of this model
- `packages/domain/src/exercise-vocabulary.ts` and `apps/api/src/database/schema/exercises.schema.ts`:
  the model in code
- `docs/product/phase-2-plan.md`: the locked-decisions table this record was taken from
