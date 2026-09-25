import { SEGMENTAL_SITES } from "@forjd/domain";

import { AGE_UNITS, HEIGHT_UNITS, PRINTED_FIELDS, SEGMENTAL_UNITS } from "./inbody-extraction-schema";

/**
 * Vendor-agnostic InBody extraction prompt (ADR-032, rewritten by ADR-053).
 *
 * ADR-053 replaced the original prompt after measuring it against the hand-checked sample
 * sheets in `scripts/spikes/inbody-samples/`. What changed, and why:
 * - **No arithmetic.** The model reports the number and unit exactly as printed; the parser
 *   converts lb to kg. The largest error class was a correctly read lb number reported as kg.
 * - **Numbers that are not the value.** Normal ranges, bar-graph axis ticks, the Body
 *   Composition History table (older tests), target/control values and ratios such as
 *   TBW/LBM were all read as values in the evaluation; each is now named and excluded.
 * - **Layouts differ by machine.** A field a sheet does not print (the InBody 770 has no score
 *   and shows visceral fat as an area) must come back null, never estimated.
 * - **Structured output.** The OpenAI provider enforces the answer shape with a JSON schema
 *   (`inbody-extraction-schema.ts`), so the filled example ADR-032 needed is gone. The shape is
 *   still described in words below for providers without schema support (NVIDIA, dev-only).
 */
export function buildInBodyExtractionPrompt(): string {
  const fieldLines = Object.values(PRINTED_FIELDS)
    .map((field) => `- ${field.key}: ${field.label}. unit ${field.units.map((unit) => `"${unit}"`).join(" or ")}.`)
    .join("\n");
  const segmentalUnits = SEGMENTAL_UNITS.map((unit) => `"${unit}"`).join(" or ");
  const heightUnits = HEIGHT_UNITS.map((unit) => `"${unit}"`).join(" or ");
  const ageUnits = AGE_UNITS.map((unit) => `"${unit}"`).join(" or ");

  return `This is a photo of an InBody body-composition result sheet (a printout, or a photo of a screen
or app). Transcribe the CURRENT test's values exactly as printed, with the unit printed beside
each one. Do not convert units and do not do any arithmetic: report the printed number and its
printed unit, and the app converts.

The header (the line at the top with ID, Height, Age, Gender and the test date):
- height: the person's height as printed. unit ${heightUnits}. For feet and inches (e.g.
  "5 ft 10 in" or 5' 10") set value to the feet, unit to "ft_in" and inches to the inches (so
  value 5, inches 10); otherwise inches is null.
- age: the person's age as printed, in whole years. unit ${ageUnits}.
Set value (and unit) to null when the sheet does not print one.

Fields (set value to null and unit to null when the sheet does not print it):
${fieldLines}

Notes on specific fields:
- visceral_fat_level is a plain level number (e.g. "Level 3"). Many sheets instead show
  Visceral Fat AREA (VFA) in cm², often as a graph: that is a different measurement, so return
  null.
- inbody_score is printed as "NN/100 Points". Several machines (e.g. InBody 770) and most
  screen/app reports print no score at all: then return null. Never estimate one.
- total_body_water is printed in L, or in lb on machines configured for lb.
- fat_free_mass_index is printed as "FFMI" under Research Parameters on some machines (e.g.
  InBody 570, 770); most sheets do not print it: then return null. Never work it out.

Segmental Lean Analysis, per body part: ${SEGMENTAL_SITES.join(", ")}. Each shows a mass and a
percentage; report the mass with its unit (${segmentalUnits}), never the percentage.

Where the real value is, and the numbers that are NOT it:
- Prefer the "Body Composition Analysis" table and the value printed at the end of each
  "Muscle-Fat Analysis" / "Obesity Analysis" bar. If a value is printed twice, both copies
  must agree; if they don't, re-read both.
- IGNORE normal ranges, printed in brackets or as "a ~ b" (e.g. "42.3~51.7").
- IGNORE the numbers along the top of the bar graphs (axis ticks such as 55 70 85 100).
- IGNORE the "Body Composition History" table: it lists OLDER tests.
- IGNORE target/control values ("Target Weight", "Weight Control", "Fat Control").
- IGNORE ratios and percentages that are not the field itself: "TBW/LBM" (e.g. 73.1 %) is not
  the InBody Score, "ECW/TBW" (e.g. 0.380) is not Total Body Water, and the segmental "%" rows
  are not masses.
- Values often sit in the right-hand column rather than the main tables: Basal Metabolic Rate
  ("1838 kcal") usually appears under "Research Parameters" or on its own line there, and the
  InBody Score and Visceral Fat Level at the top right. Check that column before returning null.

Rules:
- Copy digits exactly, including decimals. Never round, estimate, or derive a value from others.
- Never fill a field the sheet does not print: null is correct and expected there.
- confidence is your honest probability (0 to 1) that the transcribed value is exactly right.
  Use 0.9 or above only when the digits are sharp and unambiguous; lower it for blur, glare,
  small print, or hesitation between two readings, and explain the doubt in reading_note.

Answer with a single JSON object: "inbody_model" and "test_date" (strings as printed, or null),
"height" ({"value", "unit", "inches", "confidence", "reading_note"}), "age" ({"value", "unit",
"confidence", "reading_note"}), "fields" and "segmental" (each entry {"value", "unit",
"confidence", "reading_note"}, keyed as listed above), and "image_quality_notes" (a string).`;
}
