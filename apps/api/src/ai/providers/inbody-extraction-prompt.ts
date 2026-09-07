import { BODY_METRICS, KG_PER_LB, SEGMENTAL_SITES } from "@forjd/domain";

/**
 * Vendor-agnostic InBody extraction prompt (extracted from `NvidiaVisionProvider`, ADR-032).
 *
 * Nothing here is NVIDIA-specific -- it is about InBody sheets. Splitting it out means the
 * eventual OpenAI production provider (ADR-032's deferred decision) reuses this prompt and the
 * golden fixtures that pin it, rather than re-deriving both from scratch.
 *
 * Every clause below exists to fix a specific failure observed against the live NVIDIA API
 * during Spike B -- see ADR-032 for the full list. In short:
 * - A filled example, not the abstract JSON schema, and lenient parsing (see
 *   inbody-response-parser.ts) tolerating a markdown fence or surrounding prose: both
 *   `response_format` and `nvext.guided_json` were tried and made the chosen model less
 *   reliable, not more.
 * - The example's confidence values are deliberately distinct, never uniform (decision 4): an
 *   early version used 0.95 for every field, and the model copied that single number onto
 *   every real field regardless of whether it actually knew the answer.
 * - Weight-related fields are unit-detected, not assumed metric (decision 6): InBody sheets
 *   print Weight, Skeletal Muscle Mass and Body Fat Mass in either kg or lb depending on the
 *   machine's configuration, and a real photo was misread with a raw lb number labelled as kg.
 *   The prompt also has to say explicitly that a conversion is never a reason for `value` to be
 *   null -- a real failure mode was the model noting "converted to kg" while leaving `value`
 *   null instead of doing the arithmetic.
 */
export function buildInBodyExtractionPrompt(): string {
  const example = {
    inbody_model: "570",
    test_date: "2026-01-15",
    fields: Object.fromEntries(
      BODY_METRICS.map((metric, i) => [
        metric,
        {
          value: 10 + i * 7.3,
          confidence: [0.99, 0.62, 0.85, 0.97, 0.71, 0.9, 0.55, 0.93, 0.8][i],
          reading_note: "",
        },
      ]),
    ),
    segmental: Object.fromEntries(
      SEGMENTAL_SITES.map((site, i) => [
        site,
        { value: 3 + i * 6.1, confidence: [0.9, 0.88, 0.95, 0.86, 0.83][i], reading_note: "" },
      ]),
    ),
    image_quality_notes: "",
  };

  return `This is a photograph of an InBody body-composition result sheet. InBody
machines print weight-related fields (Weight, Skeletal Muscle Mass, Body Fat Mass) in
either kg OR lb depending on the machine's configured unit — never assume which.

Read these values, converting to the units below if the sheet prints a different unit:
- Weight (kg) — if the sheet shows lb, multiply by ${KG_PER_LB} to get kg.
- Skeletal Muscle Mass (kg) — same lb-to-kg conversion if needed.
- Body Fat Mass (kg) — same lb-to-kg conversion if needed.
- Percent Body Fat (%)
- Visceral Fat Level
- Total Body Water (L)
- BMI
- Basal Metabolic Rate (kcal)
- InBody Score

Also read the "Segmental Lean Analysis" section (five body parts, always in kg,
same lb-to-kg conversion rule if the sheet prints lb there):
- Right arm, Left arm, Trunk, Right leg, Left leg

Rules:
- Transcribe only what is printed. Never compute or infer a value from the others.
- If a field is not on this sheet or you cannot read it, set value to null.
- If you converted a value from lb to kg, say so in reading_note.
- Never report an lb number as if it were kg.
- A conversion is not a reason for value to be null. If the sheet printed lb, you can
  read the number, and you know the conversion factor: multiply it out and report the
  resulting kg number as value. Only use null when you cannot read the printed number at
  all — never as a way to avoid doing the multiplication.
- Set confidence honestly, per field.

Respond with ONLY a JSON object shaped exactly like this example, nothing else.
Every number in this example is fake filler from an unrelated sheet:

${JSON.stringify(example, null, 2)}`;
}
