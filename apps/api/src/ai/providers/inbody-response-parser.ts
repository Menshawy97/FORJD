import { BODY_METRICS, SEGMENTAL_SITES, type BodyMetric, type SegmentalSite } from "@forjd/domain";

import type { ExtractedBodyScan, ExtractedMeasurement } from "./vision-provider.interface";

/**
 * Vendor-agnostic InBody response parser (extracted from `NvidiaVisionProvider`, ADR-032).
 *
 * Tolerates a markdown code fence or prose wrapping around the JSON object -- verified against
 * the live API to be necessary even with an otherwise-correct prompt (both `response_format`
 * and `nvext.guided_json` structured-output modes were tried and rejected; see ADR-032 decision
 * 3 and `buildInBodyExtractionPrompt`'s docblock).
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Parses a raw InBody vision-model response into `ExtractedBodyScan`. Defensive by design: a
 * missing or malformed field coerces to a safe default (null value, 0 confidence, empty note)
 * rather than throwing, and a response with no `segmental` key at all (the shape every
 * pre-PR-#119 response has) still parses -- see `tests/fixtures/inbody/` for the fixtures that
 * pin this against real recorded responses, including real extraction errors the model made
 * (a value copied into the wrong field, a null confidence). The parser passes those errors
 * through faithfully; the confirm screen's confidence gate is the safety net, not this parser.
 */
export function parseInBodyExtractionResponse(text: string): ExtractedBodyScan {
  const raw = extractJson(text) as {
    inbody_model?: unknown;
    test_date?: unknown;
    fields?: Record<string, { value?: unknown; confidence?: unknown; reading_note?: unknown }>;
    segmental?: Record<string, { value?: unknown; confidence?: unknown; reading_note?: unknown }>;
    image_quality_notes?: unknown;
  };

  const readMeasurement = (
    raw_field: { value?: unknown; confidence?: unknown; reading_note?: unknown } | undefined,
  ): ExtractedMeasurement => ({
    value: typeof raw_field?.value === "number" ? raw_field.value : null,
    confidence: typeof raw_field?.confidence === "number" ? raw_field.confidence : 0,
    readingNote: typeof raw_field?.reading_note === "string" ? raw_field.reading_note : "",
  });

  const fields = {} as Record<BodyMetric, ExtractedMeasurement>;
  for (const metric of BODY_METRICS) {
    fields[metric] = readMeasurement(raw.fields?.[metric]);
  }

  const segmental = {} as Record<SegmentalSite, ExtractedMeasurement>;
  for (const site of SEGMENTAL_SITES) {
    segmental[site] = readMeasurement(raw.segmental?.[site]);
  }

  return {
    inbodyModel: typeof raw.inbody_model === "string" ? raw.inbody_model : null,
    testDate: typeof raw.test_date === "string" ? raw.test_date : null,
    fields,
    segmental,
    imageQualityNotes: typeof raw.image_quality_notes === "string" ? raw.image_quality_notes : "",
  };
}
