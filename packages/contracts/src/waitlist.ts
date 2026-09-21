import { z } from 'zod';

/**
 * Contract for `POST /api/v1/waitlist`, the sign-up behind the getforjd.com form (ADR-051).
 *
 * The endpoint is public, so everything here is about being strict at the boundary: the
 * address is normalised before it can reach storage, and the Turnstile token is bounded so
 * an oversized body is rejected before any network call is made to verify it.
 */

/** SMTP's limit on a whole address (RFC 5321 section 4.5.3.1.3). */
const MAX_EMAIL_LENGTH = 254;

/** Cloudflare documents a 2048-character ceiling on a Turnstile response token. */
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

/**
 * `email` is trimmed and lower-cased here rather than in the service, so the unique index
 * on the stored value means what it says: two casings of one address are one sign-up. The
 * order matters -- trimming first means a padded-out address is judged on what it is, not
 * on the whitespace around it.
 */
export const waitlistSignupRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(MAX_EMAIL_LENGTH),
  turnstileToken: z.string().min(1).max(MAX_TURNSTILE_TOKEN_LENGTH),
});
export type WaitlistSignupRequest = z.infer<typeof waitlistSignupRequestSchema>;

/**
 * The only status is `accepted`, on purpose. A new address and one already on the list get
 * the identical answer, so the endpoint cannot be used to find out who has signed up.
 */
export const waitlistSignupResponseSchema = z.object({
  status: z.literal('accepted'),
});
export type WaitlistSignupResponse = z.infer<typeof waitlistSignupResponseSchema>;
