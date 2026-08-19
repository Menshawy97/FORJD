/**
 * Spike B — InBody photo extraction via Claude vision (ADR-006).
 * Throwaway measurement script, not production code. Nothing here is imported
 * by the app; Phase 5 builds the real pipeline once this ADR is Accepted.
 *
 * Usage: pnpm extract   (see README.md in this directory)
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const SAMPLES = join(import.meta.dirname, "inbody-samples");
const PHOTOS = join(SAMPLES, "photos");
const OUT = join(SAMPLES, "out");

const MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const measuredField = {
  type: "object",
  properties: {
    value: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description: "The numeric value as printed, or null if not present/unreadable.",
    },
    confidence: {
      type: "number",
      description:
        "0.0-1.0. How certain you are that every digit is correct. Lower this when glare, blur, crop, or ambiguous digit shapes make a misread plausible.",
    },
    reading_note: {
      type: "string",
      description:
        "If confidence is below 0.9, what specifically is uncertain (e.g. 'could be 84.6 or 34.6, leading digit partly obscured by glare'). Empty string otherwise.",
    },
  },
  required: ["value", "confidence", "reading_note"],
  additionalProperties: false,
} as const;

const schema = {
  type: "object",
  properties: {
    inbody_model: {
      type: "string",
      description: "Model printed on the sheet (e.g. '270', '570', '770'), or 'unknown'.",
    },
    test_date: { anyOf: [{ type: "string" }, { type: "null" }] },
    fields: {
      type: "object",
      properties: {
        weight_kg: measuredField,
        body_fat_percent: measuredField,
        skeletal_muscle_mass_kg: measuredField,
        bmi: measuredField,
        visceral_fat_level: measuredField,
        total_body_water_l: measuredField,
      },
      required: [
        "weight_kg",
        "body_fat_percent",
        "skeletal_muscle_mass_kg",
        "bmi",
        "visceral_fat_level",
        "total_body_water_l",
      ],
      additionalProperties: false,
    },
    image_quality_notes: {
      type: "string",
      description: "Glare, blur, angle, crop — anything affecting legibility.",
    },
  },
  required: ["inbody_model", "test_date", "fields", "image_quality_notes"],
  additionalProperties: false,
} as const;

// Deliberately does NOT tell the model to be confident. The spike is measuring
// whether confidence tracks real errors — coaching it toward high confidence
// would destroy the only signal we're here to collect.
const PROMPT = `This is a photograph of an InBody body-composition result sheet.

Read these values exactly as printed:
- Weight (kg)
- Percent Body Fat (%)
- Skeletal Muscle Mass (kg)
- BMI
- Visceral Fat Level
- Total Body Water (L)

Rules:
- Transcribe only what is printed. Never infer, estimate, or compute a value from the others.
- If a field is absent from this sheet or you cannot read it, set value to null.
- Report per-field confidence honestly. A single wrong digit permanently corrupts a
  user's long-term progress graph, so a plausible misread must be reflected as lower
  confidence rather than hidden behind a confident-looking number.
- Digit confusion is the specific failure that matters (e.g. 84.6 vs 34.6 vs 84.8).
  Where a digit's identity is genuinely ambiguous, say so in reading_note.`;

async function main() {
  await mkdir(OUT, { recursive: true });

  let entries: string[];
  try {
    entries = await readdir(PHOTOS);
  } catch {
    console.error(`No photos directory. Create it and add images:\n  ${PHOTOS}`);
    process.exit(1);
  }

  const photos = entries.filter((f) => extname(f).toLowerCase() in MEDIA_TYPES);
  if (photos.length === 0) {
    console.error(`No images found in ${PHOTOS}`);
    process.exit(1);
  }

  const client = new Anthropic();
  console.log(`Extracting ${photos.length} photo(s)...\n`);

  for (const photo of photos) {
    const stem = basename(photo, extname(photo));
    process.stdout.write(`  ${photo} ... `);

    const data = await readFile(join(PHOTOS, photo));
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: MEDIA_TYPES[extname(photo).toLowerCase()],
                data: data.toString("base64"),
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      console.log("REFUSED");
      continue;
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text) {
      console.log(`no text block (stop_reason: ${response.stop_reason})`);
      continue;
    }

    await writeFile(
      join(OUT, `${stem}.json`),
      JSON.stringify(JSON.parse(text.text), null, 2) + "\n",
    );
    console.log("ok");
  }

  console.log(`\nWrote results to ${OUT}`);
  console.log("Next: hand-label ground truth, then run `pnpm score`.");
}

main();
