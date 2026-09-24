# ADR-053: InBody reading moves to gpt-5.4-mini, with printed units converted in code

**Status:** Accepted
**Date:** 2026-09-24
**Supersedes:** ADR-033 decision 3 (the `gpt-4o-mini` model choice) and decision 4 (no
structured output, no prompt changes). ADR-033's vendor choice (OpenAI) stands.

## Context

On a physical device the user found InBody photos read badly. The question was whether the
model, the prompt, or the server's photo compression was to blame. It was measured rather than
guessed, against the 10 sample sheets in `scripts/spikes/inbody-samples/` that have
hand-written true values (`truth/`), using the app's own prompt and the server's own photo
processing (resize to 1600 px, WebP q85). A value counts as right when it is within 0.05 of the
truth; "wrong at high confidence" means wrong with confidence ≥ 0.9, i.e. pre-filled on the
confirm screen as if checked.

ADR-033 chose `gpt-4o-mini` partly because newer model ids surfaced by web research
(`gpt-5.6-*`, `gpt-6-*`) "could not be corroborated". The OpenAI models endpoint for this
account lists them, so they were real; the cheapest-confirmed choice was a 2024 model.

## Findings

| Setup | Exact | Wrong at high confidence | Cost / scan | Time |
|---|---|---|---|---|
| gpt-4o-mini, original prompt (before) | 51–59% | 25–30 | $0.0039 | 5–10 s |
| gpt-4o-mini, improved prompt | 44% | 42 | — | — |
| gpt-4o / gpt-4.1, original prompt | 66–67% | 27–29 | $0.008–0.010 | 4–5 s |
| gpt-5-mini, original prompt | 83% | 9 | $0.0076 | 37 s |
| gpt-5.5, original prompt | 92% | 3 | $0.077 | 27 s |
| gpt-5.4-mini, original prompt | 77–80% | 12–17 | $0.0042 | 4 s |
| **gpt-5.4-mini, this ADR's prompt + parser (production code)** | **91%** | **6** | **~$0.005** | **4 s** |

Cost is OpenAI's standard list price (developers.openai.com/api/docs/pricing, 2026-09-24) times
the tokens each model actually used per sample. `gpt-4o-mini` is billed ~24,000 tokens per
image against ~2,000 for the newer models, which cancels most of its per-token price advantage.

1. **The model was the main limit.** A better prompt did nothing for `gpt-4o-mini`; every newer
   model beat it on the same prompt.
2. **Compression was not.** Sending the original files untouched instead of the server's WebP
   changed accuracy by about one point. (7 of the 10 samples are already under 1600 px, so this
   mostly measured the WebP re-encode; phone photos are downscaled more, but the model's own
   image pipeline caps detail at a similar size anyway.)
3. **The largest error class was arithmetic, not reading.** On lb sheets the model read the
   digits correctly and then reported the lb number as kg (163.3 lb = 74.07 kg reported as
   163.3). The rest were numbers that are not the value: ratios (TBW/LBM 73.1 % taken as the
   InBody Score), visceral fat *area* taken as a *level*, and values in the right-hand column
   missed.

## Decision

1. **Model: `gpt-5.4-mini`** (the user's choice from the table above), with `detail: "high"`.
2. **The model transcribes, the code converts.** The model reports each value exactly as printed
   with its printed unit; `inbody-response-parser.ts` converts lb to kg (`KG_PER_LB`) and notes
   it. Prompt, JSON schema and parser share one definition (`inbody-extraction-schema.ts`).
3. **Structured output**: a strict JSON schema via `response_format`, replacing the filled
   example ADR-032 needed for NVIDIA's model.
4. **Different machines, different layouts.** A field the sheet does not print comes back null;
   the prompt names the traps observed (ranges, axis ticks, the history table, target values,
   ratios, VFA vs level, the right-hand column). A value arriving with a missing unit, or one
   the field is never printed in, is kept for the user to confirm but capped at confidence 0.5,
   below the 0.9 pre-fill threshold.
5. The parser still reads the original shape, so the recorded real responses in
   `tests/fixtures/inbody/` stay covered, and the dev-only NVIDIA provider keeps working (the
   prompt describes the answer shape in words for providers without schema support).

## Known limits

- The InBody 770 sample still yields an invented InBody Score of 73 (from "TBW/LBM 73.1 %") at
  high confidence. Accepted for now; the user asked for a clear improvement, not perfection.
- The two smallest samples (~470 px wide web images) are still misread, but mostly below the
  pre-fill threshold, so the confirm screen asks the user to check them.
- Two hand-written truth values disagree with their sheets and were corrected in the
  evaluation only, not in `truth/`: `images-png` Body Fat Mass is printed 13.4 lb (= 6.08 kg,
  truth file says 10), and `Screenshot 2026-08-19 104149` prints Total Body Water 66.4 lb
  (= 30.12 L, truth file says null).
