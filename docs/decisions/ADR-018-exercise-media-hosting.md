# ADR-018: Exercise media hosting

**Status:** Accepted

Supplements ADR-005, which chose the exercise *dataset*. This ADR covers the *imagery*
separately, because the two turn out to be independent decisions.

## Context

Phase 2 ingests ~870 exercises from `free-exercise-db` (ADR-005). That dataset ships two static
photographic JPGs per exercise — a start frame and an end frame. ADR-005 already flagged media
as "the weakest part of free-exercise-db," and on seeing them the product owner rejected them on
quality grounds and named the **Hevy** app as the bar to aim at.

That prompted two questions this ADR answers: what does that quality bar actually consist of,
and what can we have without spending money.

### What Hevy actually does

Inspecting a Hevy exercise page directly (`/exercises/arnold-press-dumbbell/`) shows the demo is
not an image at all. It is an MP4:

```
https://pump-app.s3.eu-west-2.amazonaws.com/exercise-assets/
  02871201-Dumbbell-Arnold-Press-II_Shoulders.mp4
```

Three facts follow. The media is a **3D-rendered animated MP4**, not a photograph. It is served
from **Hevy's own S3 bucket** (`pump-app` — Hevy's original product name was Pump), so they
licensed an asset pack and self-host it rather than hot-linking a vendor CDN. And the
eight-digit `02871201` prefix is a licensed third-party asset id; **which vendor issues that id
series could not be confirmed, and is deliberately not guessed at here.**

The useful conclusion is that Hevy's *architecture* is the one this project had already chosen
independently — license the media, own the bytes, serve them yourself, keep a storage key in the
database rather than a foreign URL. So media is a purchasing decision, not an architectural one,
and it can be deferred or swapped without redesigning anything.

### What the commercial options cost

| Source | Content | Format | Licence | Price |
|---|---|---|---|---|
| **ExerciseDB Pro** | 1,394 exercises **plus a matching taxonomy** | GIF to 1080x1080 | Perpetual, one-time. FAQ verbatim: *"host the JSON and GIF files yourself, store them in your own database, serve them from your own CDN, or bundle them in your app."* Prohibits reselling the raw set | ~$299-599 |
| **ExerciseAnimatic** | 2,300+ | MP4 to 4K | Lifetime commercial | ~$329 bundle |
| **MoveKit** | 412 | MP4 H.264 | Commercial included | $149-299 |
| **GymVisual** | 8,000+ | GIF / PNG / MP4 | N-CRFL, perpetual, worldwide | **Per asset, $3-10** — roughly $4,000 for our catalogue |

### What is genuinely free, and what only looks free

Genuinely free and legally clean:

- **free-exercise-db's own images** — Unlicense, public domain, zero obligations. The ones
  rejected on quality.
- **Everkinetic** (`everkinetic/data`) — hand-drawn anatomical line-art, start/end frames. Its
  `LICENSE.md` is **Creative Commons Attribution-ShareAlike 4.0 International**. Better looking
  than the photos, but attribution *and* share-alike.
- **OpenTraining** (`chaosbastler/opentraining-exercises`) — the same Everkinetic images under
  CC BY-SA 3.0, a smaller set.

Free-looking but **not usable**, each checked rather than assumed:

- `hasaneyldrm/exercises-dataset` (1,324 exercises with GIFs) — MIT covers the *data only*. Its
  own README states the media is *"© Gym visual and redistributed here with permission"* and
  that *"Reuse is governed by Gym visual's Terms & Conditions; obtain your own license there
  before reusing the media."* Their permission is not ours.
- `omercotkd/exercises-gifs` — repository labelled MIT, README says *"I do not own any of the
  content in this repository. All rights belong to the original creators and dataset owner."*
  An MIT file placed over content the author does not own conveys nothing.
- The Kaggle "Fitness Exercises Dataset", `azilRababe/Exercises_Dataset` and FitnessDB — the
  same family of ExerciseDB/GymVisual re-uploads with a licence field the uploader had no right
  to set.
- **WorkoutX API** — 1,400+ GIFs, but API-only with **no self-hosting**, commercial use requires
  a paid plan, and the GIF provenance is undisclosed. It also reintroduces exactly the
  third-party runtime dependency this project set out to avoid.
- **VectorFit free pack** — 305 MP4s, licence explicitly lists *"Mobile apps, web apps,
  wearables, or product interfaces"* as **not licensed**; content creators only.

