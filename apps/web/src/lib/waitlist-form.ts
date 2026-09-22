/**
 * The pure, testable half of the waitlist form's client behaviour (W4). The other half --
 * loading Cloudflare's Turnstile widget, wiring the `submit` event, calling `fetch` -- lives
 * in the `<script>` inside WaitlistForm.astro and is not meaningfully unit-testable, the
 * same split reveal.ts/boot-motion.ts already uses on this site.
 */

/**
 * Trims and lower-cases the address, matching `waitlistSignupRequestSchema`
 * (`packages/contracts/src/waitlist.ts`) exactly, so what the reader sees echoed back after
 * a successful sign-up is the same string the server actually stored.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A deliberately loose pattern: one `@`, no whitespace, at least one `.` after it. This is
 * not the validator -- `waitlistSignupRequestSchema` on the server is -- it only exists to
 * skip a pointless network round trip (and a wasted slot in the endpoint's 5-per-10-minute
 * budget) for an empty or obviously malformed field.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export type WaitlistOutcome =
  | { kind: 'accepted'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'error'; message: string };

/**
 * Maps the endpoint's response status to what the reader sees. A new address and a repeat
 * both answer 202, so "accepted" already covers both without this function needing to know
 * which happened -- the server keeps that distinction to itself on purpose.
 *
 * The 400 message deliberately does not say "email" or "robot": that status covers both a
 * malformed address and a failed Turnstile check, and naming either would let a caller probe
 * which one triggered it. A generic "check it and try again" invites both fixes.
 */
export function messageForStatus(status: number): WaitlistOutcome {
  if (status === 202) {
    return { kind: 'accepted', message: "You're on the list. One email on launch day, nothing before it." };
  }
  if (status === 400) {
    return { kind: 'rejected', message: "That didn't go through. Check the address and try again." };
  }
  if (status === 429) {
    return { kind: 'rate-limited', message: 'Too many attempts from here. Try again in a few minutes.' };
  }
  return { kind: 'error', message: 'Something went wrong on our end. Try again in a moment.' };
}
