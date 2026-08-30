import { ExerciseCursor } from "./exercises.repository";

/**
 * Encodes and decodes the opaque `nextCursor` of the list envelope.
 *
 * **Opaque, not secret.** The cursor names a position in a list the caller may already read
 * in full, so there is nothing to protect and no signature: forging one can only produce a
 * page of exercises the same caller could have reached by paging or by searching. What it
 * must do is come back exactly as it left -- and refuse anything else, because both halves
 * feed a SQL comparison and the id half feeds a `::uuid` cast.
 *
 * **base64url, not base64.** A plain-base64 cursor can contain `+`, which a query string
 * decodes back as a space; the cursor then fails to decode for some exercise names and not
 * others, which is the worst kind of bug to be handed. base64url has no such character and
 * needs no escaping, so the encoded value survives a URL untouched.
 */

/** Matches any RFC 4122 version -- the same pattern AthletesService uses, and for the same reason. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeExerciseCursor(cursor: ExerciseCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Returns `null` for anything this module did not produce. The caller turns that into a 400;
 * it is deliberately not thrown here, so the decision about *which* HTTP status a bad cursor
 * deserves stays in the service with the rest of the policy.
 */
export function decodeExerciseCursor(raw: string): ExerciseCursor | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    // Buffer.from is lenient about invalid base64 -- it drops what it cannot read rather than
    // throwing -- so the real gate is whether the result parses as JSON, not whether the
    // decode "succeeded".
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { name, id } = parsed as Partial<ExerciseCursor>;

  if (typeof name !== "string" || typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return null;
  }

  // Rebuilt field by field rather than returned as-is, so a cursor carrying extra keys cannot
  // smuggle anything into the filter object the repository receives.
  return { name, id };
}
