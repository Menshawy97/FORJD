import { InternalServerErrorException } from "@nestjs/common";

import { NvidiaVisionProvider } from "./nvidia-vision.provider";

/**
 * The client is injected (see `nvidia-vision-client.ts`) precisely so it can be stubbed
 * here with recorded-shape fixtures instead of making a live call in CI -- same fix, same
 * reasoning, as `supabase-storage.provider.spec.ts`. The fixture bodies below are shaped
 * exactly like real responses captured while building Spike B (scripts/spikes/), not
 * invented -- see that directory's README for how each failure mode was found.
 */
function fakeCompletion(content: string | null) {
  return { choices: [{ message: { content } }] };
}

const ALL_METRICS = [
  "weight_kg",
  "skeletal_muscle_mass_kg",
  "body_fat_mass_kg",
  "body_fat_percent",
  "visceral_fat_level",
  "total_body_water_l",
  "bmi",
  "basal_metabolic_rate_kcal",
  "inbody_score",
];

describe("NvidiaVisionProvider", () => {
  let create: jest.Mock;
  let provider: NvidiaVisionProvider;

  beforeEach(() => {
    create = jest.fn();
    const client = { chat: { completions: { create } } };
    provider = new NvidiaVisionProvider(client as never);
  });

  it("parses a clean, well-formed response into ExtractedBodyScan", async () => {
    create.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          inbody_model: "570",
          test_date: "2024-11-27",
          fields: {
            weight_kg: { value: 66.8, confidence: 0.99, reading_note: "" },
            skeletal_muscle_mass_kg: { value: 24.5, confidence: 0.95, reading_note: "" },
            body_fat_mass_kg: { value: 29.2, confidence: 0.98, reading_note: "" },
            body_fat_percent: { value: 24.2, confidence: 0.99, reading_note: "" },
            visceral_fat_level: { value: null, confidence: 0, reading_note: "Blurry" },
            total_body_water_l: { value: null, confidence: 0, reading_note: "Blurry" },
            bmi: { value: null, confidence: 0, reading_note: "Blurry" },
            basal_metabolic_rate_kcal: { value: null, confidence: 0, reading_note: "Blurry" },
            inbody_score: { value: null, confidence: 0, reading_note: "Blurry" },
          },
          segmental: {
            right_arm: { value: 3.62, confidence: 0.86, reading_note: "" },
            left_arm: { value: 3.55, confidence: 0.85, reading_note: "" },
            trunk: { value: 31.4, confidence: 0.92, reading_note: "" },
            right_leg: { value: 10.28, confidence: 0.86, reading_note: "" },
            left_leg: { value: 10.11, confidence: 0.84, reading_note: "" },
          },
          image_quality_notes: "Blurry",
        }),
      ),
    );

    const result = await provider.extractBodyScan(Buffer.from("fake"), "image/jpeg");

    expect(result.inbodyModel).toBe("570");
    expect(result.fields.weight_kg).toEqual({ value: 66.8, confidence: 0.99, readingNote: "" });
    expect(result.fields.visceral_fat_level).toEqual({ value: null, confidence: 0, readingNote: "Blurry" });
    expect(result.segmental.right_arm).toEqual({ value: 3.62, confidence: 0.86, readingNote: "" });
    expect(result.segmental.trunk.value).toBe(31.4);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("tolerates a markdown code fence around the JSON, verified as a real response shape", async () => {
    create.mockResolvedValueOnce(
      fakeCompletion(
        "```json\n" +
          JSON.stringify({
            inbody_model: null,
            test_date: null,
            fields: Object.fromEntries(ALL_METRICS.map((f) => [f, { value: 1, confidence: 0.9, reading_note: "" }])),
            image_quality_notes: "",
          }) +
          "\n```",
      ),
    );

    const result = await provider.extractBodyScan(Buffer.from("fake"), "image/png");
    expect(result.fields.bmi.value).toBe(1);
  });

  it("converts an lb-printed weight to kg and preserves the reading_note explaining it", async () => {
    // Recorded from a real photo during Spike B: the sheet printed 120.5 lb only.
    create.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          inbody_model: "570",
          test_date: "2026-01-15",
          fields: {
            weight_kg: { value: 54.66, confidence: 0.99, reading_note: "sheet printed 120.5 lb, converted to kg" },
            skeletal_muscle_mass_kg: { value: 22.59, confidence: 0.99, reading_note: "Converted from lb to kg" },
            body_fat_mass_kg: { value: 13.24, confidence: 0.99, reading_note: "Converted from lb to kg" },
            body_fat_percent: { value: 24.2, confidence: 0.99, reading_note: "" },
            visceral_fat_level: { value: null, confidence: 0, reading_note: "" },
            total_body_water_l: { value: 30.3, confidence: 0.99, reading_note: "Converted from lb to L" },
            bmi: { value: 22, confidence: 0.9, reading_note: "" },
            basal_metabolic_rate_kcal: { value: 1265, confidence: 0.9, reading_note: "" },
            inbody_score: { value: null, confidence: 0, reading_note: "" },
          },
          image_quality_notes: "",
        }),
      ),
    );

    const result = await provider.extractBodyScan(Buffer.from("fake"), "image/webp");
    expect(result.fields.weight_kg.value).toBeCloseTo(54.66, 2);
    expect(result.fields.weight_kg.readingNote).toContain("120.5 lb");
  });

  it("retries on a non-JSON response and succeeds if a later attempt returns valid JSON", async () => {
    create
      .mockResolvedValueOnce(fakeCompletion("Sure, here is a description of the image: it shows a piece of paper."))
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            inbody_model: "570",
            test_date: null,
            fields: Object.fromEntries(ALL_METRICS.map((f) => [f, { value: 5, confidence: 0.8, reading_note: "" }])),
            image_quality_notes: "",
          }),
        ),
      );

    const result = await provider.extractBodyScan(Buffer.from("fake"), "image/jpeg");
    expect(result.fields.weight_kg.value).toBe(5);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries against a consistently non-JSON response", async () => {
    create.mockResolvedValue(fakeCompletion("The image shows a hand holding a sheet of paper."));

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("treats a null content response the same as a parse failure and retries", async () => {
    create.mockResolvedValue(fakeCompletion(null));

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });
});
