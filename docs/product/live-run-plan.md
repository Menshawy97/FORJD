# The live run — "Start a run" on Train

Status: **in progress** (2026-09-21). R1, R2 and R3 are merged and green on `main`; R4 to R8 and F1 remain.

Train's "Start a run" tile (`apps/mobile/src/app/(tabs)/train.tsx:53`, `href: null`) was left inert
by Phase 2 and Phase 3 because a run needs GPS, and Phase 3H deferred it ("a different modality
with GPS and pace"). Phase 10 built the leaderboards and left it; this plan builds it.

Sources of truth, in order: the screenshots `live run 1.png`, `live run 2.png`, `run done.png`
under `FORJD mobile app design/screenshots/`, then the prototype `s_run()`
(`FORJD Mobile.dc.html` 2914-2972) and `s_runDone()` (2973-3006), then
`design_handoff_forjd_mobile/01-screen-inventory.md:357-373`. No screenshot shows a paused run, a
permission-denied state, or the run share card.

## Decisions taken with the user (2026-09-21)

| # | Decision |
|---|---|
| R1 | **Precise GPS, foreground only**, with the screen kept awake during a run. Background location stays blocked. Locking the phone pauses tracking. |
| R2 | Heart rate shows "—" and an empty chart unless a watch is feeding Health Connect. When it is, the live screen uses it (best effort: many watches sync in batches) and the summary fills average HR and per-split bpm afterwards. |
| R3 | A **Google street map** under the route (`react-native-maps`, Google provider on Android), dark-styled. The user creates the Google Cloud billing account and a restricted Maps SDK key. With no key, the map falls back to the designed striped background with the route drawn over it. |
| R4 | The route (GPS points) stays **on the phone only**. Distance, time, pace, splits and elevation go to the server. |
| R5 | Calories: the watch's `active_energy` from Health Connect first, otherwise an estimate from the ACSM running equation and body weight. Elevation from GPS altitude. |
| R6 | Watch heart rate is read, and average HR, per-split bpm and calories stored server-side, **only with health-data consent** (ADR-043). If consent was withdrawn before an upload the server drops those fields and keeps the rest, because a queued upload must never fail and lose the run. Estimated calories are the app's own arithmetic and still show on the summary. |

Also decided this session: Home's City Rank tile reads the caller's rank (PR #216), the weekly
snapshot failure is diagnosed and production redeployed (PR #215), and the "How is this
calculated?" idea became a Profile → FAQ page ([faq-copy.md](faq-copy.md)).

Maps cost, checked 2026-09-21 against the vendors' pricing pages: Google's Maps SDK for Android and
iOS has an "Unlimited" SKU with no billable events (its web dynamic maps are 10,000 free loads then
$7 per 1,000), and Mapbox's mobile SDK is free to 25,000 monthly active users then $4 per 1,000.
Google still requires a billing account on the project. Recheck before launch.

## Formulas (for the FAQ and the code)

- **Distance:** the sum of haversine distances between accepted fixes. A fix is rejected when its
  horizontal accuracy is worse than 25 m, or when it implies a speed above 12 m/s (a GPS jump).
- **Moving time and pace:** average pace is moving time divided by distance; paused time never counts.
  Current speed is taken over a rolling 10 s window.
- **Splits:** the time for each full kilometre, interpolated at the moment the boundary was crossed.
- **Elevation gain:** climbs only, counting a rise once it passes 3 m, so altitude noise is ignored.
  A product rule, not a published method, and the FAQ says so.
- **Calories, fallback:** from the ACSM metabolic equations (*ACSM's Guidelines for Exercise Testing
  and Prescription*, 11th ed., Wolters Kluwer, 2021). Speed `v` in m/min; `grade` is the **net** climb
  (last altitude minus first, never below zero) over the distance, as a fraction, because the
  equations describe a constant incline and total gain would overstate a loop:
  running (`v` at or above 134 m/min) `VO2 = 0.2·v + 0.9·v·grade + 3.5`; walking (below)
  `VO2 = 0.1·v + 1.8·v·grade + 3.5`; both in mL·kg⁻¹·min⁻¹. Energy is
  `kcal/min = VO2 · kg / 1000 · 5`, about 5 kcal per litre of oxygen. Body weight is the latest
  `weight` reading (an InBody scan or a Health Connect / manual observation). With no weight there is
  no estimate and the tile reads "—". The tile says "estimated"; it is never called AI.

## Slices

Each slice is test-first, reviewed by agents, merged by PR, and confirmed green on `main`.

| Slice | What |
|---|---|
| D1 | **Merged (#218).** This plan, ADR-049, ADR-050, `security.md`, `data-inventory.md`, `faq-copy.md` (docs only) |
| R1 | **Merged (#219).** `packages/domain/src/run-calculations.ts` and its spec: the formulas above, pure, hardened after review (non-finite input, bad anchors, both clocks) |
| R2 | **Merged (#220).** | Contracts: an optional `run` object on the session upload (additive, `/api/v1`); migration for `workout_run_summaries` and `workout_run_splits`; the service stores it in the session's transaction and drops HR and calories without health consent; a curated "Outdoor Run" exercise |
| R3 | **Merged (#222).** Location adapter: `requestPrecisePermission`, `watchPrecisePosition`; `app.config.ts` unblocks fine location only |
| R4 | `integrations/maps/route-map.tsx` with the no-key fallback; a conformance rule confines `react-native-maps` to that folder |
| R5 | `workouts/live-run.ts` reducer, `store/run-session.ts` (SQLite points and snapshot), keep-awake, upload mapping |
| R6 | The live run screen `app/run.tsx`, pixel-exact |
| R7 | The run complete screen `app/run-done.tsx`; Train's "previous workout" shows kilometres for a run |
| R8 | Watch heart rate and calories through Health Connect. **Cannot merge until run on a physical Android phone** (CLAUDE.md rule 16, ADR-035): open the PR green and leave it |
| F1 | The FAQ screen, after the user signs off `faq-copy.md` |

## Values to transcribe (from the prototype, audited per slice)

Live run: header `0 22px 12px`, 7 px pulse dot, label `600 10px` at `.14em`, "Live · Outdoor run"
or "Paused · Outdoor run"; map margin `0 22px`, height 206, radius 16, striped
`repeating-linear-gradient(135deg,#141517 0 9px,#191a1c 9px 18px)`, route stroke 4, start marker
r6 with a 3 px stroke, end marker r7, "GPS strong" pill `6px 10px` radius 8 on
`rgba(16,16,17,.82)`; elapsed `700 46px` at `-.03em`; a 2×2 grid, gap 8, card `#17181a` radius 14
padding `14px 15px`, values `700 26px`, pace in `#e9712f`, HR in `#c9503c`; heart-rate card with a
300×54 sparkline; splits rows `12px 0` with a 5 px bar; footer `12px 22px 24px`, top border
`rgba(255,255,255,.06)`, gap 9, buttons 52 px radius 12.

Run complete: check tile 52 px radius 14 on `rgba(121,185,138,.13)`; share tile 44 px radius 13;
title `700 28px/1.12` "Run complete"; subtitle `400 13.5px/1.45` ("Outdoor run · logged offline, will
sync when you are back online."); map height 180; two rows of three stat cards (Distance, Duration,
Avg pace; Avg HR, Calories, Elevation); the same splits; a ghost "View Progress"; the tab bar with
Train active.

## Deliberate deviations from the prototype

- The ✕ on the live screen asks before discarding, as the strength runner does, because the
  prototype's instant exit would silently lose a run.
- The share tile on the summary shows a "coming soon" note: the run share card ("Route & Splits")
  is not part of this work.
- Elapsed, pace and the other values are real; the prototype's hard-coded 298 kcal and 24 m are not
  copied.

## Owed by the user

The Google Cloud billing account and a Maps SDK key restricted to the app package and its signing
SHA-1, set as the EAS environment variable `GOOGLE_MAPS_ANDROID_API_KEY`; a development-client build;
a device walk of tracking, the map and keep-awake; the Health Connect test (R8); and the Play Data
safety form updated to say precise location is used on the device during a run.

## Where we stopped (2026-09-21)

Done and green on `main`: R1 (domain maths), R2 (contract `run`, migration 0022, service consent rule,
`Outdoor Run` seed exercise), R3 (`getPrecisePermission`, `requestPrecisePermission`,
`watchPrecisePosition` with an `isCancelled` option, fine location unblocked, background blocked).

Next, in order: **R4** maps (`react-native-maps` behind `integrations/maps/`, striped fallback, conformance
rule), **R5** run engine and persistence (reducer over `buildTrack`, SQLite points and snapshot,
keep-awake, `toRunUploadRequest` using the `Outdoor Run` exercise slug `outdoor-run`), **R6/R7** the two
screens (audit every value against the screenshots), **R8** watch heart rate (device test before merge),
**F1** the FAQ, only after the user signs off [faq-copy.md](faq-copy.md).

Callers of `watchPrecisePosition` must pass `isCancelled` and keep a single watch (a double tap or a
Strict Mode double effect must not start two). iOS "approximate" grants cannot be detected: the 25 m accuracy
filter in `acceptFix` is what excludes those fixes.

Production is live (deploy 2026-09-21, `/api/v1/health` ok) and the leaderboard snapshot ran twice against
it ("captured 0 cities": no city has five athletes yet). Local Postgres tests need
`DATABASE_URL=postgresql://forjd:forjd_local_dev@127.0.0.1:5432/forjd`, because Node resolves `localhost` to
IPv6 and Docker binds IPv4 only.
