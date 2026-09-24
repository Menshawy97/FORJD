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
