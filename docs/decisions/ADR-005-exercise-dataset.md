# ADR-005: Exercise dataset source

**Status:** Accepted

## Context

The exercise library is core product content (Phase 2) and needs to exist
day one, not grow from a hand-authored seed. `FitnessApp.md` §12 specifies
the canonical `Exercise`/`ExerciseVariant` shape this must normalize into.

Per the source planning discussion, open-source datasets are evaluated
first, with a paid/licensed API and a hybrid (open-source base + own
curation) as fallback positions — see the plan's decision D8.

## Decision

Use **`free-exercise-db`** (github.com/yuhonas/free-exercise-db) as the
Phase 2 seed dataset. Its content is dedicated to the public domain under
the Unlicense — the only one of the three candidates with zero attribution
or share-alike obligations — and its taxonomy (`primaryMuscles`,
`secondaryMuscles`, `equipment`, `category`, `instructions`) maps directly
onto the `ExerciseSourceAdapter` normalizer pattern (ADR-003) without any
legal caveats to design around.

`wger`'s exercise data is explicitly **rejected as an ingestion source for
now** (see findings below) — not because the taxonomy is worse (it's
comparable), but because its CC-BY-SA license carries a share-alike
obligation that is a genuine open legal question for a closed-source,
paid-app database and needs a human legal read before any of its content
is merged in. It stays an option to revisit if that reading comes back
favorable, since 873 exercises there are not already in free-exercise-db's
~870.

The evaluated commercial baseline, **exercisedb.io** ("EDB Exercise
Intelligence," the commercial storefront that superseded the original
RapidAPI ExerciseDB listing), is **deferred, not rejected** — it has the
best taxonomy of the three (17 fields, plus a substitution/progression/
regression relationship graph that maps well onto `ExerciseVariant`) and
an unambiguous one-time commercial license, but it's a $299+ spend that
isn't needed to unblock Phase 2. Revisit it as a paid upgrade once the app
has traction and the relationship graph and higher-resolution GIFs
(exercise media is the weakest part of free-exercise-db — two static
frames per exercise, no video) are worth paying for.

This is a **base dataset + override layer** decision, not a
single-source-forever one: free-exercise-db unblocks Phase 2 today at zero
legal risk; the override mechanism (`docs/architecture/workout-engine.md`)
patches gaps; wger and exercisedb.io remain candidates for a later,
explicitly-scoped content expansion once (respectively) legal signs off
and budget allows.

## Evaluation criteria

