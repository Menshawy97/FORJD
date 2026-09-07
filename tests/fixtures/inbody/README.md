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
| `non-json-prose` | Real observed failure mode, not a captured file | ADR-032 decision 5: "the chosen model fails to return parseable JSON on a genuine fraction of real calls." Same text already used in `nvidia-vision.provider.spec.ts`'s retry tests. |

### Regenerating

There is nothing to regenerate here by script — each `.expected.json` was computed by running
the real `parseInBodyExtractionResponse()` against the paired `.txt` and reviewing the output,
the same way `free-exercise-db.adapter.spec.ts`'s fixtures are hand-verified rather than
machine-generated. If you add a fixture, do the same: run it through the parser, read the
output, and commit what it actually produced (not what you expect it to produce) so the
fixture proves the code's real behaviour rather than encoding an assumption about it.
