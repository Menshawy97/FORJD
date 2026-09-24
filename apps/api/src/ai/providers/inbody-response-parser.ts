import { BODY_METRICS, KG_PER_LB, SEGMENTAL_SITES, type BodyMetric, type SegmentalSite } from "@forjd/domain";

import { PRINTED_FIELDS, SEGMENTAL_UNITS, type PrintedUnit } from "./inbody-extraction-schema";
import type { ExtractedBodyScan, ExtractedMeasurement } from "./vision-provider.interface";

/**
 * Confidence given to a value whose printed unit the parser cannot vouch for -- missing, or not
 * one this field is ever printed in. Machines lay sheets out differently, so such a value is
 * kept for the user to confirm, but held below the pre-fill threshold (`shouldPrefill`, 0.9)
 * so it is never presented as already checked.
 */
export const UNVERIFIED_UNIT_CONFIDENCE = 0.5;

type RawMeasurement = { value?: unknown; unit?: unknown; confidence?: unknown; reading_note?: unknown };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * ADR-053's printed-value entry: the number and unit exactly as the sheet prints them. lb is
 * converted here, in code, rather than by the model -- which was measured reading lb digits
 * correctly and then skipping the conversion.
 */
function readPrinted(raw: RawMeasurement | undefined, allowedUnits: readonly PrintedUnit[]): ExtractedMeasurement {
  const value = typeof raw?.value === "number" ? raw.value : null;
  if (value === null) return { value: null, confidence: 0, readingNote: "" };

  const confidence = typeof raw?.confidence === "number" ? raw.confidence : 0;
  const modelNote = typeof raw?.reading_note === "string" ? raw.reading_note : "";
  const unit = typeof raw?.unit === "string" ? raw.unit : null;
  const withNote = (note: string) => (modelNote ? `${note} ${modelNote}` : note);

  if (unit === null || !allowedUnits.includes(unit as PrintedUnit)) {
    return {
      value,
      confidence: Math.min(confidence, UNVERIFIED_UNIT_CONFIDENCE),
      readingNote: withNote(`The unit printed for this value wasn't recognised (${unit ?? "none"}), so please check it.`),
    };
  }
  if (unit === "lb") {
    return { value: round2(value * KG_PER_LB), confidence, readingNote: withNote(`Converted from ${value} lb.`) };
  }
  return { value, confidence, readingNote: modelNote };
}

/** Printed keys that differ from their canonical metric name (`weight` vs `weight_kg`). Some
 *  keys, like `bmi`, are identical in both shapes, so they cannot tell the shapes apart. */
const PRINTED_ONLY_KEYS = Object.entries(PRINTED_FIELDS)
  .filter(([metric, { key }]) => key !== metric)
  .map(([, { key }]) => key);

/** True when the response uses ADR-053's printed-value shape rather than the original one. */
function isPrintedShape(fields: Record<string, RawMeasurement> | undefined): boolean {
  if (!fields) return false;
  return (
    PRINTED_ONLY_KEYS.some((key) => key in fields) ||
    Object.values(fields).some((field) => typeof field === "object" && field !== null && "unit" in field)
  );
}

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

  if (isPrintedShape(raw.fields as Record<string, RawMeasurement> | undefined)) {
    const fields = {} as Record<BodyMetric, ExtractedMeasurement>;
    for (const metric of BODY_METRICS) {
      const printed = PRINTED_FIELDS[metric];
      fields[metric] = readPrinted((raw.fields as Record<string, RawMeasurement>)[printed.key], printed.units);
    }
    const segmental = {} as Record<SegmentalSite, ExtractedMeasurement>;
    for (const site of SEGMENTAL_SITES) {
      segmental[site] = readPrinted((raw.segmental as Record<string, RawMeasurement> | undefined)?.[site], SEGMENTAL_UNITS);
    }
    return {
      inbodyModel: typeof raw.inbody_model === "string" ? raw.inbody_model : null,
      testDate: typeof raw.test_date === "string" ? raw.test_date : null,
      fields,
      segmental,
      imageQualityNotes: typeof raw.image_quality_notes === "string" ? raw.image_quality_notes : "",
    };
  }

  // The original (pre-ADR-053) shape: already-converted values keyed by canonical metric. Kept
  // so the recorded real responses in tests/fixtures/inbody/ stay covered.
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
