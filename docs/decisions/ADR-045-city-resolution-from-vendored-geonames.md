# ADR-045: City resolution from a vendored GeoNames snapshot, resolved in process memory

**Status:** Accepted
**Date:** 2026-09-21

## Context

A leaderboard needs a city per workout. The only input is a coarse position (ADR-048), so something
has to turn a latitude and longitude into a city, and it has to do it without sending anyone's
position to a third party (decision D2 of Phase 10) and without depending on a service's free-tier
terms.

## Decision

1. **The source is GeoNames `cities15000`**, licensed CC BY 4.0: every city of about 15,000 people or
   more. Rejected: `cities1000` and `cities5000` (they resolve to villages, which is wrong for a
   city board), Natural Earth (too coarse; it misses most Egyptian governorate cities), simplemaps'
   free tier (a deliberately reduced copy of a commercial product) and any geocoding API (position
   would leave our infrastructure, and the terms limit use).
2. **It is vendored, not fetched at runtime.** `apps/api/src/cities/ingest/` follows the same shape as
   the exercise and nutrition pipelines: a fetch script writes `data/cities.tsv` (nine columns
   kept), a normalize script writes `data/normalized-cities.json`, and CI re-runs the normalizer and
   fails on any diff. A conformance rule pins raw-TSV reads to that folder. The server only ever
   reads the committed normalized snapshot.
3. **The snapshot is columnar and small.** Rows are arrays, not objects; `alternatenames` and the
   feature and elevation columns are dropped. 34,146 source rows normalize to 34,124 locating rows
   that resolve to 20,485 distinct cities.
4. **A city's slug is `<name>-<cc>-<geonameId>`**, for example `alexandria-eg-361058`. The country
   suffix stops Alexandria, Virginia sharing a board with Alexandria, Egypt, and the GeoNames id
   keeps the slug stable when a name changes or two places share one. An earlier slug that used the
   admin region was not stable across re-vendors, which is why the id is in it. `profiles.city_slug`
   keeps its bare form: it groups profiles for display, while this slug is the ranking key.
5. **Nearby places roll up to the main city ("metro dominance").** A place attaches to the largest
   same-country place within 25 km that is at least four times its population, and chains are
   followed to the root, so a suburb ranks with its metropolis rather than splitting the board.
   Districts marked `PPLX` attach to the largest place within 30 km that is at least four times their
   size, otherwise to the nearest larger place. Without this, Tokyo Station resolved to "Chuo" and
   Setagaya to a 19,000-person suburb.
6. **Resolution runs in process memory.** `CityIndex` holds parallel typed arrays sorted by latitude,
   finds the latitude band by binary search, bounds longitude with a box that is safe across the
   antimeridian and the poles, then measures haversine distance over the survivors. Nothing farther
   than 120 km resolves. It was fuzzed against a brute-force scan. It runs once per uploaded workout
   and never on a leaderboard read. A Postgres table would need a loader, a migration and a prune
   guard for data nothing joins, and PostGIS would be a new extension on the free project for the
   same algorithm plus a round trip.
7. **The snapshot must ship inside the container.** `nest build` copies no assets by default and the
   Dockerfile copies only `deploy/dist`, so the JSON was present in development and absent in the
   image. `nest-cli.json` has an `assets` entry, and a CI step loads the snapshot from the compiled
   `dist` so a missing file fails the build instead of the first real upload.
8. **Attribution is a licence obligation.** CC BY 4.0 requires credit, a licence link and a note that
   the data was changed. The in-app Data sources page (Phase 10L) carries all three.

## Consequences

- **Known limits of the roll-up.** Cities that grew into each other can be merged the way a person
  might not expect (Manila absorbs Quezon City; Islamabad and Rawalpindi are separate places one
  could argue about), and a chain of attachments can drift a place up to about 57 km from where it
  started. Both are accepted for a first version and are changed by re-vendoring, not by code.
- **A session's city is a fact as of when it happened.** It is not re-resolved if the snapshot is
  re-vendored, so a boundary change moves future workouts only.
- **The list is a snapshot in time.** Refreshing it is a deliberate re-vendor, reviewed as a diff.
