# Run share card

Owner decision 2026-10-14: build the run share card ("Route & Splits", was "coming soon") before the beta. Replica
**approved as shown** 2026-10-14 (shown in the session; this file is the record).

## What it is

- The run summary's Share button opens a new **Share Run** screen (`app/run-share.tsx`) instead of the
  "Sharing a run is coming soon" toast. It works like Share Workout: a 4:5 card preview, a layout chooser, and
  Save Image, Instagram and More (`media/share-capture.ts`, the same capture path).
- **Route & Splits** (default): the FORJD mark, the route drawn as a line from the GPS track (no map tiles, so no
  street names; start ring, end dot), "Outdoor Run", "Today · 4.82 km", Time / Avg pace / Climb, and up to five splits.
- **Stats Card:** the same without the route and splits, for someone who would rather not show where they ran.
- Numbers in the run's Units choice (km or mi, `docs/product/run-miles-plan.md`).
- **Never on the card:** heart rate or calories (health data stays private, CLAUDE.md rule 15 spirit: a share card
  leaves the app).

## Build (test-first, one PR)

1. `features/run/route-path.ts` (pure): the route as an SVG path fitted to the card, aspect kept (longitude scaled by
   the cosine of the latitude), or nothing when there are fewer than two distinct points.
2. `app/run-share.tsx` with both layouts, reading `getCompletedRun()`; "Finish a run to share it." with none.
3. `app/run-done.tsx`: Share opens `/run-share` (the summary stays underneath, so the run is still there).
