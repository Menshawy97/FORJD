import { createNvidiaVisionClient } from "./nvidia-vision-client";

/** Same reasoning as `openai-vision-client.spec.ts` -- see that file's docblock. */
describe("createNvidiaVisionClient", () => {
  it("is constructed with a 30s timeout and no automatic retries", () => {
    const client = createNvidiaVisionClient("test-key");

    expect(client.timeout).toBe(30_000);
    expect(client.maxRetries).toBe(0);
  });
});
