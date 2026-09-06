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

// Deliberately does NOT tell the model to be confident. The spike is measuring
// whether confidence tracks real errors — coaching it toward high confidence
// would destroy the only signal we're here to collect.
// The exact international avoirdupois pound, in kilograms — the same constant
// packages/domain/src/unit-conversion.ts uses (KG_PER_LB), so a converted reading
// here matches what the app itself would compute, not an independently invented factor.
const KG_PER_LB = 0.45359237;

const PROMPT = `This is a photograph of an InBody body-composition result sheet. InBody
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

Rules:
- Transcribe only what is printed. Never compute or infer a value from the others.
- If a field is not on this sheet or you cannot read it, set value to null.
- If you converted a value from lb to kg, say so in reading_note (e.g. "sheet printed
  153.5 lb, converted to kg") so a human reviewing this can double-check the conversion.
- Never report an lb number as if it were kg — a wrong unit is as wrong as a wrong digit.
- A conversion is not a reason for value to be null. If the sheet printed lb, you can
  read the number, and you know the conversion factor: multiply it out and report the
  resulting kg number as value. Only use null when you cannot read the printed number at
  all — never as a way to avoid doing the multiplication.
- Set confidence honestly, per field. Lower it for anything blurry, glared, cropped,
  or where a digit could be misread (e.g. 84.6 vs 34.6).

Respond with ONLY a JSON object shaped exactly like this example, nothing else.
Every number in this example is fake filler from an unrelated sheet:

${JSON.stringify(
  {
    inbody_model: "570",
    test_date: "2026-01-15",
    fields: Object.fromEntries(
      // Deliberately distinct confidences (no repeated value) so there is nothing
      // uniform for a weaker model to anchor on and copy verbatim instead of
      // reasoning per field — this was measured to be a real failure mode.
      FIELD_NAMES.map((f, i) => [
        f,
        { value: 10 + i * 7.3, confidence: [0.99, 0.62, 0.85, 0.97, 0.71, 0.9, 0.55, 0.93, 0.8][i], reading_note: "" },
      ]),
    ),
    image_quality_notes: "",
  },
  null,
  2,
)}`;

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

      // Retried, not just attempted once: verified against the live API that failures
      // here are two different, both-real phenomena rather than a bug to fix once —
      // (1) a transient network/gateway error on an otherwise reliable model, and
      // (2) meta/llama-3.2-11b-vision-instruct genuinely not returning parseable JSON
      // on a meaningful fraction of calls, regardless of prompt wording (tried several).
      // A retry absorbs both without pretending either problem doesn't exist; the
      // per-model success rate this prints across the full 20-photo set is itself real
      // spike information about how production-viable each model is.
      const MAX_ATTEMPTS = 3;
      let lastError = "";
      let succeeded = false;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !succeeded; attempt++) {
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
            // Deliberately no response_format / guided_json: tried both against the
            // live API and neither reliably improved on prompted JSON for these two
            // models — json_object mode measurably made the weaker model *less*
            // reliable once the prompt included the full field list and an example,
            // and nvext.guided_json didn't constrain either model at all.
          });

          const text = response.choices[0]?.message?.content;
          if (!text) {
            lastError = "no content in response";
            continue;
          }

          const parsed = extractJson(text);
          await writeFile(
            join(OUT, `${stem}.${model.label}.json`),
            JSON.stringify(parsed, null, 2) + "\n",
          );
          succeeded = true;
        } catch (err) {
          lastError = (err as Error).message;
        }
      }

      console.log(succeeded ? "ok" : `FAILED after ${MAX_ATTEMPTS} attempts — ${lastError}`);
    }
    console.log("");
  }

  console.log(`Wrote results to ${OUT}`);
  console.log("Next: hand-label ground truth in truth/, then run `pnpm score`.");
}

main();
