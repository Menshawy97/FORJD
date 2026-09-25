import { SEGMENTAL_SITES } from "@forjd/domain";

import { buildInBodyExtractionPrompt } from "./inbody-extraction-prompt";
import {
  AGE_UNITS,
  buildInBodyExtractionSchema,
  HEIGHT_UNITS,
  PRINTED_FIELDS,
  PRINTED_UNITS,
} from "./inbody-extraction-schema";

/**
 * These assert properties of the prompt (ADR-032, ADR-053), not a frozen string -- that job
 * belongs to tests/fixtures/inbody/extraction-prompt.golden.txt and its CI diff gate
 * (`pnpm --filter @forjd/api prompt:golden`). A property test keeps holding after a
 * deliberate, reviewed regeneration of the golden file; the diff gate is what catches an
 * *unintended* change.
 */
describe("buildInBodyExtractionPrompt", () => {
  const prompt = buildInBodyExtractionPrompt();

  it("names every printed field and every segmental site the schema asks for", () => {
    for (const { key } of Object.values(PRINTED_FIELDS)) {
      expect(prompt).toContain(key);
    }
    for (const site of SEGMENTAL_SITES) {
      expect(prompt).toContain(site);
    }
  });

  it("names every unit the schema accepts", () => {
    for (const unit of PRINTED_UNITS) {
      expect(prompt).toContain(`"${unit}"`);
    }
  });

  // ADR-053: the model read lb digits correctly and then skipped the conversion; the parser now
  // converts, so the prompt must stop asking the model to.
  it("asks for printed values and units, not converted ones", () => {
    expect(prompt).toMatch(/do not convert units/i);
  });

  it("warns off the numbers that are not the current value", () => {
    expect(prompt).toMatch(/normal ranges/i);
    expect(prompt).toMatch(/Body Composition History/);
    expect(prompt).toMatch(/TBW\/LBM/);
  });

  // Different InBody machines print different sets of values (the 770 has no score and shows
  // visceral fat as an area); an absent field must come back null, never estimated.
  it("tells the model a field the sheet does not print is null", () => {
    expect(prompt).toMatch(/never fill a field the sheet does not print/i);
    expect(prompt).toMatch(/Visceral Fat AREA/);
  });

  // Slice B (scan-height-age-plan.md §2.3): the header's height and age, transcribed as printed.
  it("asks for the header's height and age, with every unit the schema accepts for them", () => {
    expect(prompt).toMatch(/\bheight\b/);
    expect(prompt).toMatch(/\bage\b/);
    for (const unit of [...HEIGHT_UNITS, ...AGE_UNITS]) {
      expect(prompt).toContain(`"${unit}"`);
    }
    expect(prompt).toMatch(/5 ft 10 in/);
  });
});

describe("buildInBodyExtractionSchema", () => {
  const schema = buildInBodyExtractionSchema() as {
    required: string[];
    properties: Record<string, { required: string[]; properties: Record<string, unknown> }>;
  };

  // Strict structured output requires every key; height carries a separate inches value so
  // "5 ft 10 in" can be reported exactly as printed.
  it("requires a height (value, unit, inches) and an age (value, unit)", () => {
    expect(schema.required).toEqual(expect.arrayContaining(["height", "age"]));
    expect(schema.properties.height?.required).toEqual(["value", "unit", "inches", "confidence", "reading_note"]);
    expect(schema.properties.age?.required).toEqual(["value", "unit", "confidence", "reading_note"]);
  });
});
