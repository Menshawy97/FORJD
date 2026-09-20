# Source: GeoNames `cities15000`

Every city, town and populated place with a population above 15,000, from the GeoNames
gazetteer. It is what turns a coarse position into a city for the leaderboards (ADR-045):
the server finds the nearest place within 120 km, in process memory, and no coordinate ever
leaves FORJD's own infrastructure.

**Filtered, not vendored verbatim.** The raw export has 19 columns and is 8.5 MB, most of it
alternate names in every script that this app never reads. `fetch-geonames.ts` downloads it and
keeps the nine columns below, so about 6 MB of unread data stays out of git history for good.
Re-run it (`pnpm --filter @forjd/api cities:fetch-geonames`) to re-vendor; everything below is
what that run produced.

## Pin

`https://download.geonames.org/export/dump/cities15000.zip`, fetched **2026-09-20**.

**GeoNames republishes this file daily and does not version it**, so there is no upstream
release id to pin. The pin is the committed `cities.tsv` itself, identified by its SHA-256
(line endings normalized to LF, so a Windows checkout hashes the same). `normalize.ts` embeds
the same hash in `normalized-cities.json`, which is how a stale snapshot is caught.

| File | Bytes | SHA-256 |
|---|---|---|
| `cities.tsv` | 2,330,614 | `c87724449cf97fbcd8d573a0492c264d07148f02fea135d123d574176cd82a83` |
| `normalized-cities.json` | 2,559,357 | (derived; regenerated and diffed in CI) |

**Re-vendoring:** run the fetch script, then `pnpm --filter @forjd/api cities:normalize`,
review the diff of both files, update this table. Cities appear and disappear as GeoNames
changes, so expect a diff. A city's `slug` never changes while its GeoNames id exists; a slug
that changed for an id present in both snapshots would be a bug to stop and investigate.

## Columns kept

`geonameId`, `name`, `latitude`, `longitude`, `featureCode`, `countryCode`, `admin1`,
`population`, `timezone`. The normalized snapshot drops `admin1` and `featureCode` after using
them, rounds coordinates to 4 decimal places (about 11 m), and stores each timezone once.

## Measured numbers (this pin)

| | |
|---|---|
| Rows in the raw export | 34,146 |
| Malformed rows | 0 |
| District sections (`PPLX`) attached to a city | 2,364 |
| District sections dropped for having no parent city | 22 |
| Removed for having no usable slug | 0 |
| **Rows in the snapshot** (locating points) | **34,124** |
| **Distinct cities** (distinct slugs) | **20,485** |
| Countries and territories | 244 |
| Distinct timezones | 355 |

**Every row is a locating point that carries its city's name, slug and timezone.** A position
resolves to the nearest row, and the row says which city that is, so the resolver has no special
cases. Most rows are their own city. Two rules attach the rest, because GeoNames lists the wards
and suburbs of a big city as places in their own right (Tokyo Station is nearest to "Chuo", Times
Square to "Manhattan"), which would split one metro area across dozens of small boards:

- **Metro dominance.** A place attaches to the **largest** place in the same country within
  25 km that is at least **4 times** its population, and chains are followed to the root (a suburb
  of a ward of Tokyo comes back as Tokyo). Comparable neighbours stay apart: Oakland and San
  Francisco are 2x, Giza and Cairo 2.2x, Yokohama and Tokyo 2.6x. Both numbers are product
  judgements, not measurements.
- **Districts (`PPLX`).** GeoNames' "section of populated place" (Zurich's Kreis 11, Cairo's Nasr
  City, Dubai's Deira, Delhi's Rohini). Each attaches to the largest place within 30 km that is
  4x its size if there is one (Delhi, not the satellite Najafgarh), otherwise the nearest larger
  place. Districts with no larger place in reach (22) are dropped.

**Known limits, accepted** (found in review; the fix would be a hand-kept override table):
chains compound, so a member can be up to about 57 km from its root; Metro Manila outside Manila
proper lands on Quezon City because Manila and Quezon City are only 1.9x apart and so stay
separate; Islamabad is filed under Rawalpindi (14 km, 5.6x) and Newark under New York City.

**Slugs** are `slugifyCity(name) + '-' + countryCode + '-' + geonameId`. The slug is the
leaderboard key stored on every workout session, so it must not change while the city exists.
An earlier draft added an admin1 suffix only when a same-named city existed in the country;
review showed a re-vendor could then rename `alexandria-eg` and orphan that city's history
(1,078 slugs would have been suffixed). The GeoNames id does not change and also
separates same-named places (Alexandria, Louisiana and Alexandria, Virginia). Letters that
Unicode NFKD leaves alone (`đ ø ł þ ß æ œ ı`) are folded to ASCII first, so no stored key
contains them. All 20,485 slugs are unique and none depends on any other city.

## License

Creative Commons Attribution 4.0 International (CC BY 4.0), stated at
`https://www.geonames.org/about.html` ("GeoNames ... provided under a Creative Commons
Attribution 4.0 License"), fetched 2026-09-20.

**Attribution is required**, unlike free-exercise-db (requested) and USDA (public domain). The
app credits GeoNames on a "Data sources" page under Profile (Phase 10 slice 10L); that slice
must ship before this data reaches a store build.
