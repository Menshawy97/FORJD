# ADR-033: OpenAI is now the InBody vision-extraction vendor

**Status:** Accepted
**Date:** 2026-09-07
**Supersedes:** ADR-032's development-only NVIDIA binding as `AiModule`'s default. Does not
supersede ADR-032's reasoning, which still applies verbatim to `NvidiaVisionProvider` as an
available development-only option.

## Context

ADR-032 named OpenAI as the intended production vendor for InBody photo extraction, deferred
until the vendor switch actually happened, and warned that NVIDIA's free tier must never carry
a real (non-developer) user's health data given its Trial Terms of Service. The user obtained
an OpenAI API key and asked, mid-session, to switch to it now, explicitly asking for the
lowest-cost option.

## Decision

1. **`AiModule` now binds `VISION_PROVIDER` to `OpenAiVisionProvider`** (`apps/api/src/ai/providers/openai-vision.provider.ts`),
   not `NvidiaVisionProvider`. `NvidiaVisionProvider` and its client remain in the tree,
   untouched, as a development-only alternative -- ADR-032's reasoning for why it must never
   carry production traffic still holds.
2. **Reuses the exact prompt and parser NVIDIA's provider uses**
   (`inbody-extraction-prompt.ts` / `inbody-response-parser.ts`), which is precisely the
   payoff ADR-032 predicted for extracting those two files: switching vendors is "a new file
   implementing `VisionProvider`... no caller changes," not a rewrite of the extraction
   logic. The golden fixtures in `tests/fixtures/inbody/` already cover this file's
   prompt/parsing behaviour by construction.
3. **Model: `gpt-4o-mini`, chosen on cost.** At the time of writing this was the cheapest
   OpenAI model confirmed to support image input via the standard chat completions API
   ($0.15 / 1M input tokens, $0.60 / 1M output tokens). This was **not fully verifiable**:
   automated web research this session returned inconsistent and in places clearly
   unreliable model names and prices from OpenAI's own pricing page (some fetched summaries
   surfaced model ids -- `gpt-6-astra`, `gpt-5.6-sol/terra/luna` -- that could not be
   corroborated against any other source and read as likely fabrication by the fetch
   tooling's own summarization step). `gpt-4o-mini` was the one option independently
   confirmed as real, current, vision-capable, and priced from multiple sources, so it was
   chosen over an unverifiable "possibly cheaper" alternative. **Revisit this line if a
   cheaper vision-capable model is confirmed available** -- it is the one line to change,
   per decision 2's reuse of the vendor-agnostic prompt/parser.
4. **No structured-output mode, no prompt changes.** ADR-032's prompt-engineering findings
   were NVIDIA-specific (its own free-tier model's behaviour with `response_format` /
   `nvext.guided_json`); OpenAI's structured-output support is generally more reliable, but
   evaluating it was out of scope for a same-session cost-driven vendor swap. A future spike
   could measure whether it reduces the retry rate (and therefore cost) below what the
   current 3-attempt retry loop already achieves.
5. **CI, the local `.env.example`, and the Cloud Run deploy workflow were all updated** to
   require `OPENAI_API_KEY` instead of `NVIDIA_API_KEY` for `AiModule` to boot --
   `openAiVisionClientProvider`'s factory calls `ConfigService.getOrThrow` at module
   construction, the same eager-instantiation behaviour that made the missing
   `NVIDIA_API_KEY` secret crash the Cloud Run container earlier the same session (see
   `docs/product/roadmap.md`'s session-close entry for that incident). `NVIDIA_API_KEY` is
   kept in CI and `.env.example` since `NvidiaVisionProvider` is still present and testable,
   just no longer the default binding.

## Consequences

- **A new GCP secret must be created before the next staging deploy succeeds**:
  `forjd-staging-openai-api-key`, with the Cloud Run service account
  (`772363715082-compute@developer.gserviceaccount.com`) granted
  `roles/secretmanager.secretAccessor` on it -- the same two commands the user ran in Cloud
  Shell for `forjd-staging-nvidia-api-key` earlier this session, substituting the secret
  name. This ADR does not create it; the agent that wrote this ADR has no GCP write access.
  Until it exists, the next deploy will fail cleanly on "secret not found."
- `check-architecture-conformance.sh`'s `openai` SDK import rule now allowlists four files
  (both vendors' provider + client pairs) instead of two.
- Real per-extraction cost now applies (previously $0 on NVIDIA's free tier). No budget alert
  or spend cap was set up as part of this change -- worth adding before this sees meaningful
  volume, given the model choice in decision 3 carries real uncertainty.
- Production readiness for InBody extraction is closer, but not complete: this ADR resolves
  the *vendor* half of ADR-032's deferred decision, not the broader "before any real
  (non-developer) user's photo reaches production" bar that ADR-032 set, which also depends
  on things this ADR does not touch (rate limiting, spend caps, monitoring).

## Related

- [`ADR-032-nvidia-vision-for-inbody-development.md`](ADR-032-nvidia-vision-for-inbody-development.md)
- [`ADR-014-openai-inbody-vision.md`](ADR-014-openai-inbody-vision.md) -- the original vendor choice this ADR finally executes.
