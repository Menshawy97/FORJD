/**
 * Scores the production InBody reader against the hand-checked sample sheets, the measurement
 * ADR-053 was decided on, and the plan's bar for every change to the prompt or parser
 * (docs/product/scan-height-age-plan.md §2.3: "still scores at least 88%").
 *
 * Runs the real code path end to end: the server's own photo processing (1600 px, WebP q85, as
 * in body.service.ts), `OpenAiVisionProvider` with its prompt and structured-output schema, and
 * `parseInBodyExtractionResponse`. It makes paid OpenAI calls, so it never runs in CI.
 *
 * Needs, on the machine that has the samples (they are gitignored: real people's sheets):
 * - `scripts/spikes/inbody-samples/<name>.{jpg,jpeg,png,webp}`
 * - `scripts/spikes/inbody-samples/truth/<name>.json`: `{ "fields": { "weight_kg": 74.07, ... },
 *   "segmental"?: { "trunk": 25.1, ... }, "heightCm"?: 177.8, "ageYears"?: 31 }`. Only the keys a
 *   truth file states are scored, so older truth files without height and age still work.
 *
 * Run: `OPENAI_API_KEY=... pnpm --filter @forjd/api inbody:eval`
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import sharp from "sharp";

import { createOpenAiVisionClient } from "../src/ai/providers/openai-vision-client";
import { OpenAiVisionProvider } from "../src/ai/providers/openai-vision.provider";
import type { ExtractedBodyScan, ExtractedMeasurement } from "../src/ai/providers/vision-provider.interface";

const SAMPLES = join(__dirname, "..", "..", "..", "scripts", "spikes", "inbody-samples");
const TRUTH = join(SAMPLES, "truth");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** ADR-053's definition of "right": within 0.05 of the truth (values are printed to 0.1). */
const TOLERANCE = 0.05;
/** A height converted from feet and inches is only as exact as the printed half-inch. */
const HEIGHT_TOLERANCE_CM = 0.5;
/** The confirm screen pre-fills at this confidence, so a wrong value above it looks checked. */
const HIGH_CONFIDENCE = 0.9;
/** The plan's bar: a change must not drop the reader below this. */
const MINIMUM_EXACT = 0.88;

interface Truth {
  fields?: Record<string, number | null>;
  segmental?: Record<string, number | null>;
  heightCm?: number | null;
  ageYears?: number | null;
}

interface Result {
  sample: string;
  key: string;
  expected: number | null;
  got: ExtractedMeasurement;
  correct: boolean;
}

function matches(expected: number | null, got: number | null, tolerance: number): boolean {
  if (expected === null || got === null) return expected === got;
  return Math.abs(expected - got) <= tolerance;
}

function compare(sample: string, truth: Truth, read: ExtractedBodyScan): Result[] {
  const results: Result[] = [];
  const add = (key: string, expected: number | null, got: ExtractedMeasurement, tolerance = TOLERANCE) =>
    results.push({ sample, key, expected, got, correct: matches(expected, got.value, tolerance) });

  for (const [metric, expected] of Object.entries(truth.fields ?? {})) {
    add(metric, expected, read.fields[metric as keyof ExtractedBodyScan["fields"]]);
  }
  for (const [site, expected] of Object.entries(truth.segmental ?? {})) {
    add(`segmental.${site}`, expected, read.segmental[site as keyof ExtractedBodyScan["segmental"]]);
  }
  if (truth.heightCm !== undefined) add("heightCm", truth.heightCm, read.heightCm, HEIGHT_TOLERANCE_CM);
  if (truth.ageYears !== undefined) add("ageYears", truth.ageYears, read.ageYears);
  return results;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`);

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY to run the evaluation (it makes real OpenAI calls).");

  const samples = readdirSync(SAMPLES).filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()));
  if (samples.length === 0) throw new Error(`No sample sheets in ${SAMPLES}.`);

  const provider = new OpenAiVisionProvider(createOpenAiVisionClient(apiKey));
  const results: Result[] = [];
  const unlabelled: string[] = [];

  for (const file of samples) {
    const name = file.slice(0, -extname(file).length);
    let truth: Truth;
    try {
      truth = JSON.parse(readFileSync(join(TRUTH, `${name}.json`), "utf8").replace(/^\uFEFF/, "")) as Truth;
    } catch {
      unlabelled.push(name);
      continue;
    }
    // The server's own processing (body.service.ts), so this scores what production sees.
    const webp = await sharp(readFileSync(join(SAMPLES, file)))
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const read = await provider.extractBodyScan(webp, "image/webp");
    results.push(...compare(name, truth, read));
    process.stdout.write(".");
  }
  process.stdout.write("\n\n");

  if (unlabelled.length > 0) console.log(`Skipped (no truth file): ${unlabelled.join(", ")}\n`);

  const exact = results.filter((r) => r.correct).length;
  const wrongHigh = results.filter((r) => !r.correct && r.got.value !== null && r.got.confidence >= HIGH_CONFIDENCE);

  const keys = [...new Set(results.map((r) => r.key))];
  console.log("Per value:");
  for (const key of keys) {
    const rows = results.filter((r) => r.key === key);
    console.log(`  ${key.padEnd(28)} ${pct(rows.filter((r) => r.correct).length, rows.length).padStart(5)} of ${rows.length}`);
  }
  console.log("\nWrong at high confidence (pre-filled as if checked):");
  for (const r of wrongHigh) {
    console.log(`  ${r.sample} ${r.key}: read ${r.got.value} (${r.got.confidence}), truth ${r.expected}`);
  }

  const score = results.length === 0 ? 0 : exact / results.length;
  console.log(`\nExact: ${pct(exact, results.length)} (${exact}/${results.length}), wrong at high confidence: ${wrongHigh.length}`);
  console.log(score >= MINIMUM_EXACT ? `PASS: at or above ${MINIMUM_EXACT * 100}%` : `FAIL: below ${MINIMUM_EXACT * 100}%`);
  if (score < MINIMUM_EXACT) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
