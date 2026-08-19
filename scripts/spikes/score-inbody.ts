/**
 * Spike B scorer — per-field accuracy and confidence calibration (ADR-006).
 *
 * Scores FIELD-level, never document-level: document-level accuracy hides exactly
 * the failure that matters, since one wrong number corrupts a progress graph
 * permanently while the other five look fine.
 *
 * Usage: pnpm score   (see README.md in this directory)
 */
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const SAMPLES = join(import.meta.dirname, "inbody-samples");
const TRUTH = join(SAMPLES, "truth");
const OUT = join(SAMPLES, "out");

const FIELDS = [
  "weight_kg",
  "body_fat_percent",
  "skeletal_muscle_mass_kg",
  "bmi",
  "visceral_fat_level",
  "total_body_water_l",
] as const;

/** Values are printed to 1 decimal place; this only absorbs float representation. */
const EPSILON = 0.05;

/** Above this, Phase 5 would pre-fill the confirmation screen. That's what makes errors here dangerous. */
const HIGH_CONFIDENCE = 0.9;

type Comparison = {
  photo: string;
  field: string;
  expected: number | null;
  got: number | null;
  confidence: number;
  correct: boolean;
  note: string;
};

function matches(expected: number | null, got: number | null): boolean {
  if (expected === null || got === null) return expected === got;
  return Math.abs(expected - got) < EPSILON;
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const outFiles = (await readdir(OUT).catch(() => [])).filter((f) => f.endsWith(".json"));
  if (outFiles.length === 0) {
    console.error(`No extraction results in ${OUT}. Run \`pnpm extract\` first.`);
    process.exit(1);
  }

  const comparisons: Comparison[] = [];
  const missingTruth: string[] = [];

  for (const file of outFiles) {
    const stem = basename(file, ".json");
    let raw: string;
    try {
      raw = await readFile(join(TRUTH, file), "utf8");
    } catch {
      missingTruth.push(stem);
      continue;
    }
    // Editors on Windows commonly save JSON with a UTF-8 BOM, which JSON.parse rejects.
    let truth: { fields: Record<string, number | null> };
    try {
      truth = JSON.parse(raw.replace(/^﻿/, ""));
    } catch (err) {
      console.error(`  ${stem}: truth file is not valid JSON — ${(err as Error).message}`);
      process.exit(1);
    }
    const extracted = JSON.parse((await readFile(join(OUT, file), "utf8")).replace(/^﻿/, ""));

    for (const field of FIELDS) {
      const got = extracted.fields?.[field];
      comparisons.push({
        photo: stem,
        field,
        expected: truth.fields?.[field] ?? null,
        got: got?.value ?? null,
        confidence: got?.confidence ?? 0,
        correct: matches(truth.fields?.[field] ?? null, got?.value ?? null),
        note: got?.reading_note ?? "",
      });
    }
  }

  if (missingTruth.length > 0) {
    console.log(`Skipped (no hand-labelled truth file): ${missingTruth.join(", ")}\n`);
  }
  if (comparisons.length === 0) {
    console.error(`No labelled pairs to score. Add truth files to ${TRUTH}.`);
    process.exit(1);
  }

  const photos = new Set(comparisons.map((c) => c.photo)).size;
  console.log(`Scored ${photos} photo(s), ${comparisons.length} field readings.\n`);

  console.log("PER-FIELD ACCURACY");
  for (const field of FIELDS) {
    const rows = comparisons.filter((c) => c.field === field);
    const correct = rows.filter((c) => c.correct).length;
    console.log(`  ${field.padEnd(26)} ${String(correct).padStart(3)}/${rows.length}  ${pct(correct, rows.length)}`);
  }
  const totalCorrect = comparisons.filter((c) => c.correct).length;
  console.log(`  ${"OVERALL".padEnd(26)} ${String(totalCorrect).padStart(3)}/${comparisons.length}  ${pct(totalCorrect, comparisons.length)}\n`);

  // The decisive question: does confidence separate right from wrong?
  const right = comparisons.filter((c) => c.correct);
  const wrong = comparisons.filter((c) => !c.correct);
  const mean = (xs: Comparison[]) =>
    xs.length === 0 ? NaN : xs.reduce((s, c) => s + c.confidence, 0) / xs.length;

  console.log("CONFIDENCE CALIBRATION");
  console.log(`  mean confidence when correct : ${mean(right).toFixed(3)}  (n=${right.length})`);
  console.log(`  mean confidence when wrong   : ${mean(wrong).toFixed(3)}  (n=${wrong.length})`);
  const separation = mean(right) - mean(wrong);
  console.log(`  separation                   : ${separation.toFixed(3)}\n`);

  const buckets: Array<[string, (c: number) => boolean]> = [
    [">= 0.95", (c) => c >= 0.95],
    ["0.90-0.95", (c) => c >= 0.9 && c < 0.95],
    ["0.80-0.90", (c) => c >= 0.8 && c < 0.9],
    ["< 0.80", (c) => c < 0.8],
  ];
  console.log("  accuracy by confidence bucket");
  for (const [label, test] of buckets) {
    const rows = comparisons.filter((c) => test(c.confidence));
    const ok = rows.filter((c) => c.correct).length;
    console.log(`    ${label.padEnd(11)} ${String(ok).padStart(3)}/${String(rows.length).padEnd(3)}  ${pct(ok, rows.length)}`);
  }

  // High-confidence errors are the ones a confirmation screen pre-fills and a
  // tired user taps straight past. This count is what decides the ADR.
  const highConfidence = comparisons.filter((c) => c.confidence >= HIGH_CONFIDENCE);
  const silentErrors = highConfidence.filter((c) => !c.correct);
  console.log(`\nHIGH-CONFIDENCE ERRORS (>= ${HIGH_CONFIDENCE}) — ${silentErrors.length} of ${highConfidence.length}`);
  for (const e of silentErrors) {
    console.log(`  ${e.photo} / ${e.field}: expected ${e.expected}, got ${e.got} @ ${e.confidence.toFixed(2)}`);
    if (e.note) console.log(`      note: ${e.note}`);
  }
  if (silentErrors.length === 0) console.log("  (none)");

  console.log("\nREAD THIS BEFORE FILLING IN ADR-006:");
  if (Number.isNaN(separation) || separation <= 0.02) {
    console.log("  Confidence does NOT separate correct from incorrect readings.");
    console.log("  The confidence gate is decorative as designed — redesign it before Phase 5");
    console.log("  depends on it (ADR-006 explicitly calls this out as the spike's kill criterion).");
  } else {
    console.log("  Confidence separates correct from incorrect readings. The gate carries real");
    console.log("  signal, but check the high-confidence errors above: those are the readings a");
    console.log("  pre-filled confirmation screen would invite the user to accept without looking.");
  }
}

main();
