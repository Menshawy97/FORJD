# InBody extraction golden fixtures

Closes CLAUDE.md rule 8's "golden fixtures for the InBody parser," referenced but not yet
built by `docs/architecture/health-data.md`, ADR-006, and `scripts/spikes/README.md`.

Nothing here reaches CI as a live vendor call — that's forbidden by ADR-032 (NVIDIA's Trial
Terms of Service). Everything is a committed, anonymized fixture: values only, never a name,
sheet image, or identifying header text.

## `extraction-prompt.golden.txt`

Generated from `buildInBodyExtractionPrompt()` (`apps/api/src/ai/providers/inbody-extraction-prompt.ts`)
by `pnpm --filter @forjd/api prompt:golden`. CI regenerates it and fails on any diff, the same
gate `packages/contracts/fixtures` and the normalized exercise catalogue already use. A changed
prompt is a reviewable diff, not a silent edit.

## `responses/`

Each pair feeds `parseInBodyExtractionResponse()` (`apps/api/src/ai/providers/inbody-response-parser.ts`):
`<name>.txt` is the model response text, `<name>.expected.json` is the exact `ExtractedBodyScan`
it must produce. `non-json-prose.txt` has no `.expected.json` — it is expected to make the
parser throw.

### Provenance

| Fixture | Source | What it pins |
|---|---|---|
| `missing-field-and-no-segmental` | Real recording — `scripts/spikes/inbody-samples/out/drxax1jgh6nd1.llama-vision.json`, verbatim | An older/weaker response missing both an individual metric (`inbody_score`) and the whole `segmental` section still parses, filling both as `{value: null, confidence: 0}` instead of throwing. Every file in `out/` predates PR #119's widening and has this shape. |
| `lb-to-kg-converted` | Real recording — `.../out/6y7mgx0ypj2h1.llama-vision.json`, verbatim | ADR-032 decision 6: a sheet printed in lb converted to kg, with `reading_note` explaining it. |
| `wrong-field-copy-and-null-confidence` | Real recording — `.../out/tcgi0n78hq3f1.llama-vision.json`, verbatim | Two real model errors in one response: `visceral_fat_level: 33.8` is actually that photo's total-body-water reading copied into the wrong field, and `inbody_score` came back with `confidence: null` (not a number). The parser passes the wrong-field value through faithfully — the confirm screen's confidence gate is the safety net, not this parser — and coerces the non-number confidence to `0`, which is what keeps it below the 0.9 pre-fill threshold. |
| `markdown-fenced` | Reconstructed wrapper around the real `tcgi0n78hq3f1` payload above | The fence-stripping branch. **Not a verbatim capture**: `scripts/spikes/inbody-vision.ts` discarded the model's raw text before this suite was written, keeping only the already-parsed JSON, so the exact fence text a real response used is unrecoverable. The JSON payload inside is real; the fence around it is reconstructed from the wrapper shape Spike B observed. `inbody-vision.ts` now also writes `out/<stem>.<model>.raw.txt` so future fixtures can be verbatim. |
| `prose-wrapped` | Reconstructed wrapper around the real `6y7mgx0ypj2h1` payload above | The `indexOf("{")` / `lastIndexOf("}")` branch. Same caveat as `markdown-fenced`. |
| `clean-14-field` | Hand-authored | The happy path: all 9 `BODY_METRICS` and all 5 `SEGMENTAL_SITES` present. No real recording covers this shape yet — every captured response in `scripts/spikes/inbody-samples/out/` predates the segmental widening (PR #119), so this fixture is schema-representative rather than a captured recording. Replace it with a real one once Spike B (or normal production traffic, post-vendor-switch) produces a full 14-field response. |
| `printed-height-age-ft-in` | Hand-authored, values invented | The current (ADR-053) printed shape end to end, which no recorded fixture covered: an lb-configured sheet (every mass converted to kg in code) with the header's height printed "5 ft 10 in" (converted to 177.8 cm in code) and age 31 (docs/product/scan-height-age-plan.md §2.3). The expected output was worked out by hand, not captured from the parser. Every older fixture above reads height and age as null: they predate them. |
| `inbody-770-score-misread` | Hand-authored, values invented (8.5 S9, L7-3) | ADR-053's known limit: on the InBody 770 sample the model invents an InBody Score of 73 from the sheet's "TBW/LBM 73.1 %" at high confidence. The parser has no way to tell, so it passes the 73 through at 0.95. The fixture pins that behaviour so a fix (or a regression) shows up as a diff here. Every other value is internally consistent: BMI, body-fat %, and BMR against fat-free mass all agree. |
| `ffmi-printed` | Hand-authored, values invented (8.5 S9, L7-3) | A sheet that prints FFMI, consistent with its own numbers: 80.0 kg, 16.0 kg fat and 178 cm give 64 kg fat-free and 64 ÷ 1.78² = 20.2. The printed value is kept as read. |
| `ffmi-printed-disagrees` | Same sheet with FFMI misread as 22.4 | The FFMI consistency check (scan-height-age-plan.md §4.3): a printed FFMI more than the sheet's rounding away from fat-free mass ÷ height² is kept but held for a check below the pre-fill threshold, with the computed 20.2 in the note. |
| `non-json-prose` | Real observed failure mode, not a captured file | ADR-032 decision 5: "the chosen model fails to return parseable JSON on a genuine fraction of real calls." Same text already used in `nvidia-vision.provider.spec.ts`'s retry tests. |

### Regenerating

There is nothing to regenerate here by script — each `.expected.json` was computed by running
the real `parseInBodyExtractionResponse()` against the paired `.txt` and reviewing the output,
the same way `free-exercise-db.adapter.spec.ts`'s fixtures are hand-verified rather than
machine-generated. If you add a fixture, do the same: run it through the parser, read the
output, and commit what it actually produced (not what you expect it to produce) so the
fixture proves the code's real behaviour rather than encoding an assumption about it.
