import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { parseInBodyExtractionResponse } from "./inbody-response-parser";

/**
 * Golden-fixture tests on the InBody response parser (CLAUDE.md rule 8, ADR-032). Each
 * fixture in tests/fixtures/inbody/responses/ is either a real recorded model response
 * (or a real payload inside a reconstructed wrapper -- see that directory's README for exactly
 * which) or a real observed failure mode from ADR-032. See the README for full provenance.
 *
 * Two things borrowed from free-exercise-db.adapter.spec.ts, the repo's own reference golden
 * suite: loading throws loudly on drift rather than silently skipping a missing file, and a
 * meta-test asserts every `.txt` in the directory is actually covered, so dropping one in
 * without wiring it up fails the suite instead of passing unnoticed.
 */
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "..", "..", "tests", "fixtures", "inbody", "responses");

const allFiles = readdirSync(FIXTURES_DIR);
const txtNames = allFiles.filter((f) => f.endsWith(".txt")).map((f) => basename(f, ".txt"));

const loadText = (name: string): string => {
  const path = join(FIXTURES_DIR, `${name}.txt`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`fixture drift: no response text for "${name}" at ${path}`);
  }
};

const loadExpected = (name: string): unknown => {
  const path = join(FIXTURES_DIR, `${name}.expected.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`fixture drift: no expected output for "${name}" at ${path}`);
  }
};

/** Names that are expected to make the parser throw, so they carry no .expected.json. */
const THROWING_FIXTURES = new Set(["non-json-prose"]);

describe("parseInBodyExtractionResponse: golden fixtures", () => {
  const parsingFixtures = txtNames.filter((name) => !THROWING_FIXTURES.has(name));

  it.each(parsingFixtures)("parses %s into its committed expected ExtractedBodyScan", (name) => {
    const result = parseInBodyExtractionResponse(loadText(name));
    expect(result).toEqual(loadExpected(name));
  });

  it.each([...THROWING_FIXTURES])("throws on %s", (name) => {
    expect(() => parseInBodyExtractionResponse(loadText(name))).toThrow();
  });

  it("has a fixture case for every .txt file in the directory (no orphaned fixture)", () => {
    // If this fails, a .txt was added without being picked up by parsingFixtures /
    // THROWING_FIXTURES above -- txtNames is read directly from the directory, so the two
    // arrays above are the only place coverage could silently drop a file.
    const covered = new Set([...parsingFixtures, ...THROWING_FIXTURES]);
    for (const name of txtNames) {
      expect(covered.has(name)).toBe(true);
    }
    expect(txtNames.length).toBe(covered.size);
  });

  it("has no expected.json without a matching .txt (no stale fixture)", () => {
    const expectedNames = allFiles.filter((f) => f.endsWith(".expected.json")).map((f) => basename(f, ".expected.json"));
    for (const name of expectedNames) {
      expect(txtNames).toContain(name);
    }
  });
});

/**
 * Defensive-coercion edge cases that no real recording exercises (every recorded response
 * prints a real string for `image_quality_notes`) but the parser still has to handle safely,
 * since a fully absent field is a legitimate way for a vision model to reply.
 */
describe("parseInBodyExtractionResponse: defensive coercion", () => {
  it("coerces a missing image_quality_notes to an empty string rather than throwing", () => {
    const result = parseInBodyExtractionResponse(
      JSON.stringify({
        inbody_model: null,
        test_date: null,
        fields: {},
        segmental: {},
      }),
    );
    expect(result.imageQualityNotes).toBe("");
  });
});
