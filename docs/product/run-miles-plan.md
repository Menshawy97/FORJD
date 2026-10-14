# Runs in miles

Owner decision 2026-10-14: runs follow the Units setting (checklist "Miles option on the run screens"). Replica
**approved as shown** 2026-10-14 (shown in the session; this file is the record).

## What changes when Units is miles

- Live run and run summary: Distance "3.00 mi", Avg pace "8:11 /mi", Current speed "7.3 mph", Elevation "138 ft".
- Splits: one row per full mile ("1 mi", "2 mi"), each that mile's time.
- Lock-screen notice: "24:31 · 3.00 mi", "Avg pace 8:11 /mi".
- Train tab: a run's card line "Today · 24:31 · 3.00 mi" and its chip "Outdoor Run 3.00 mi".
- The map placeholder caption says "mile markers". (The map itself draws only the start and end; the replica's
  "markers at each mile" referred to that caption: there are no distance markers to move.)
- Kilometre users see no change.

## Rules

- **Storage is unchanged:** a run is saved and uploaded in kilometres and metres, with kilometre splits (the server's
  canonical form). Miles are display only, so switching Units changes only what is shown.
- **Mile splits are worked out on the phone** from the GPS track, the same way as kilometre splits
  (`splitsFromTrack(track, METERS_PER_MILE)` in `@forjd/domain`), and carried to the summary with the run.
- **Offline (rule 6):** the Units distance choice is kept on the phone (`store/run-distance-unit.ts`), written when the
  signed-in app reads the profile at launch and when Units is saved; a run reads the phone's copy, kilometres if none.
  It is an account preference, so it is forgotten at sign-out with the others.

## Build (test-first, one PR)

1. Domain: `METERS_PER_MILE` exported; `splitsFromTrack` takes the split length (default 1000 m, unchanged).
2. `store/run-distance-unit.ts` (read, write, sign-out key).
3. `features/run/run-format.ts`: distance, pace, speed and elevation in either unit.
4. `workouts/live-run.ts`: mile splits alongside kilometre splits.
5. `use-run-session.ts`, `run.tsx`, `run-done.tsx`, `run-splits.tsx`, `run-notification-content.ts`: show the unit.
6. Train card line and chip; the launch read and Units save write the phone copy.
