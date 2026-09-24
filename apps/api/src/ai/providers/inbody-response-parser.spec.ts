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

/**
 * ADR-053: the model now reports each value as printed, with its printed unit, and the parser
 * does the arithmetic. The evaluation behind that ADR found the model reading an lb sheet's
 * digits correctly and then skipping the conversion -- the single biggest error class -- so the
 * conversion moved out of the prompt and into code, where it is exact every time.
 */
describe("parseInBodyExtractionResponse: printed values and units (ADR-053)", () => {
  const printed = (fields: Record<string, unknown>, segmental: Record<string, unknown> = {}) =>
    JSON.stringify({ inbody_model: "770", test_date: "2016-08-23", fields, segmental, image_quality_notes: "" });
  const field = (value: number | null, unit: string | null, confidence = 0.95, reading_note = "") => ({
    value,
    unit,
    confidence,
    reading_note,
  });

  it("converts lb weight-type values to kg and says so", () => {
    const result = parseInBodyExtractionResponse(
      printed(
        { weight: field(163.3, "lb"), skeletal_muscle_mass: field(87.5, "lb"), body_fat_mass: field(13.4, "lb") },
        { right_arm: field(9.04, "lb") },
      ),
    );

    expect(result.fields.weight_kg.value).toBe(74.07);
    expect(result.fields.skeletal_muscle_mass_kg.value).toBe(39.69);
    expect(result.fields.body_fat_mass_kg.value).toBe(6.08);
    expect(result.segmental.right_arm.value).toBe(4.1);
    expect(result.fields.weight_kg.readingNote).toMatch(/163\.3 lb/);
    expect(result.fields.weight_kg.confidence).toBe(0.95);
  });

  it("keeps kg values exactly as printed", () => {
    const result = parseInBodyExtractionResponse(printed({ weight: field(82.4, "kg"), body_fat_percent: field(12.1, "%") }));

    expect(result.fields.weight_kg.value).toBe(82.4);
    expect(result.fields.body_fat_percent.value).toBe(12.1);
    expect(result.fields.weight_kg.readingNote).toBe("");
  });

  it("converts Total Body Water printed in lb to litres, and keeps it printed in L", () => {
    expect(parseInBodyExtractionResponse(printed({ total_body_water: field(66.4, "lb") })).fields.total_body_water_l.value).toBe(
      30.12,
    );
    expect(parseInBodyExtractionResponse(printed({ total_body_water: field(53, "L") })).fields.total_body_water_l.value).toBe(53);
  });

  it("maps every printed field onto its canonical metric", () => {
    const result = parseInBodyExtractionResponse(
      printed({
        visceral_fat_level: field(3, "level"),
        bmi: field(24.1, "kg/m2"),
        basal_metabolic_rate: field(1934, "kcal"),
        inbody_score: field(88, "points"),
      }),
    );

    expect(result.fields.visceral_fat_level.value).toBe(3);
    expect(result.fields.bmi.value).toBe(24.1);
    expect(result.fields.basal_metabolic_rate_kcal.value).toBe(1934);
    expect(result.fields.inbody_score.value).toBe(88);
  });

  // Different InBody machines print different layouts and units; a value whose unit the parser
  // cannot vouch for is kept (the user can confirm it) but never pre-filled as if trustworthy.
  it("keeps a value with a missing unit but caps its confidence below the pre-fill threshold", () => {
    const result = parseInBodyExtractionResponse(printed({ weight: field(70.2, null, 0.99) }));

    expect(result.fields.weight_kg.value).toBe(70.2);
    expect(result.fields.weight_kg.confidence).toBe(0.5);
    expect(result.fields.weight_kg.readingNote).toMatch(/unit/i);
  });

  it("does the same for a unit that does not belong to the field", () => {
    const result = parseInBodyExtractionResponse(printed({ body_fat_percent: field(12.1, "kg", 0.97) }));

    expect(result.fields.body_fat_percent.value).toBe(12.1);
    expect(result.fields.body_fat_percent.confidence).toBe(0.5);
  });

  it("leaves a field the sheet does not print as null with no confidence", () => {
    const result = parseInBodyExtractionResponse(printed({ inbody_score: field(null, null, 0.9) }));

    expect(result.fields.inbody_score).toEqual({ value: null, confidence: 0, readingNote: "" });
    expect(result.fields.weight_kg).toEqual({ value: null, confidence: 0, readingNote: "" });
  });
});

describe("parseInBodyExtractionResponse: printed-value coercion (ADR-053)", () => {
  it("keeps the model's own note after the conversion note", () => {
    const text = JSON.stringify({
      fields: { weight: { value: 120.5, unit: "lb", confidence: 0.8, reading_note: "Glare on the last digit." } },
    });

    expect(parseInBodyExtractionResponse(text).fields.weight_kg.readingNote).toBe(
      "Converted from 120.5 lb. Glare on the last digit.",
    );
  });

  it("coerces a non-number confidence to 0 and a non-string note to empty", () => {
    const text = JSON.stringify({ fields: { weight: { value: 70, unit: "kg", confidence: "high", reading_note: 5 } } });

    expect(parseInBodyExtractionResponse(text).fields.weight_kg).toEqual({ value: 70, confidence: 0, readingNote: "" });
  });

  it("treats a non-string unit as missing", () => {
    const text = JSON.stringify({ fields: { weight: { value: 70, unit: 1, confidence: 0.99, reading_note: "" } } });

    expect(parseInBodyExtractionResponse(text).fields.weight_kg.confidence).toBe(0.5);
  });

  it("tolerates a missing segmental block and missing header fields", () => {
    const result = parseInBodyExtractionResponse(
      JSON.stringify({ inbody_model: 570, test_date: false, fields: { weight: { value: 70, unit: "kg", confidence: 0.9 } } }),
    );

    expect(result.inbodyModel).toBeNull();
    expect(result.testDate).toBeNull();
    expect(result.imageQualityNotes).toBe("");
    expect(result.segmental.trunk).toEqual({ value: null, confidence: 0, readingNote: "" });
  });

  it("keeps header fields that are present", () => {
    const result = parseInBodyExtractionResponse(
      JSON.stringify({
        inbody_model: "270",
        test_date: "2026-01-15",
        image_quality_notes: "Slight blur",
        fields: { weight: { value: 70, unit: "kg", confidence: 0.9, reading_note: "" } },
      }),
    );

    expect(result).toMatchObject({ inbodyModel: "270", testDate: "2026-01-15", imageQualityNotes: "Slight blur" });
  });

  it("detects the printed shape from a unit alone, even when no printed-only key is present", () => {
    const result = parseInBodyExtractionResponse(
      JSON.stringify({ fields: { bmi: { value: 24.1, unit: "kg/m2", confidence: 0.95 }, broken: null } }),
    );

    expect(result.fields.bmi.value).toBe(24.1);
  });

  it("reads a response with no fields at all as the original shape, all null", () => {
    const result = parseInBodyExtractionResponse(JSON.stringify({ image_quality_notes: "Not an InBody sheet" }));

    expect(result.fields.weight_kg).toEqual({ value: null, confidence: 0, readingNote: "" });
  });
});
