import { createHmac } from "node:crypto";

import { verifyWhoopWebhookSignature } from "./whoop-webhook-signature";

/**
 * WHOOP's own documented algorithm: `base64(HMAC-SHA256(timestamp_header + raw_body,
 * client_secret))` -- verified here against a real HMAC computed the same way WHOOP itself
 * would, not a stub. Timing-safe comparison and timestamp freshness are both real security
 * properties, not decoration, so both get their own failure-mode tests.
 */
describe("verifyWhoopWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const rawBody = JSON.stringify({ user_id: 123, id: "abc", type: "recovery.updated", trace_id: "t1" });

  function sign(timestamp: string, body: string, key = secret): string {
    return createHmac("sha256", key).update(timestamp + body).digest("base64");
  }

  it("accepts a correctly signed, fresh webhook", () => {
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);

    expect(verifyWhoopWebhookSignature({ rawBody, timestamp, signature, secret })).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody, "wrong-secret");

    expect(verifyWhoopWebhookSignature({ rawBody, timestamp, signature, secret })).toBe(false);
  });

  it("rejects a signature computed over a different body (tampered payload)", () => {
    const timestamp = String(Date.now());
    const signature = sign(timestamp, rawBody);
    const tamperedBody = JSON.stringify({ user_id: 123, id: "abc", type: "recovery.updated", trace_id: "t2" });

    expect(verifyWhoopWebhookSignature({ rawBody: tamperedBody, timestamp, signature, secret })).toBe(false);
  });

  it("rejects a stale timestamp outside the freshness window", () => {
    const staleTimestamp = String(Date.now() - 10 * 60_000); // 10 minutes old
    const signature = sign(staleTimestamp, rawBody);

    expect(verifyWhoopWebhookSignature({ rawBody, timestamp: staleTimestamp, signature, secret })).toBe(false);
  });

  it("rejects a timestamp that is not a valid number", () => {
    const signature = sign("not-a-number", rawBody);
    expect(verifyWhoopWebhookSignature({ rawBody, timestamp: "not-a-number", signature, secret })).toBe(false);
  });

  it("rejects a malformed (non-base64) signature without throwing", () => {
    const timestamp = String(Date.now());
    expect(() =>
      verifyWhoopWebhookSignature({ rawBody, timestamp, signature: "not valid base64!! %%", secret }),
    ).not.toThrow();
    expect(verifyWhoopWebhookSignature({ rawBody, timestamp, signature: "not valid base64!! %%", secret })).toBe(
      false,
    );
  });

  it("rejects a signature of a different length than expected, without throwing", () => {
    const timestamp = String(Date.now());
    expect(verifyWhoopWebhookSignature({ rawBody, timestamp, signature: "dG9vc2hvcnQ=", secret })).toBe(false);
  });
});
