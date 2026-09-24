# Manual InBody entry — plan

Lets a user record InBody results by typing them in, without uploading a photo. Requested
2026-09-24; design approved by the user the same day as a replica of four screens (not in the
original design handoff). Decisions made with the user:

| Question | Answer |
|---|---|
| Where | A row on the InBody screen, under the upload box: "Enter values manually" / "No photo — type in your results" (history-row style, pencil icon). |
| Form | The Confirm-scan layout, starting empty, titled "Enter values". No confidence bars. |
| Required | Weight **and** body fat % (labelled "Required"); everything else optional. |
| Validation | Save with a required value missing: that row's value box turns red (`#b8422f`) with "Enter your weight" / "Enter your body fat %"; nothing is sent. |
| History | Mixed in by date, pencil tile instead of the scale, and a "MANUAL" tag after the date. Compare and charts include it. |
| After saving | Back to the InBody screen with the toast "Values saved to history". |

## Slice

1. **Domain** (`packages/domain/src/body-vocabulary.ts`): `SCAN_SOURCES` gains `"manual"`
   (display name "Manual").
2. **Migration** (drizzle-kit generate, never hand-edited): `body_scans.photo_key` becomes
   nullable. Backward compatible — every existing row keeps its key.
3. **Contracts** (`packages/contracts/src/body.ts`):
   - `createManualBodyScanRequestSchema`: `{ measuredAt, measurements: {metric, value, unit}[] }`,
     reusing the per-metric value bounds; must contain `weight_kg` and `body_fat_percent`; no
     duplicate metrics.
   - `bodyScanSummarySchema` gains `source` so the history row can show the tag.
4. **API** (`apps/api/src/body/`):
   - `POST /api/v1/body-scans/manual` (JSON body, `ZodValidationPipe`, same throttle as confirm).
   - `BodyService.createManual`: no photo, no vision call, so **no AI-consent requirement**
     (nothing leaves the server). Stored with `source: "manual"`, `photoKey: null`, and
     confidence 1 per value (typed by the user, not inferred).
   - `getScan`/`confirm` report the scan's real source instead of a hard-coded `"inbody"`;
     `listScans` includes `source`.
   - `listScanPhotoKeysForUser` (account deletion) skips scans with no photo.
5. **App** (`apps/mobile`):
   - Pull the confirm screen's value row and date/time block into shared components so the
     two screens cannot drift visually; the confirm screen keeps its exact look.
   - New route `inbody-manual.tsx`; `createManualBodyScan` in `apiClient.ts`.
   - `inbody.tsx`: the new row, and the pencil tile + MANUAL tag on manual history rows.

## Tests (written first at each layer)

Domain source list; contracts (required pair, bounds, duplicates); service (no consent needed,
source/photo/confidence stored, deletion skips null keys); controller route; app screen (required
errors, successful save posts the right body and returns to InBody, InBody row navigates,
history tag).

## Source policy

Rule 10 (preserve source) is met at the scan level: every measurement belongs to a scan whose
`source` is `inbody` or `manual`, so the two are always distinguishable. Both are the user's
own body-composition record; the read path treats them alike, and nothing overwrites anything.

## After device testing (PR #247)

Two problems surfaced on the user's iPhone, both fixed:

- **Saving a real scan failed.** The sheet printed a trunk lean mass of 30.5 kg, above the old
  30 kg segmental limit, so the API returned a 400 that the app reported as a connection error.
  The limits now come from the user's own ceilings: each arm and leg **0.5–50 kg**, trunk
  **0.5–90 kg** (`BODY_MEASUREMENT_VALUE_BOUNDS`, `packages/contracts/src/body.ts`).
- **Per-field range errors before sending.** Both the Confirm-scan and manual-entry screens now
  check every value against the same bounds before saving (`measurementBounds` in contracts,
  `rangeError` in `apps/mobile/src/features/body/range-error.ts`). An out-of-range value turns
  its box red with "Must be between X and Y unit" and nothing is sent, so a limit can no longer
  masquerade as a network failure.
- **The "Enter values manually" row rendered broken on device** while looking right on web and
  in tests: its box-model styles lived in a `Pressable` style callback. They now use NativeWind
  `className`, with only the pressed opacity left in the callback.

## Account deletion

Manual entries are removed with the account, like scanned ones: the `users` cascade deletes the
scan rows and their values. Only the photo-file cleanup step has nothing to do for them, because
a manual entry has no photo. `body.repository.spec.ts` proves the rows and values are gone.
