import { SEGMENTAL_SITES } from "@forjd/domain";

import { buildInBodyExtractionPrompt } from "./inbody-extraction-prompt";
import { PRINTED_FIELDS, PRINTED_UNITS } from "./inbody-extraction-schema";

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
});
