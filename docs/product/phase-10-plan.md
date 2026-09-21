# Phase 10 — City leaderboards

Status: **complete** (2026-09-21). Slices 10A to 10N merged, each green on `main`.

The roadmap row said "CityResolver, ScoringStrategy, RevenueCat". This phase delivered the
leaderboards and left billing out (decision D1): RevenueCat needs a Play Console account that does not
exist yet, so ADR-021 stands and the subscription screens stay inert UI.

## What shipped

| Slice | What |
|---|---|
| 10A | Domain vocabulary and the pure Activity score (`packages/domain`) |
| 10B | Zod contracts and pinned fixtures for `GET /api/v1/leaderboards` |
| 10C | Vendored GeoNames `cities15000`, with a drift gate in CI |
| 10D | `CityResolverService`, an in-memory nearest-city index |
| 10E | The server derives a session's city; the client's `city`/`citySlug` are ignored |
| 10F | `expo-location` behind an adapter, coarse and foreground only |
| 10G | The Location screen asks for permission once, for real |
| 10H | The start position is read and sent; `isLiveTracked` is true for the live runner |
| 10I | `GET /api/v1/leaderboards`, computed on read |
| 10J | Weekly rank snapshots and the "up N this week" delta |
| 10K | The Rank tab, built from `screenshots/leaderboard.png` |
| 10L | The Data sources page (GeoNames attribution) |
| 10N | The full athlete profile behind a leaderboard row ([plan](phase-10n-plan.md)) |

## Decisions taken with the user

| # | Decision |
|---|---|
| D1 | Leaderboards only; no billing or RevenueCat. |
| D2 | Cities from a vendored dataset, resolved on our own server; no geocoding API. |
| D3 | Only the Activity score is real; Strength, Running and HYROX return `coming_soon`. |
| D4 | Only opted-in athletes, and only workouts run through the live runner. |
| D5 | `isLiveTracked` means "run through the live runner"; old rows stay false, no back-fill. |
| D6 | Location permission is asked once; each workout then reads a coarse position silently. |
| D7 | The weekly movement arrow ships, backed by weekly rank snapshots. |
| D8 | A Data sources page under Profile carries the GeoNames attribution. |
| D9 | A board needs five athletes; below that, an honest empty state. |
| D10 | A private profile still shows name and username on the board; the row is not tappable. |
| D11 | The score uses only objective inputs against WHO targets; self-rated effort is excluded. |
| 10N | The profile shows the four heaviest lifts and last three sessions; rank tiles only if the athlete is ranked. |

ADRs: [044](../decisions/ADR-044-is-live-tracked-means-run-through-the-live-runner.md),
[045](../decisions/ADR-045-city-resolution-from-vendored-geonames.md),
[046](../decisions/ADR-046-activity-score.md),
[047](../decisions/ADR-047-leaderboard-standings-and-weekly-snapshots.md),
[048](../decisions/ADR-048-coarse-location-for-leaderboards.md).

## Owed, and not testable from a development machine

1. **A live device test of location.** `expo-location` cannot run in Expo Go, so it needs an EAS
   dev-client build. Confirm with `aapt dump permissions` that only coarse location is declared, that
   the permission is asked once, that a second workout raises no prompt, and that a workout still
   starts with the network off (rule 6).
2. **A pixel check of the Rank tab and the athlete profile** against their screenshots on a device.
3. **`gh workflow run leaderboard-snapshot.yml` on a Monday**, then confirm arrows appear the following
   week and that a re-run replaces rather than duplicates rows. *Run on Monday 2026-09-21:* staging
   succeeded with `captured 0 cities (0 rows)` (no city has five opted-in athletes yet, so there is
   nothing to replace and no arrow to see). **Production fails, and not because its schema is behind:**
   its database URL secret does not resolve (`getaddrinfo EAI_AGAIN base`), and `deploy-api.yml` with
   `target=production` fails at the migration step for the same reason. Production has never been
   provisioned (the roadmap's note under the Phase 6 session close says as much). Until it exists the
   Monday cron snapshots staging only. Owed by the user: create the production Supabase project (within
   the two-project free-tier limit), put a valid pooler URL in Secret Manager as
   `forjd-production-database-url`, then re-add production to the schedule.
4. **The container build check** (`docker build`, then confirm the city snapshot is in the image). The
   Docker engine was unavailable while building this; the compiled-`dist` CI step covers the same risk.
5. **The "How is this calculated?" copy** became a **Profile → FAQ** page covering every calculation
   and its citation ([faq-copy.md](faq-copy.md)). It needs the user's sign-off before it is built,
   because it carries the WHO and other citations into the product.
6. ~~Home's City Rank tile still reads an em dash.~~ Done: it reads the caller's rank (PR #216).

## Testing on a phone (what tripped us up)

- `apps/mobile/.env` (gitignored) holds `API_BASE_URL`. It must be this PC's current Wi-Fi address, for
  example `http://192.168.1.24:3000`, not `localhost`. When the address changes, edit it and restart
  Expo, because Metro reads the value at start. "Cannot reach FORJD" on the login screen means this
  value is wrong or the API is not running.
- The API (`pnpm --filter @forjd/api start`, port 3000) needs local Postgres up. An account exists only
  if it was registered against that database.
- Windows Firewall may block inbound ports 3000 and 8081 or 8082 from the phone. Allow Node.js on
  private networks.
- Port 8081 was held by a stale `node` process, so Expo was started with `--port 8082`. Check what owns a
  port before killing it: another Claude session may own it.
- Expo Go cannot run `expo-location` or share-card image export (native modules). Use a development-client
  build for location, as `apps/mobile/AGENTS.md` says.

## Not in this phase

Billing and paywalls, Strength, Running and HYROX scores, national or friends boards, a rank history
chart, coordinate storage of any kind, avatar photos on the board, and anti-cheat beyond the live runner
and per-session caps.
