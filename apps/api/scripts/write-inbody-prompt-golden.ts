/**
 * Writes tests/fixtures/inbody/extraction-prompt.golden.txt from the real
 * buildInBodyExtractionPrompt(). CI runs this and then fails if the working tree changed --
 * the same `git diff --exit-code` gate packages/contracts/fixtures and the normalized exercise
 * catalogue already use. A prompt edit that reaches main therefore shows up as a reviewable
 * diff of the prompt text itself, rather than sliding through unnoticed.
 *
 * Run with `pnpm --filter @forjd/api prompt:golden`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildInBodyExtractionPrompt } from "../src/ai/providers/inbody-extraction-prompt";

const outDir = join(__dirname, "..", "..", "..", "tests", "fixtures", "inbody");
const outFile = join(outDir, "extraction-prompt.golden.txt");

mkdirSync(outDir, { recursive: true });

// Trailing newline so the file is ordinary text and a diff does not report a change that is
// only a missing terminator (same reasoning as write-fixtures.ts).
writeFileSync(outFile, `${buildInBodyExtractionPrompt()}\n`);
console.log(`wrote ${outFile}`);