| Criterion | Why it matters |
|---|---|
| Total exercise count | Baseline completeness |
| **Muscle-group taxonomy quality** | This is what the `ExerciseSourceAdapter` normalizer (ADR-003's pattern, applied to content) maps into the canonical model. A bad taxonomy is the expensive problem — missing exercises are cheap to patch via the override mechanism (see `docs/architecture/workout-engine.md`), a bad taxonomy corrupts search/filter/substitution logic throughout the app. |
| Media availability & license | Images/video, and whether the license permits commercial redistribution in a paid app |
| Instruction text quality | User-facing content quality |
| Explicit commercial-use permission | Read the actual license text, not a summary |

### Findings (Spike A, 2026-08-19)

| Criterion | free-exercise-db | wger | exercisedb.io (commercial) |
|---|---|---|---|
| Exercise count | ~870 (per repo README; `dist/exercises.json`) | 873 language-independent entries via `api.wger.de/api/v2/exerciseinfo/` (translations don't inflate the count) | 1,394, plus 10,971 "similar exercise" links, 7,401 substitutions, 5,676 progression/regression links |
| Taxonomy fields | `category`, `equipment` (single value), `primaryMuscles`/`secondaryMuscles` (arrays), `force`, `level`, `mechanic` | `category`, `equipment`, `muscles`/`muscles_secondary` — structurally similar to free-exercise-db, backed by a normalized muscle table | 17 taxonomy fields (undocumented in full at the free tier) plus the substitution/progression/regression graph — the richest of the three, and the graph maps directly onto `ExerciseVariant` relationships |
| Media | 2 static JPG frames per exercise (start/end position), no video | Static images + a `videos` field that is empty on most sampled entries | Animated GIFs at 4 resolutions (180x180 to 1080x1080), no static images or video mentioned |
| Instructions | `instructions` array, real step-by-step text, but the README itself notes some entries are incomplete | Per-exercise `translations` array with step-by-step text; community-contributed so quality is inconsistent entry-to-entry | Not independently verified (behind the paid tier); marketing copy claims full step-by-step coverage |
| License (verbatim) | Unlicense: *"This is free and unencumbered software released into the public domain. Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software... for any purpose, commercial or non-commercial..."* — [unlicense.org](https://unlicense.org), repo [LICENSE.md](https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE.md) | Software: AGPL 3+. **Data is licensed separately**: *"The initial exercise and ingredient data is licensed additionally under a Creative Commons Attribution Share Alike 3.0 (CC-BY-SA 3.0)"* — [wger.readthedocs.io](https://wger.readthedocs.io/en/stable/). Individual exercises can carry their own CC version/author (a sampled API entry showed `"license": "Creative Commons Attribution Share Alike 4"` with a distinct `license_author`) | exercisedb.io FAQ: *"You can use the dataset commercially and display the exercise GIFs inside your app, platform, or product"* and *"The license is for using the data and visuals inside your own app or product. It does not allow reselling, sublicensing, redistributing... as a downloadable exercise database, media library, API, or competing dataset."* Sold as a one-time commercial license, separate from the AGPL-3.0-licensed open-source *server software* at github.com/ExerciseDB/exercisedb-api (that AGPL only applies if FORJD ran their server code, which it wouldn't) |
| Commercial-use verdict | **Unambiguous yes**, no attribution or share-alike obligation | **Legally live question**: CC-BY-SA permits commercial use but requires (a) per-exercise attribution to `license_author`/`author_history`, and (b) share-alike on the *data* — arguably requiring FORJD's normalized/derived exercise dataset to also be redistributable under CC-BY-SA even inside a closed-source paid app. Not resolved by this spike. | **Unambiguous yes** via the paid one-time license ($299 mobile / $399 web-desktop / $599 cross-platform tier, per exercisedb.io/pricing), explicitly permits editing and self-hosting the purchased data |
| Maintenance | Low-frequency but stable; most recent commit May 2026 after a prior multi-month gap — acceptable for a dataset meant to be forked/vendored, not tracked live | Actively developed as part of the larger wger project; API is live at wger.de | Commercial product, actively sold as of this spike |

## Consequences

- **Chosen source:** `free-exercise-db` (github.com/yuhonas/free-exercise-db),
  vendored as the Phase 2 ingestion input, not consumed live over the
  network (it's a static JSON dataset, not an API).
- **License terms (verbatim, with source link):** Unlicense — *"This is
  free and unencumbered software released into the public domain. Anyone
  is free to copy, modify, publish, use, compile, sell, or distribute this
  software, either in source code form or as a compiled binary, for any
  purpose, commercial or non-commercial, and by any means."*
  [unlicense.org](https://unlicense.org) /
  [repo LICENSE.md](https://github.com/yuhonas/free-exercise-db/blob/main/LICENSE.md).
- **Attribution obligations:** None required by the license. Crediting the
  dataset in an about/licenses screen is good practice, not a legal
  requirement.
- **One provenance item to sanity-check before Phase 2 ingestion, not
  blocking:** the exercise images are sourced from the upstream
  `wrkout/exercises.json` project (credited to Ollie Jennings in
  free-exercise-db's README). The free-exercise-db repo's own LICENSE.md
  applies Unlicense terms to the whole repo including `dist/` and
  `exercises/` (which contain the image paths), so this is covered — worth
  a five-minute re-check at ingestion time if the upstream image set ever
  changes, not a reason to hold up this decision.
- **Fields usable as-is:** `name`, `category`, `equipment`,
  `primaryMuscles`, `secondaryMuscles`, `instructions`, `images` map
  directly to canonical `Exercise`/`ExerciseVariant` fields with light
  renaming.
- **Fields requiring the normalization/override layer:** `equipment` is a
  single free-text value, not a controlled vocabulary — needs mapping to
  FORJD's equipment taxonomy. `force`/`level`/`mechanic` are
  free-exercise-db-specific and need a decision on whether they surface in
  the canonical model or stay as adapter metadata. Media is thin (2 static
  frames, no video) — flagged for the override/enrichment file rather than
  blocking ingestion, per the "missing media is cheap to patch later"
  principle in the evaluation criteria above.
- **Deferred, not adopted:** `wger`'s exercise data — CC-BY-SA share-alike
  implications for a closed-source paid app are unresolved; needs a human
  legal read before any content from it is merged into the canonical
  dataset. `exercisedb.io`'s commercial dataset ($299+ one-time,
  unambiguous commercial license) — not needed to unblock Phase 2, revisit
  as a paid content upgrade (richer taxonomy, substitution/progression
  graph, higher-res GIFs) once there's budget and traction to justify it.

Do not begin the Phase 2 ingestion pipeline changes beyond what this ADR
already scopes (free-exercise-db as the seed source) without a follow-up
ADR or an update to this one.
