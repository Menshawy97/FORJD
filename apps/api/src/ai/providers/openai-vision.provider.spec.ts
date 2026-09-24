import { InternalServerErrorException } from "@nestjs/common";

import { OpenAiVisionProvider } from "./openai-vision.provider";

/**
 * The client is injected (see `openai-vision-client.ts`) precisely so it can be stubbed
 * here instead of making a live call in CI -- same fix, same reasoning, as
 * `nvidia-vision.provider.spec.ts`. The prompt-building and response-parsing behaviour is
 * shared with NvidiaVisionProvider (both call the same `inbody-extraction-prompt.ts` /
 * `inbody-response-parser.ts`) and is already covered by the golden fixtures in
 * `tests/fixtures/inbody/` -- this file only tests what is genuinely specific to this
 * provider: the retry loop, the vendor call shape, and the failure message.
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

describe("OpenAiVisionProvider", () => {
  let create: jest.Mock;
  let provider: OpenAiVisionProvider;

  beforeEach(() => {
    create = jest.fn();
    const client = { chat: { completions: { create } } };
    provider = new OpenAiVisionProvider(client as never);
  });

  it("parses a clean response and calls the vendor with gpt-5.4-mini, structured output and a high-detail image", async () => {
    create.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          inbody_model: "570",
          test_date: "2024-11-27",
          fields: Object.fromEntries(ALL_METRICS.map((f) => [f, { value: 5, confidence: 0.8, reading_note: "" }])),
          image_quality_notes: "",
        }),
      ),
    );

    const result = await provider.extractBodyScan(Buffer.from("fake"), "image/jpeg");

    expect(result.fields.weight_kg.value).toBe(5);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4-mini",
        max_completion_tokens: expect.any(Number),
        response_format: expect.objectContaining({ type: "json_schema", json_schema: expect.objectContaining({ strict: true }) }),
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: "image_url", image_url: { url: expect.stringMatching(/^data:image\/jpeg;base64,/), detail: "high" } }),
            ]),
          }),
        ],
      }),
    );
  });

  it("retries on a non-JSON response and succeeds if a later attempt returns valid JSON", async () => {
    create
      .mockResolvedValueOnce(fakeCompletion("I can see an InBody results sheet in this image."))
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            inbody_model: "570",
            test_date: null,
            fields: Object.fromEntries(ALL_METRICS.map((f) => [f, { value: 7, confidence: 0.8, reading_note: "" }])),
            image_quality_notes: "",
          }),
        ),
      );

    const result = await provider.extractBodyScan(Buffer.from("fake"), "image/jpeg");
    expect(result.fields.weight_kg.value).toBe(7);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries against a consistently non-JSON response", async () => {
    create.mockResolvedValue(fakeCompletion("I can see an InBody results sheet in this image."));

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("names the finish reason when the model returns no content, so a token-budget cut-off is diagnosable", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: null }, finish_reason: "length" }] });

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toMatchObject({
      message: expect.stringContaining("finish_reason: length"),
    });
  });

  it("says the finish reason is unknown when the vendor returns no choices at all", async () => {
    create.mockResolvedValue({ choices: [] });

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toMatchObject({
      message: expect.stringContaining("finish_reason: unknown"),
    });
  });

  it("treats a null content response the same as a parse failure and retries", async () => {
    create.mockResolvedValue(fakeCompletion(null));

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("falls back to String(err) in the failure message when the vendor rejects with a non-Error value", async () => {
    create.mockRejectedValue("rate_limit_exceeded");

    await expect(provider.extractBodyScan(Buffer.from("fake"), "image/jpeg")).rejects.toMatchObject({
      message: expect.stringContaining("rate_limit_exceeded"),
    });
    expect(create).toHaveBeenCalledTimes(3);
  });
});
