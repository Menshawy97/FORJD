# Source: free-exercise-db

`free-exercise-db.json` in this directory is `dist/exercises.json` from
[yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db), vendored verbatim
(pretty-printed for reviewable diffs; no field renamed or reordered) rather than consumed live —
see ADR-005.

## Pin

- **Commit:** [`b0eed061e1c832b3ed815fbaa4b45b3cdc14df49`](https://github.com/yuhonas/free-exercise-db/commit/b0eed061e1c832b3ed815fbaa4b45b3cdc14df49)
- **Fetched:** 2026-08-24, from `raw.githubusercontent.com/yuhonas/free-exercise-db/<sha>/dist/exercises.json`
- **Re-vendoring:** re-run the same fetch against a newer commit SHA and update this file's pin.
  Nothing else in the ingest pipeline needs to change — `ExercisesRepository` upserts on
  `(source, source_id)`, so a re-vendor is safe to re-run.

## Measured numbers (this pin)

| | |
|---|---|
| Exercises | **873** |
| Image paths | **1,746** (exactly 2 per exercise — a start and an end frame; none has zero) |
| `exercises.json` size | ~1.0 MB |
| Sampled image size | 51 images sampled at a fixed stride, avg **~52 KB/image** |
| Estimated total image bytes | **~88.6 MB** (52 KB x 1,746) |
| Source categories | `strength` 581, `stretching` 123, `plyometrics` 61, `powerlifting` 38, `olympic weightlifting` 35, `strongman` 21, `cardio` 14 |
| `force` | `pull` 371, `push` 369, `static` 104, unset 29 |
| `level` | `beginner` 523, `intermediate` 293, `expert` 57 |
| `mechanic` | `compound` 489, `isolation` 297, unset 87 |
| `equipment` (free text, 12 distinct values) | `body only` 111, `machine` 67, `other` 122, `foam roll` 11, `kettlebells` 53, `dumbbell` 123, `cable` 81, `barbell` 170, `bands` 20, `medicine ball` 17, `exercise ball` 12, `e-z curl bar` 9 |

The 88.6 MB estimate confirms the 60-100 MB range ADR-018 assumed before this measurement, and
is well inside Supabase's free-tier storage ceiling (~1 GB).

## License — verified independently at this pin, two layers

**This repository (`free-exercise-db`), `LICENSE.md`, fetched at the pinned commit, verbatim:**

> This is free and unencumbered software released into the public domain. Anyone is free to
> copy, modify, publish, use, compile, sell, or distribute this software, either in source code
> form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means.

**The upstream image source, [`wrkout/exercises.json`](https://github.com/wrkout/exercises.json)**
(credited in this repo's README, Thanks section: *"Ollie Jennings ... for the original
dataset"*) — **checked independently via the GitHub API's declared repository license**, not
assumed from the credit line: `license.spdx_id: "Unlicense"`. Both layers are public domain;
there is no attribution or share-alike obligation at either layer.

This closes the "five-minute provenance re-check" ADR-005 asked be done at ingestion time.

## Fields used as-is vs. requiring normalization

Per ADR-005 and confirmed against the real data above:

- **As-is:** `name`, `category` (source vocabulary — mapped to canonical categories by the
  adapter, Phase D), `primaryMuscles`, `secondaryMuscles`, `instructions`, `images` (paths only —
  the bytes are mirrored separately, ADR-018).
- **Normalized by the adapter:** `equipment` (free text, 12 distinct values here — mapped to
  the canonical `EQUIPMENT` tuple). `force`/`level`/`mechanic` are kept as nullable canonical
  columns per ADR-017 rather than adapter metadata. `goal` and `measure` do not exist in this
  source at all and are derived by the adapter from `category`/`mechanic`/`force`.
