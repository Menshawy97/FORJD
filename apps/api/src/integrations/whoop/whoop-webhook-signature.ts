import { createHmac, timingSafeEqual } from "node:crypto";

/** WHOOP retries webhook delivery over ~1 hour; anything older than that window is not a
 *  legitimate retry, and this is generous headroom short of that -- long enough to absorb
 *  normal delivery/clock skew, short enough that a captured request can't be replayed hours
 *  or days later. */
const MAX_TIMESTAMP_AGE_MS = 5 * 60_000;

export interface VerifyWhoopWebhookSignatureInput {
  /** The exact raw request body bytes, as a string -- HMAC is computed over the bytes WHOOP
   *  actually sent, not a re-serialized/parsed-and-stringified copy, which is why the API
   *  needs `rawBody: true` (Phase 7F's `main.ts` change) ahead of any JSON body parsing. */
  rawBody: string;
  /** The `X-WHOOP-Signature-Timestamp` header value, milliseconds since epoch as a string. */
  timestamp: string;
  /** The `X-WHOOP-Signature` header value, base64. */
  signature: string;
  secret: string;
}

/**
 * WHOOP's own documented algorithm: `base64(HMAC-SHA256(timestamp_header + raw_body,
 * client_secret))`. Every failure mode returns `false` rather than throwing -- a webhook
 * endpoint's job is to say yes or no, never to crash on a malformed or hostile request.
 */
export function verifyWhoopWebhookSignature(input: VerifyWhoopWebhookSignatureInput): boolean {
  const timestampMs = Number(input.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_AGE_MS) {
    return false;
  }

  const expected = createHmac("sha256", input.secret)
    .update(input.timestamp + input.rawBody)
    .digest();

  // Buffer.from is lenient about invalid base64 -- like token-cipher.ts's decoder, it drops
  // what it cannot read rather than throwing, so the real validation is the length check
  // below plus the timing-safe comparison, not this call.
  const provided = Buffer.from(input.signature, "base64");

  // timingSafeEqual throws on a length mismatch rather than returning false -- checked
  // explicitly first so a signature of the wrong length is rejected the same way a wrong
  // one is, not with an uncaught exception.
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
