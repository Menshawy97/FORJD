import { BODY_METRICS, KG_PER_LB, SEGMENTAL_SITES } from "@forjd/domain";

import { buildInBodyExtractionPrompt } from "./inbody-extraction-prompt";

/**
 * These assert properties of the prompt (ADR-032's decisions), not a frozen string -- that
 * job belongs to tests/fixtures/inbody/extraction-prompt.golden.txt and its CI diff gate
 * (`pnpm --filter @forjd/api prompt:golden`). A property test keeps holding after a
 * deliberate, reviewed regeneration of the golden file; the diff gate is what catches an
 * *unintended* change.
 */
describe("buildInBodyExtractionPrompt", () => {
  const prompt = buildInBodyExtractionPrompt();

  it("names every BODY_METRICS key -- the regression guard for the prompt covering 14 fields, not 9", () => {
    for (const metric of BODY_METRICS) {
      expect(prompt).toContain(`"${metric}"`);
    }
  });

  it("names every SEGMENTAL_SITES key", () => {
    for (const site of SEGMENTAL_SITES) {
      expect(prompt).toContain(`"${site}"`);
    }
  });

  it("uses distinct example confidence values, never a uniform one (ADR-032 decision 4)", () => {
    const confidences = [...prompt.matchAll(/"confidence":\s*([\d.]+)/g)].map((m) => Number(m[1]));
    // 9 BODY_METRICS + 5 SEGMENTAL_SITES example entries.
    expect(confidences).toHaveLength(BODY_METRICS.length + SEGMENTAL_SITES.length);
    expect(new Set(confidences).size).toBeGreaterThan(1);
  });

  it("states the exact KG_PER_LB conversion factor, matching @forjd/domain's own constant", () => {
    expect(prompt).toContain(String(KG_PER_LB));
  });

  it("states that a conversion is never a reason for value to be null (ADR-032 decision 6)", () => {
    expect(prompt).toMatch(/conversion is not a reason for value to be null/i);
  });

  it("labels the worked example as fake filler, not real data", () => {
    expect(prompt).toMatch(/fake filler/i);
  });
});
