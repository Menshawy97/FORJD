# ADR-023: Food database source and search topology

**Status:** Accepted
**Date:** 2026-08-31

Settles Open Questions 1 and 2 from `docs/product/nutrition-plan.md`, which Phase A of that
plan is gated on.

## Context

Phase 2.5 needs a real food database. The prototype ships 38 hardcoded rows, which is a demo,
not a source — `nutrition-plan.md` named this the decision the rest of the phase depends on,
the same way ADR-005 was for the exercise catalogue.

Two realistic candidates were on the table:

- **USDA FoodData Central** — public domain, needs a free API key. Strong for whole/generic
  foods, weaker for packaged and non-US products.
- **Open Food Facts** — no API key, huge packaged-food coverage with barcodes. Licensed
  **ODbL**, a share-alike licence for the database itself.

This is the third time the same licensing question has come up. ADR-005 queued it for wger's
CC-BY-SA exercise data; ADR-018 queued it again for Everkinetic's CC-BY-SA imagery. Open Food
Facts' ODbL raises the identical unresolved question a third time: does a share-alike
obligation on the *data* propagate to a closed-source paid app that only serves derived
values (calories, macros) through its own API, never the raw dataset. Nobody has answered
this for the first two instances yet.

A hybrid (USDA for whole foods, Open Food Facts for barcodes) is functionally the best
coverage, but it doubles the normalisation surface for an MVP feature and still carries Open
Food Facts' unresolved question — it does not avoid the legal review, it just makes the
review's answer matter for less of the total dataset.

## Decision

**USDA FoodData Central**, public domain, no share-alike or attribution obligation. This
keeps nutrition on the same clean legal footing free-exercise-db already gave the exercise
catalogue (ADR-005) — nothing added to the queue that is already waiting on legal engagement
for wger and Everkinetic.

**Search is server-side only, no on-device sync.** Phase 2's `expo-sqlite` + FTS5 catalogue
mirror exists because offline *workout execution* is a hard requirement (CLAUDE.md rule 6,
the network must never be in the critical path of a live session) and the exercise catalogue
is small enough (~870 rows) to mirror in full. Neither condition holds for food: there is no
equivalent "network is in the critical path of an in-progress set" moment for food search,
and FoodData Central's full dataset (300k+ entries across all data types) is a different
proposition from 870 exercises — a full on-device mirror would need its own filtering,
storage, and sync-versioning design for a feature with no hard offline requirement to justify
it. `nutrition-plan.md`'s existing "reads may be cached, writes are online-only" decision
already covers the caching story; this ADR resolves that food *search* itself is a live API
call, not a local FTS5 query, closing the plan's open question rather than leaving it
implicit.

## Consequences

- **Packaged and non-US foods are weaker.** FoodData Central's `Branded` type has real but
  thinner coverage than Open Food Facts, and non-US products are largely absent. Acceptable
  for MVP, where the intended outcome is calorie/macro logging against a real database, not
  barcode-driven packaged-food coverage.
- **Barcode scanning is not available from this source in any near-term form.** It was never
  in the design or in scope for Phase 2.5 (nutrition-plan.md Open Question 3), but this
  decision forecloses it more firmly than a hybrid would have. If barcode scanning becomes a
  real requirement later, Open Food Facts (or a paid alternative) becomes a second-source
  question at that point — its ODbL question would need answering then, not deferred further.
- **An API key is required**, provisioned the same way as any other secret (rule 5: no
  secrets in mobile source, server-side only) — `USDA_FDC_API_KEY` in `apps/api`'s
  environment, never in `apps/mobile`.
- **No on-device food-catalogue table, ever, under this decision.** If a future requirement
  changes this (e.g. offline meal logging becomes load-bearing), that is a new ADR, not a
  quiet extension of this one — the reasoning above is specific to food search having no
  hard offline requirement today.
- **Custom foods remain unaffected.** They are a FORJD-owned table (`nullable owner_user_id`,
  the `exercises` precedent per `nutrition-plan.md`'s locked decisions), searched the same
  server-side way alongside FoodData Central results, not mirrored on-device either.

## Related

- [ADR-005 — exercise dataset](ADR-005-exercise-dataset.md) — the wger share-alike question,
  still open, that this ADR deliberately avoids adding a third instance of
- [ADR-018 — exercise media hosting](ADR-018-exercise-media-hosting.md) — the Everkinetic
  share-alike question, same open status
- [ADR-022 — exercise catalogue sync](ADR-022-exercise-catalogue-sync.md) — the on-device FTS5
  pattern this ADR deliberately does not extend to food
- [`../product/nutrition-plan.md`](../product/nutrition-plan.md) — Open Questions 1 and 2,
  now settled
