# ADR-032: NVIDIA vision for InBody development; production vendor still deferred

**Status:** Accepted (development scope only — see Consequences)
**Date:** 2026-09-06/07
**Supersedes:** ADR-014 (vendor choice for InBody extraction, development phase only —
ADR-014's OpenAI choice remains the intended production vendor)

## Context

Phase 5 (InBody) was blocked on Spike B, which had never run because no AI credential
existed on the development machine. During this session the user obtained a free NVIDIA API
key (`build.nvidia.com`) and asked to use it, rather than wait on an OpenAI key.

NVIDIA's API is OpenAI-compatible (same `openai` npm SDK, different `baseURL`), so adopting
it changes configuration, not architecture — `VisionProvider` (this ADR's own new interface)
keeps the vendor swappable behind one adapter, the same pattern `StorageProvider` established
for Supabase Storage.

**A real constraint the switch introduces:** NVIDIA's API Trial Terms of Service forbid
uploading "personal information relating to an identifiable individual... health... [or]
governmental information" and state that NVIDIA is not liable for the confidentiality of
data sent to it; free-tier inputs and outputs are also recorded and used to help train
NVIDIA's own models. An InBody sheet is health information about an identifiable person.

## Decision

1. **NVIDIA is the vendor for development and the Spike B measurement only.** The user's own
   test photos, sent for development and calibration, are the user's call to make about their
   own data. **NVIDIA must not become the path real users' scan photos travel through** — that
   would violate the ToS for other people's health data and expose it to a training pipeline
   with no contractual confidentiality. OpenAI (ADR-014's original choice) remains the
   intended production vendor. Revisit this ADR before any real user's photo reaches an AI
   vendor in production.
2. **Model choice: `meta/llama-3.2-11b-vision-instruct`**, picked empirically, not from public
   docs. Two other model ids that looked correct from NVIDIA's documentation turned out to be
   unusable in practice: `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` is not in this key's actual
   `/v1/models` catalogue at all (fast `410`), and `meta/llama-3.2-90b-vision-instruct` hung
   indefinitely on every real request despite being listed. `nvidia/nemotron-3-nano-omni-30b-
   a3b-reasoning` was also measured (Spike B tests both) but showed **inverted** confidence
   calibration on the small sample gathered so far (more confident when wrong than right) —
   worth re-checking once the user finishes labelling the full 20-photo set, but not the
   model this session's production adapter defaults to.
3. **No structured-output enforcement (`response_format` / `nvext.guided_json`).** Both were
   tried against the live API. `nvext.guided_json` did not constrain either model's output at
   all. `response_format: json_object` measurably made the chosen model *less* reliable once
   the prompt included the full field list and a worked example — it started echoing the
   schema/example back verbatim instead of reading the photo. What works is a plain-language
   prompt with a **filled example, not the abstract JSON schema**, plus lenient parsing that
   tolerates a markdown fence or surrounding prose.
4. **The example's confidence values must be distinct, never uniform.** An early version of
   the prompt used the same confidence (0.95) for every example field; the model copied that
   single number onto every real field regardless of whether it actually knew the answer,
   which would have made the confirm screen's confidence gate meaningless. The shipped
   example uses nine different confidence values for exactly this reason.
5. **Up to 3 retries per photo per extraction call.** Even with a correct prompt, the chosen
   model fails to return parseable JSON on a genuine fraction of real calls, and NVIDIA's free
   tier occasionally returns a bare connection error. A retry absorbed both in testing (took
   the model from failing most calls to succeeding on 3/3 in a repeated real test) and is
   itself informative: the retry rate a model needs in production is real signal about how
   viable it is.
6. **Weight-related fields are unit-detected, not assumed metric.** InBody sheets print
   Weight, Skeletal Muscle Mass, and Body Fat Mass in either kg or lb depending on the
   machine's configuration. Verified failure mode on a real sample photo: the model correctly
   identified an lb-only sheet but returned the raw lb number labelled as kg. The prompt now
   instructs detection + conversion using `KG_PER_LB = 0.45359237`, the same constant
   `packages/domain/src/unit-conversion.ts` already uses elsewhere in the app — and a second,
   subtler bug (the model noting "converted to kg" in `reading_note` but leaving `value` null
   instead of doing the arithmetic) required an explicit rule that a conversion is never a
   reason for `value` to be null.
7. **Extraction is synchronous, not queued.** No BullMQ, no Redis consumption this phase,
   reversing what the original roadmap penciled in. Cloud Run (ADR-015) shuts containers down
   between requests, a poor host for a long-lived queue worker; a single extraction call
   completing in seconds to roughly a minute is acceptable for a rarely-performed action.
8. **The confirm screen's pre-fill threshold is 0.9, and blank means blank.** The prototype
   (`s_inbodyConfirm`) pre-fills every field regardless of confidence, including visceral fat
   at a demo 0.72. This contradicts `docs/architecture/health-data.md`'s "nothing saves
   unconfirmed" principle — a pre-filled wrong number is exactly what a tired user taps past
   without looking. Fields below 0.9 confidence (the same value the design's own UI already
   turns amber at, reused rather than inventing a second threshold) render **blank**, forcing
   a real keystroke; the amber visual styling itself is untouched, matching the design.

## Scope trims made to land Phase 5 in one session, both explicit

- **Segmental lean analysis (five body-region values) is not captured or displayed.** It
  would need five more confirm-screen fields FORJD's schema, contracts, and extraction prompt
  do not currently define. The Progress → Body tab omits this section entirely rather than
  show permanently-empty bars — consistent with the app's own honest-empty pattern elsewhere,
  but a genuine gap against the design's third Body-tab screenshot.
- **The Body tab's two headline tiles are fixed to Weight and Body fat**, not the design's
  configurable long-press widget picker. `@forjd/domain`'s `BODY_METRICS` already supports
  swapping in muscle mass, visceral fat, or BMI; only the picker UI itself is unbuilt.
- **PDF upload is not supported.** The design's caption says "jpg, png, pdf"; `sharp`
  (ADR-024's mandatory server-side re-encoder) does not decode PDF. Shipped caption reads
  "jpg, png".
- **No client-side pre-resize before upload**, unlike the avatar flow's `resizeImageForUpload`
  step. The server's `sharp` re-encode is mandatory and correctness-bearing regardless
  (ADR-024's "never trust the client" rule); the client-side step is a bandwidth/UX nicety
  only, left as a follow-up rather than blocking the session on it.

## Consequences

- `apps/api/src/ai/providers/nvidia-vision.provider.ts` is the only file permitted to import
  the `openai` SDK on the API side (enforced by `check-architecture-conformance.sh`, verified
  by deliberately breaking the rule once during this session and confirming it fired).
  Switching to OpenAI in production is a new file implementing `VisionProvider`, registered in
  `ai.module.ts` — no caller changes.
- `scripts/spikes/inbody-vision.ts` carries the same prompt logic and is the tool for
  measuring whether `llama-vision`, `nemotron-omni`, or a future OpenAI model should actually
  be trusted in production; its README documents every failure mode above in more operational
  detail for whoever runs it next.
- `docs/architecture/health-data.md`'s InBody pipeline description still names "Claude
  vision" at the line ADR-014 already flagged stale; this ADR does not fix that line, a small
  remaining doc-hygiene item.
- Revisit this ADR: (a) once Spike B's full 20-photo set is labelled and scored — the
  `llama-vision` vs `nemotron-omni` choice was made on a partial, small sample; (b) before any
  real (non-developer) user's InBody photo reaches production, per decision 1.
