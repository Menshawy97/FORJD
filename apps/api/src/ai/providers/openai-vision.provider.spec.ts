import { InternalServerErrorException, Logger } from "@nestjs/common";

import { OpenAiVisionProvider } from "./openai-vision.provider";

/**
 * The client is injected (see `openai-vision-client.ts`) precisely so it can be stubbed
 * here instead of making a live call in CI -- same fix, same reasoning, as
 * `nvidia-vision.provider.spec.ts`. The prompt-building and response-parsing behaviour is
 * shared with NvidiaVisionProvider (both call the same `inbody-extraction-prompt.ts` /
 * `inbody-response-parser.ts`) and is already covered by the golden fixtures in
 * `tests/fixtures/inbody/` -- this file only tests what is genuinely specific to this
 * provider: the retry loop, the vendor call shape, and the failure message.
 *
 * Fake timers throughout: the retry loop waits between attempts (8.5 S9, L7-1), and a slow
 * vendor call is simulated by moving the clock inside the stubbed `create`.
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
  let logError: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-09-26T10:00:00Z") });
    create = jest.fn();
    const client = { chat: { completions: { create } } };
    provider = new OpenAiVisionProvider(client as never);
    logError = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Runs an extraction to completion, letting every backoff wait elapse. */
  async function extract(): ReturnType<OpenAiVisionProvider["extractBodyScan"]> {
    const pending = provider.extractBodyScan(Buffer.from("fake"), "image/jpeg");
    pending.catch(() => undefined);
    await jest.runAllTimersAsync();
    return pending;
  }

  /** A vendor call that takes `ms` of wall-clock time before answering `content`. */
  function slowCompletion(ms: number, content: string | null) {
    return async () => {
      jest.setSystemTime(Date.now() + ms);
      return fakeCompletion(content);
    };
  }

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

    const result = await extract();

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
      { timeout: 30_000 },
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

    const result = await extract();
    expect(result.fields.weight_kg.value).toBe(7);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries against a consistently non-JSON response", async () => {
    create.mockResolvedValue(fakeCompletion("I can see an InBody results sheet in this image."));

    await expect(extract()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("logs the finish reason when the model returns no content, so a token-budget cut-off is diagnosable", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: null }, finish_reason: "length" }] });

    await expect(extract()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("finish_reason: length"));
  });

  it("logs the finish reason as unknown when the vendor returns no choices at all", async () => {
    create.mockResolvedValue({ choices: [] });

    await expect(extract()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("finish_reason: unknown"));
  });

  it("treats a null content response the same as a parse failure and retries", async () => {
    create.mockResolvedValue(fakeCompletion(null));

    await expect(extract()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("falls back to String(err) in the logged failure when the vendor rejects with a non-Error value", async () => {
    create.mockRejectedValue("rate_limit_exceeded");

    await expect(extract()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("rate_limit_exceeded"));
    expect(create).toHaveBeenCalledTimes(3);
  });

  // 8.5 S9, L7-2: the vendor's own error text used to be the client-facing message. It is
  // logged server-side instead, and the app gets a fixed message with nothing from the vendor.
  it("gives the client a generic message, never the vendor's error text", async () => {
    create.mockRejectedValue(new Error("vendor internals: org-abc123 quota exceeded"));

    const failure = await extract().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(InternalServerErrorException);
    expect((failure as Error).message).not.toMatch(/vendor internals|org-abc123|quota/);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("org-abc123 quota exceeded"));
  });

  // 8.5 S9, L7-1: three 30 s attempts back to back could hold a request (and a Cloud Run slot)
  // for ~90 s. Now every attempt shares one 45 s budget and waits a moment before retrying.
  describe("time budget", () => {
    it("gives the first attempt the full 30 s per-attempt timeout", async () => {
      create.mockResolvedValue(fakeCompletion("not json"));

      await extract().catch(() => undefined);

      expect(create.mock.calls[0]?.[1]).toEqual({ timeout: 30_000 });
    });

    it("waits 1 s before the second attempt and 2 s before the third", async () => {
      create.mockResolvedValue(fakeCompletion("not json"));

      const pending = provider.extractBodyScan(Buffer.from("fake"), "image/jpeg");
      pending.catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      expect(create).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(999);
      expect(create).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(create).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1_999);
      expect(create).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(create).toHaveBeenCalledTimes(3);

      await expect(pending).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it("caps a later attempt's timeout at what is left of the 45 s budget", async () => {
      create.mockImplementation(slowCompletion(25_000, "not json"));

      await extract().catch(() => undefined);

      // 25 s first attempt + 1 s wait leaves 19 s of the 45 s budget.
      expect(create.mock.calls[1]?.[1]).toEqual({ timeout: 19_000 });
    });

    it("stops once the budget is spent instead of starting another attempt", async () => {
      create.mockImplementation(slowCompletion(25_000, "not json"));

      await expect(extract()).rejects.toBeInstanceOf(InternalServerErrorException);

      // 25 s + 1 s wait + 25 s already passes 45 s: no third attempt.
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("does not start an attempt with under 5 s of budget left", async () => {
      create.mockImplementationOnce(slowCompletion(40_000, "not json")).mockResolvedValue(fakeCompletion("not json"));

      await expect(extract()).rejects.toBeInstanceOf(InternalServerErrorException);

      // 40 s + 1 s wait leaves 4 s: too little for a multi-second vision call.
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("still succeeds on a retry that lands inside the budget", async () => {
      create.mockImplementationOnce(slowCompletion(20_000, "not json")).mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            inbody_model: "570",
            test_date: null,
            fields: Object.fromEntries(ALL_METRICS.map((f) => [f, { value: 9, confidence: 0.8, reading_note: "" }])),
            image_quality_notes: "",
          }),
        ),
      );

      const result = await extract();

      expect(result.fields.weight_kg.value).toBe(9);
      // 20 s + 1 s wait leaves 24 s.
      expect(create.mock.calls[1]?.[1]).toEqual({ timeout: 24_000 });
    });
  });
});