The pattern is consistent enough to be worth stating as a rule: **treat any claim of free
animated exercise media as suspect until its provenance is traced to an actual rights holder.**
There is no free source with Hevy's look, because producing that look costs money and everyone
producing it sells it.

## Decision

**Ship free-exercise-db's own public-domain photographs as an explicit, recorded stopgap**,
mirrored into a FORJD-owned public Supabase Storage bucket named `exercise-media`.

Three parts to the decision:

1. **Own the bytes.** The ingest script fetches the images once from the pinned upstream commit
   and uploads them through the existing **`StorageProvider`** — never the Supabase SDK directly
   (rule 11). This makes Phase 2 `StorageProvider`'s first real consumer, a phase earlier than
   InBody needed it. The mirror is idempotent: objects that already exist are skipped, so a
   re-run after a partial failure is safe.
2. **Store a key, never a URL.** `exercises.image_keys` holds source-relative storage keys
   (`bench-press/0.jpg`). The API resolves them to URLs at read time through a configurable
   `mediaBaseUrl`. The wire contract exposes resolved URLs; the database never does.
3. **Record it as a stopgap, with both exits named**, so this research does not have to be
   repeated.

### Why Supabase Storage and not the alternatives

Vendoring the images into the git repository was considered and rejected. It is not actually
cheaper: the bytes still have to reach phones, and serving them from Cloud Run means ~$0.12/GB
internet egress with ~1 GB/month free and no CDN, versus Supabase Storage's CDN-backed delivery
inside its free tier — while also adding tens of megabytes to every clone, every CI checkout and
the Docker build context, permanently, in git history. A git submodule was rejected for a
different reason: it pins an exact upstream commit and keeps our history clean, but CI, Docker
and every new machine still need `--recurse-submodules`, so it makes the external dependency
explicit rather than removing it.

## Consequences

- **Free-tier ceilings that apply, and when they bite.** Supabase's free plan allows roughly
  1 GB of storage and ~5 GB of egress per month. **Measured at Phase A** (see
  `apps/api/src/exercises/ingest/data/SOURCE.md`): 873 exercises, 1,746 image paths, a 51-image
  sample averaging ~52 KB each, projecting to **~88.6 MB total** — about 9% of the free storage
  ceiling, not close to the limit. Egress is the one to watch — mitigated substantially by
  `expo-image`'s on-disk cache, which means a given device pays for each image roughly once
  rather than once per view.
- **A CDN decision is deferred, not forgotten.** If egress becomes real money, putting
  Cloudflare's free unmetered-egress tier in front of the bucket is a DNS and config change,
  because of decision (2) above. Revisit before public launch.
- **The quality bar is not met, and that is known.** Two static photographs per exercise is
  visibly below Hevy's animated 3D. Two exits, either of which is a config change plus one
  script re-run:
  - **Buy.** ExerciseDB Pro is the cheapest option whose licence explicitly permits
    self-hosting, and it supplies a richer taxonomy alongside the media — which would supersede
    free-exercise-db as the seed source and requires an ADR-005 update, not just this one.
  - **Get a legal read on CC BY-SA.** Everkinetic's share-alike question is **the same question
    ADR-005 already queued for wger**, so adding it to that legal conversation costs nothing
    extra. A favourable answer unlocks clean line-art at no cost.
- **The library list screen is unaffected either way.** The design's own exercise row draws a
  38x38 tile containing a `dumb` glyph, not a thumbnail
  (`docs/design/phase2-screen-specs.md` §3.5). Media only shows on the detail screen, which
  bounds how much the stopgap is seen.
- **No RLS obligation is triggered.** A *public* media bucket hands no client a Supabase
  credential, so the standing gating rule — enable RLS before any client receives a Supabase
  credential — is not tripped. This is nonetheless the closest anything has come to it, and RLS
  remains an open human decision.
- **One provenance item, carried over from ADR-005 and confirmed at ingest:** the images
  originate from the upstream `wrkout/exercises.json` project (credited to Ollie Jennings).
  free-exercise-db's `LICENSE.md` applies Unlicense terms to the whole repository including the
  image paths, so this is covered; re-check if the upstream image set ever changes.
- **Attribution.** None is legally required by the Unlicense. Crediting the dataset on an
  about/licences screen remains good practice. If the Everkinetic route is ever taken, per-image
  attribution becomes mandatory and needs a screen that does not exist yet.
