import { createOpenAiVisionClient } from "./openai-vision-client";

/**
 * Medium finding alongside C2: no request timeout meant a hung vendor could occupy a request
 * handler for minutes, and the SDK's default retry behaviour retries non-retryable 4xx
 * responses. WHOOP already caps every call at 10s (`whoop-client.ts`); this brings vision into
 * line at a slightly higher bound appropriate for a multi-second vision inference.
 */
describe("createOpenAiVisionClient", () => {
  it("is constructed with a 30s timeout and no automatic retries", () => {
    const client = createOpenAiVisionClient("test-key");

    expect(client.timeout).toBe(30_000);
    expect(client.maxRetries).toBe(0);
  });
});
