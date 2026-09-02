import { WorkoutTemplateCursor } from "./workouts.repository";

/**
 * Encodes and decodes the opaque `nextCursor` of the templates list envelope. Same shape and
 * reasoning as `exercises/exercise-cursor.ts`: opaque (not secret, since the cursor names a
 * position in a list the caller may already read in full) and base64url (not base64, whose
 * `+` a query string would decode back as a space).
 */

/** Matches any RFC 4122 version -- the same pattern `exercise-cursor.ts` uses. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeWorkoutTemplateCursor(cursor: WorkoutTemplateCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Returns `null` for anything this module did not produce; the caller turns that into a 400. */
export function decodeWorkoutTemplateCursor(raw: string): WorkoutTemplateCursor | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { name, id } = parsed as Partial<WorkoutTemplateCursor>;

  if (typeof name !== "string" || typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return null;
  }

  return { name, id };
}
