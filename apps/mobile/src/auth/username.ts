/**
 * ADR-019's own sanitizer, verbatim: `toLowerCase().replace(/[^a-z0-9_]/g,'')`. Shared between
 * `pick-username.tsx` and `edit-profile.tsx` — both screens accept a username through the same
 * `/^[a-z0-9_]{3,20}$/` field, so the client-side sanitizing has to be one function, not two
 * copies that could drift.
 *
 * This is a convenience, not a constraint: `usernameSchema` in `@forjd/contracts` re-checks the
 * full pattern server-side regardless of what a sanitizing input already did.
 */
export function sanitizeUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
}
