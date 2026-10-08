# The live run — "Start a run" on Train

Status: **built and merged** (2026-09-22): R1 to R8 and F1. Open points and follow-ups are at the end of this file.
**Since Phase 12A (2026-10-03, ADR-059):** a run keeps tracking with the screen off through a location
foreground service, with a live notice (time, distance, pace; Pause, Resume, Finish). ADR-049 decision 2
is superseded; see [phase-12a-plan.md](phase-12a-plan.md).

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
- **Calories, since scan-height-age slice F** (`docs/product/scan-height-age-plan.md` §4.4): the
  estimate is **active** energy, like the watch's `active_energy`, so the two mean the same thing:
  gross minus resting energy over the moving time (the latest scan's BMR ÷ 1440 per minute, else
  1 MET), never below zero. Gross comes from Keytel et al., *J Sports Sci* 2005;23(3):289–297, when
  the mean heart rate is at least 90 bpm (read only with health-data consent) and the profile gives
  age and sex: men `(−55.0969 + 0.6309·HR + 0.1988·kg + 0.2017·age) / 4.184` kcal/min, women
  `(−20.4022 + 0.4472·HR − 0.1263·kg + 0.074·age) / 4.184`. Otherwise it is the ACSM figure above.

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
| R8 | Watch heart rate and calories through Health Connect, read during a run only with health-data consent; asks Health Connect once, on the first run (the user's decision), then only reads. `features/run/run-health.ts`, `integrations/health/device-health-provider.ts`, a device copy of the consent (`store/health-consent-local.ts`), the two read permissions in `app.config.ts`. **Not verified on a physical Android phone** (ADR-035); the user agreed on 2026-09-22 that automated tests, TDD, review agents and green CI are enough to merge |
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
  copied. A figure that was never measured reads "—".
- Distance is kilometres only for now; there is no miles option on the run screens yet.
- The header's pulse animation is a static dot, as on the strength runner.
- Label and unit greys use the app's contrast-lifted `label` (#94948B) and `dimmer` (#8A8A82) tokens
  instead of the prototype's #77776f / #6e6e66, as every other screen does (R19).
- The GPS pill has two states the design does not draw: "GPS weak" (worse than 10 m, accent dot) and
  "GPS searching" (before the first reading, grey dot).
- A denied, approximate-only or unavailable location shows an explanation card (with Open Settings
  where it can help) in place of the map. The run keeps its clock, but cannot measure distance.
- Locking the phone pauses the run and the screen says so, because foreground location stops.
- Calories on the summary carry a small "estimated" line when they are the ACSM estimate and not a
  watch reading (the plan's "the tile says estimated").
- A run under 50 m is offered for discarding rather than saved.
- The run screens read `healthDataAllowed: false` until R8 wires the watch and the health-data consent,
  so no heart rate is stored yet; estimated calories are stored regardless, as ADR-050 #3 says.

## Owed by the user

The Google Cloud billing account and a Maps SDK key restricted to the app package and its signing
SHA-1, set as the EAS environment variable `GOOGLE_MAPS_ANDROID_API_KEY`; a development-client build;
a device walk of tracking, the map and keep-awake; the Health Connect test (R8); and the Play Data
safety form updated to say precise location is used on the device during a run.

## Where we stopped (2026-09-22): the live run is built

**Merged and green on `main`:** S1, A1, D1, R1 to R8 and F1. R1 to R5 are the calculations, the storage, the
adapters, the map and the engine; R6 and R7 are the two screens (#234); R8 is the watch (#235); F1 is Profile,
FAQ, from the approved `faq-copy.md`. Production has migrations up to `0021`: `0022` (the run tables) is on
staging only and reaches production on the next manual production deploy (the user is not touching production in
another session, so any deploy is ours to dispatch).

Local Postgres tests need `DATABASE_URL=postgresql://forjd:forjd_local_dev@127.0.0.1:5432/forjd` (Node resolves
`localhost` to IPv6). Running the whole mobile Jest suite while other work loads the machine can time out the
route-tree suites (signup, welcome, profile navigation); they pass alone and in CI.

### Open points (need the user or a device)

1. **Health Connect is unverified on a physical Android phone** (ADR-035, CLAUDE.md rule 16). R8 merged on the
   user's decision that automated tests, TDD, review agents and green CI are enough. Still to confirm on a phone:
   the permission dialog appears (the rationale activity the Health Connect plugin needs), heart rate and active
   energy arrive during and after a run, and the first-run prompt does not fight the location prompt.
2. **A Google Cloud Maps key**, restricted to `com.forjd.app` and the app signing SHA-1, set as the EAS variable
   `GOOGLE_MAPS_ANDROID_API_KEY`. Without it the route draws on the striped background.
3. **A development-client build and a walk of a real run** (tracking, the map, keep-awake, pause when the phone
   locks, finishing, the summary, the Train line).
4. **The Play Data safety form** must say precise location is used on the device during a run, and that heart
   rate and calories are read from Health Connect with consent.
5. **Citations to check before public launch** (listed in `faq-copy.md`): the full Hopkins (2000) reference, the
   DiStasio Epley/Brzycki validation, the 2026 ACSM position stand, and the edition of the ACSM Guidelines. The
   FAQ shows them as written, without the draft's verify flags.
6. **The FAQ has no design** (the prototype has none). It reuses the settings pieces; if you want a designed
   version, give a screenshot.
7. **Production Maps and deploy timing:** dispatch the production deploy when the run is ready to ship, so `0022`
   and the run upload reach production together.

### Follow-ups (known gaps, none blocking)

- **Run snapshot at sign-out.** The crash-recovery snapshot (with every GPS fix, and heart rate when consent was
  on) is not cleared on logout, so a second account on the same phone could be offered the first account's
  unfinished run. The strength session snapshot has the same gap. Clear both in `clearSession`.
- ~~**Leftover snapshot of a queued run.**~~ **Fixed 2026-10-01 (G6):** enqueue and clear are one SQLite transaction. Recovery now drops a snapshot whose run is still in the upload queue, but
  one whose run has already uploaded (a crash between enqueue and clear, then a successful sync) could still be
  offered. Fix by also checking the server, or by enqueueing and clearing in one SQLite transaction.
- ~~**Source-blind calories.**~~ **Fixed 2026-10-09.** `SyncedObservation` now carries an optional `dataOrigin`
  (Health Connect's writing app), and `sumActiveEnergyKcal` counts one app only: the one that gave the heart
  rate, otherwise the one with the largest total. Other apps' records stay in Health Connect untouched (rule 10).
  The reader reads heart rate first so it knows which app that is. Device walk owed (two apps writing calories).
- ~~**Failures shown as silence.**~~ **Fixed 2026-10-09.** The reader records which metric `sync()` listed in
  `failedMetricTypes` (and forgets it once a read works again). The live heart-rate card shows "Heart rate is
  turned off for FORJD in Health Connect." with an "Open Health Connect" link in place of the chart, and the
  run-complete screen shows the calories version ("... so this run uses an estimate."). Replica approved
  2026-10-09; `openHealthConnectSettings` is called only from `integrations/health/health-settings.ts` (rule 17).
  Nothing changes on the server or in the upload.
- **Stale consent write after sign-out.** Home writes the health consent copy after `getMe`; a response that lands
  after `clearSession` could put the old account's yes back. Check a session still exists before writing (the
  location consent copy has the same narrow race). The server still drops health fields either way.
- ~~**Live-screen cost on long runs.**~~ **Fixed (G6):** `runTrackStats` is memoised on the fixes; only time and pace tick.
- ~~**`run_points`** unused~~ **Removed (G6):** on-phone migration step 5 drops it.
- **Miles.** The run screens are kilometres only; there is no miles option yet.
- **Share card.** The summary's share tile says "coming soon"; the run share card ("Route & Splits") is unbuilt.
- **Discard of a run whose snapshot clear fails** is silent; the screen closes and the run could come back. Tell the
  person, or retry on the next database open.
