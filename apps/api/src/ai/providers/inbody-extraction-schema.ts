import { SEGMENTAL_SITES, type BodyMetric } from "@forjd/domain";

/**
 * The shape the InBody vision model answers in (ADR-053), shared by the prompt, the OpenAI
 * structured-output schema and the parser, so the three cannot drift apart.
 *
 * The model reports each value **as printed, with its printed unit**; the parser converts. An
 * evaluation against real sheets found the model reading an lb sheet's digits correctly and
 * then skipping the lb-to-kg conversion -- the largest single error class -- so the arithmetic
 * moved out of the prompt and into code.
 */
export const PRINTED_UNITS = ["kg", "lb", "L", "%", "level", "kg/m2", "kcal", "points"] as const;
export type PrintedUnit = (typeof PRINTED_UNITS)[number];

export interface PrintedField {
  /** The key the model answers under. */
  key: string;
  /** How the prompt names it on the sheet. */
  label: string;
  /** Units this field may legitimately be printed in. `lb` is converted by the parser. */
  units: readonly PrintedUnit[];
}

/** Keyed by the canonical metric each printed field feeds. */
export const PRINTED_FIELDS: Record<BodyMetric, PrintedField> = {
  weight_kg: { key: "weight", label: "Weight", units: ["kg", "lb"] },
  skeletal_muscle_mass_kg: { key: "skeletal_muscle_mass", label: "Skeletal Muscle Mass (SMM)", units: ["kg", "lb"] },
  body_fat_mass_kg: { key: "body_fat_mass", label: "Body Fat Mass", units: ["kg", "lb"] },
  body_fat_percent: { key: "body_fat_percent", label: "Percent Body Fat (PBF)", units: ["%"] },
  visceral_fat_level: { key: "visceral_fat_level", label: "Visceral Fat Level", units: ["level"] },
  // Water is printed in litres, or in lb on lb-configured machines (1 kg of water is 1 L).
  total_body_water_l: { key: "total_body_water", label: "Total Body Water", units: ["L", "lb"] },
  bmi: { key: "bmi", label: "BMI", units: ["kg/m2"] },
  basal_metabolic_rate_kcal: { key: "basal_metabolic_rate", label: "Basal Metabolic Rate", units: ["kcal"] },
  inbody_score: { key: "inbody_score", label: "InBody Score", units: ["points"] },
};

/** Segmental lean mass is a mass per body part: kg, or lb on lb-configured machines. */
export const SEGMENTAL_UNITS: readonly PrintedUnit[] = ["kg", "lb"];

const printedValueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit", "confidence", "reading_note"],
  properties: {
    value: { anyOf: [{ type: "number" }, { type: "null" }] },
    unit: { anyOf: [{ type: "string", enum: [...PRINTED_UNITS] }, { type: "null" }] },
    confidence: { type: "number" },
    reading_note: { type: "string" },
  },
} as const;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] } as const;

/**
 * The header's height and age (scan-height-age-plan.md §2.3), transcribed as printed like every
 * other value. Height is "cm", "in", or "ft_in": for "5 ft 10 in" the model reports value 5 and
 * inches 10, and the parser converts, so no arithmetic is asked of the model (ADR-053).
 */
export const HEIGHT_UNITS = ["cm", "in", "ft_in"] as const;
export const AGE_UNITS = ["years"] as const;

const heightSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit", "inches", "confidence", "reading_note"],
  properties: {
    value: nullableNumber,
    unit: { anyOf: [{ type: "string", enum: [...HEIGHT_UNITS] }, { type: "null" }] },
    inches: nullableNumber,
    confidence: { type: "number" },
    reading_note: { type: "string" },
  },
} as const;

const ageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit", "confidence", "reading_note"],
  properties: {
    value: nullableNumber,
    unit: { anyOf: [{ type: "string", enum: [...AGE_UNITS] }, { type: "null" }] },
    confidence: { type: "number" },
    reading_note: { type: "string" },
  },
} as const;

/** OpenAI structured-output schema (strict mode: every key required, no extras). */
export function buildInBodyExtractionSchema(): Record<string, unknown> {
  const fieldKeys = Object.values(PRINTED_FIELDS).map((field) => field.key);
  return {
    type: "object",
    additionalProperties: false,
    required: ["inbody_model", "test_date", "height", "age", "fields", "segmental", "image_quality_notes"],
    properties: {
      inbody_model: nullableString,
      test_date: nullableString,
      height: heightSchema,
      age: ageSchema,
      fields: {
        type: "object",
        additionalProperties: false,
        required: fieldKeys,
        properties: Object.fromEntries(fieldKeys.map((key) => [key, printedValueSchema])),
      },
      segmental: {
        type: "object",
        additionalProperties: false,
        required: [...SEGMENTAL_SITES],
        properties: Object.fromEntries(SEGMENTAL_SITES.map((site) => [site, printedValueSchema])),
      },
      image_quality_notes: { type: "string" },
    },
  };
}
