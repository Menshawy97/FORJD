/**
 * Spike B — InBody photo extraction via NVIDIA-hosted vision models (Phase 5).
 * Throwaway measurement script, not production code. Nothing here is imported
 * by the app; Phase 5's real pipeline uses whichever model this spike shows to
 * have real, well-calibrated confidence.
 *
 * ADR history: ADR-006 proposed Claude vision. ADR-014 moved the vendor to
 * OpenAI. The user has since switched to NVIDIA's hosted API (free, but see
 * README's terms-of-service note — development/spike use only, not for real
 * users' health data). This script targets NVIDIA's OpenAI-compatible
 * endpoint. See ADR-032 for the full reasoning.
 *
 * Runs TWO model families per photo, per the user's decision to let the
 * numbers pick the winner rather than assume:
 *   - a document/OCR-specialised VLM (nvidia/llama-3.1-nemotron-nano-vl-8b-v1)
 *   - a general-purpose vision model (meta/llama-3.2-90b-vision-instruct)
 *
 * Usage: pnpm extract   (see README.md in this directory)
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const SAMPLES = join(import.meta.dirname, "inbody-samples");
const PHOTOS = join(SAMPLES, "photos");
const OUT = join(SAMPLES, "out");

// The API server's .env already holds NVIDIA_API_KEY (apps/api/.env). This
// spike lives outside the pnpm workspace and does not otherwise see that
// file, so it loads it directly rather than asking the user to set the key
// a second time in a shell. A plain parse is enough — no need for `dotenv`
// as a dependency for one file.
const API_ENV_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "apps",
  "api",
  ".env",
);

async function loadApiEnv(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(API_ENV_PATH, "utf8");
  } catch {
    return; // apps/api/.env not present — fall back to whatever is already in process.env
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Nine fields, matching the design's confirm screen (s_inbodyConfirm) rather
// than the original six-field harness — the field-count mismatch a Phase 5
// plan found between the spike and what the app actually needs to show.
const FIELD_NAMES = [
  "weight_kg",
  "skeletal_muscle_mass_kg",
  "body_fat_mass_kg",
  "body_fat_percent",
  "visceral_fat_level",
  "total_body_water_l",
  "bmi",
  "basal_metabolic_rate_kcal",
  "inbody_score",
] as const;

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
      properties: Object.fromEntries(FIELD_NAMES.map((f) => [f, measuredField])),
      required: [...FIELD_NAMES],
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
- Skeletal Muscle Mass (kg)
- Body Fat Mass (kg)
- Percent Body Fat (%)
- Visceral Fat Level
- Total Body Water (L)
- BMI
- Basal Metabolic Rate (kcal)
- InBody Score

Rules:
- Transcribe only what is printed. Never infer, estimate, or compute a value from the others.
- If a field is absent from this sheet or you cannot read it, set value to null.
- Report per-field confidence honestly. A single wrong digit permanently corrupts a
  user's long-term progress graph, so a plausible misread must be reflected as lower
  confidence rather than hidden behind a confident-looking number.
- Digit confusion is the specific failure that matters (e.g. 84.6 vs 34.6 vs 84.8).
  Where a digit's identity is genuinely ambiguous, say so in reading_note.

Respond with ONLY the JSON object below, nothing else — no markdown code fence, no
commentary before or after it:

${JSON.stringify(schema, null, 2)}`;

type ModelSpec = { id: string; label: string };

// Verified against this key's actual /v1/models list — the two model ids originally
// chosen from public docs (nvidia/llama-3.1-nemotron-nano-vl-8b-v1, meta/llama-3.2-90b-
// vision-instruct) turned out to be either unavailable to this key or unresponsive on
// the free tier (410 / indefinite hang respectively). These two respond in 1-2 seconds.
const MODELS: ModelSpec[] = [
  { id: "meta/llama-3.2-11b-vision-instruct", label: "llama-vision" },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", label: "nemotron-omni" },
];

/**
 * Extracts a JSON object from a model's text response. NVIDIA's `nvext.guided_json`
 * (their documented structured-output mechanism) did not reliably constrain output on
 * either model above during testing — one returned plain prose even with a schema
 * attached. Prompting for JSON directly and parsing leniently works across both models
 * regardless of structured-output support, at the cost of needing to strip an occasional
 * markdown code fence or leading/trailing prose.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function main() {
  await loadApiEnv();

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error(
      "NVIDIA_API_KEY not found. Set it in apps/api/.env (the API server's own env file — " +
        "this script reads it directly) or export it in your shell before running.",
    );
    process.exit(1);
  }

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

  // A CLI flag lets a single model be targeted for a quick re-run:
  //   pnpm extract -- --model=llama-vision
  const modelArg = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1];
  const models = modelArg ? MODELS.filter((m) => m.label === modelArg) : MODELS;
  if (models.length === 0) {
    console.error(`Unknown --model. Choices: ${MODELS.map((m) => m.label).join(", ")}`);
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });

  console.log(`Extracting ${photos.length} photo(s) x ${models.length} model(s)...\n`);

  for (const model of models) {
    console.log(`== ${model.label} (${model.id}) ==`);
    for (const photo of photos) {
      const stem = basename(photo, extname(photo));
      process.stdout.write(`  ${photo} ... `);

      const data = await readFile(join(PHOTOS, photo));
      const dataUrl = `data:${MEDIA_TYPES[extname(photo).toLowerCase()]};base64,${data.toString("base64")}`;

      try {
        const response = await client.chat.completions.create({
          model: model.id,
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PROMPT },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        });

        const text = response.choices[0]?.message?.content;
        if (!text) {
          console.log("no content in response");
          continue;
        }

        const parsed = extractJson(text);
        await writeFile(
          join(OUT, `${stem}.${model.label}.json`),
          JSON.stringify(parsed, null, 2) + "\n",
        );
        console.log("ok");
      } catch (err) {
        console.log(`FAILED — ${(err as Error).message}`);
      }
    }
    console.log("");
  }

  console.log(`Wrote results to ${OUT}`);
  console.log("Next: hand-label ground truth in truth/, then run `pnpm score`.");
}

main();
