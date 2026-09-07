# Spike B — InBody extraction accuracy

Timeboxed measurement of whether an NVIDIA-hosted vision model can read InBody
report photos accurately enough for Phase 5 to be built on it. Produces the
accuracy table and the confidence/error finding that Phase 5's ADR needs before
the confirm screen's pre-fill behaviour can be trusted.

**Vendor history:** ADR-006 proposed Claude vision. ADR-014 moved the vendor to
OpenAI. The user has since switched to NVIDIA's hosted API — free, but see the
terms-of-service note below: development/spike use only, not for real users'
health data. See ADR-032 for the full reasoning.

**Runs two model families per photo**, so the numbers — not an assumption —
decide which one Phase 5 builds on. Both are confirmed present in this key's
`/v1/models` list and confirmed to respond to a real photo (verified while
building this script — see "Known issues" below for two other model ids that
looked right from public docs but were unavailable or unresponsive):

- `llama-vision` (`meta/llama-3.2-11b-vision-instruct`) — general-purpose
  vision-language model.
- `nemotron-omni` (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`) — NVIDIA's
  omni-modal reasoning model. Not a dedicated document/OCR model — this key's
  catalog does not currently expose one as a chat-completions endpoint
  (`nvidia/nemotron-parse` exists but is a separate, non-chat API, out of
  scope here) — but it is the most document-capable option this key can
  actually reach.

**Structured output and reliability, the short version:** three different
JSON-enforcement mechanisms were tried against the live API before landing on
the current approach — `nvext.guided_json` didn't constrain either model at
all, and OpenAI's `response_format: json_object` mode measurably made the
weaker model (`llama-vision`) *less* reliable once the prompt included the
full field list and an example (it started echoing the literal example back
instead of reading the photo). What actually works is a **plain-language
prompt with a filled example** (not an abstract schema — embedding the schema
itself made the weaker model parrot it back verbatim) plus **lenient parsing**
that tolerates prose wrapping, **plus up to 3 retries per photo per model** —
`llama-vision` genuinely fails to return parseable JSON on a real fraction of
individual calls, and a retry absorbs that rather than losing the photo.

**Two more things worth knowing before you run the full set:**
- A single real photo can take anywhere from ~2 seconds to over a minute per
  model, and NVIDIA's free tier has occasional outright connection errors —
  both are covered by the retry logic, but the full 20-photo × 2-model run
  can still take a while. Be patient rather than assuming it's hung.
- On one real test photo, `nemotron-omni` returned the **identical value
  (120.5) for three unrelated fields** (body fat %, total body water, BMI),
  each at confidence 1.0 — a textbook confidently-wrong reading. This is
  exactly the failure the confidence-calibration score below is built to
  surface; expect more of these once you score the full set. If a model still
  fails after 3 attempts, the script logs `FAILED after 3 attempts` for that
  photo/model pair and moves on — `score-inbody.ts` treats a missing output
  file as "no reading," not as a wrong answer.

These scripts are throwaway. No application code imports them, and this directory
is deliberately outside the pnpm workspace.

## ⚠️ NVIDIA's free-tier terms

NVIDIA's API Trial Terms of Service forbid uploading "personal information
relating to an identifiable individual... health... information" and state
that NVIDIA is not liable for the confidentiality of data sent to it. Free-tier
inputs and outputs are also recorded and used to help train NVIDIA's own models.

**This is fine for your own InBody photos in this spike.** It would not be fine
as the path real users' scan photos travel through in production — that
decision is deferred, tracked in ADR-032, and must be revisited before any
real user's photo reaches this vendor.

## Where the photos go

```
scripts/spikes/inbody-samples/
├── photos/     ← put your InBody photos here (.jpg .jpeg .png .webp)
├── truth/      ← you hand-label these, one per photo
└── out/        ← extraction results (created automatically, one file per photo per model)
```

`inbody-samples/` is gitignored — **real InBody sheets are personal health data
and must never be committed.** `tests/fixtures/inbody/` carries the anonymized fixtures that
do reach the repo: a generated prompt golden file plus real recorded model response text and
its expected parsed output — never a report image, and never a live vision-model call in CI
(ADR-032). See that directory's README for provenance.

Collect **10-15 photos**, deliberately varied: different InBody models (270/570/770),
good and bad lighting, straight-on and angled, glare, and partial crops. A clean
sample set proves nothing — the failures are the point.

## Running it

```bash
cd scripts/spikes
pnpm install --ignore-workspace
```

The flag is required: this directory is intentionally not a member of the root
pnpm workspace, and without it pnpm looks at the workspace and reports
"No projects found".

**The API key is already set** in `apps/api/.env` as `NVIDIA_API_KEY` — this
script reads that file directly, since it lives outside the workspace and
would not otherwise see it. Get a free key at https://build.nvidia.com if you
ever need to rotate it. No shell environment variable needed.

Extract (runs both models against every photo in `photos/`):

```bash
pnpm extract
```

Or one model only, for a quick re-run:

```bash
pnpm extract -- --model=nemotron-vl
pnpm extract -- --model=llama-vision
```

This writes one `out/<photo-name>.<model-label>.json` per photo per model, with
a value, a confidence, and a reading note for each of the nine fields.

## Hand-labelling ground truth

For each photo, read the sheet yourself and write `truth/<photo-name>.json` with the
**same filename stem** as the photo (one truth file per photo — it is compared
against both models). Bare numbers, no confidence:

```json
{
  "fields": {
    "weight_kg": 84.6,
    "skeletal_muscle_mass_kg": 38.1,
    "body_fat_mass_kg": 15.5,
    "body_fat_percent": 18.2,
    "visceral_fat_level": 8,
    "total_body_water_l": 45.3,
    "bmi": 26.4,
    "basal_metabolic_rate_kcal": 1780,
    "inbody_score": 79
  }
}
```

Use `null` for any field that sheet doesn't print. Label from the photo, not from
the extraction output — reading the model's answer first will bias you into
confirming its mistakes.

**This step cannot be automated, even in principle** — if the same model that
extracts the values also writes the answer key, the accuracy number measures
self-consistency rather than correctness, and it fails silently, looking like a
clean result. It has to be someone reading the printed sheet.

## Scoring

```bash
pnpm score
```

Reports one section per model: per-field accuracy (never document-level — one
wrong number corrupts a progress graph permanently while the other eight look
fine), accuracy bucketed by confidence, and the count that actually decides the
build: **high-confidence errors**, the readings a pre-filled confirmation screen
would invite a user to tap straight past.

The kill criterion: if a model's confidence doesn't correlate with its real
errors, that model's confidence gate is decorative and Phase 5's confirm screen
needs redesigning (blank every field) before depending on it. Compare both
models' separation numbers before picking one for the real pipeline.
