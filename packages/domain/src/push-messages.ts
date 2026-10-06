/**
 * What a push says (Phase 12F, ADR-061, CLAUDE.md rule 15). One builder per kind, pure. A push passes through the push
 * service and Google or Apple and can sit on a lock screen, so its text carries **no health value**: never a weight, heart
 * rate, HRV, sleep, calories, body composition or readiness. A training fact the person published is allowed (an exercise
 * name, a city), and the data payload carries only a kind and an id: the app fetches the details after it opens.
 *
 * The input types have no place for a health value, and each builder reads only the fields it names, so a caller that
 * hands it extra fields cannot make them appear (the tests prove it with a fixture full of health values).
 */
export type PrRecord =
  | { type: "lift"; exerciseName: string }
  | { type: "run"; record: "longest_run" | "fastest_pace" };

export interface PrPushInput {
  /** The session or run that set the record(s), by id. The first record is the headline. */
  sessionId: string;
  records: readonly PrRecord[];
}

export interface RankPushInput {
  direction: "up" | "down";
  cityName: string;
  /** The Saturday that starts the week the snapshot closes (`YYYY-MM-DD`). */
  weekStart: string;
}

export interface PushContent {
  title: string;
  body: string;
  /** Strings only (the push service's data is a JSON object; ADR-061 keeps it to a kind and an id). */
  data: Record<string, string>;
}

const MAX_NAME_LENGTH = 60;
// Characters that have no place in a line of text a person reads and that can garble or spoof a lock screen: control
// characters (C0, DEL, C1), zero-width characters, and the bidirectional overrides and isolates that can reorder a title.
// Explicit ranges, not `\p{Cf}`, so the class means the same on every JavaScript engine the package runs on.
// eslint-disable-next-line no-control-regex
const INVISIBLE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * A name as the person typed it, tidied for a notification line: whitespace of every kind (including a newline or a tab)
 * becomes one space, invisible and control characters are removed, it is trimmed, and a long one is cut by code point (never
 * through the middle of an emoji) and ends with an ellipsis.
 */
const cleanName = (name: string): string => {
  const cleaned = name.replace(/\s+/g, " ").replace(INVISIBLE_OR_CONTROL, "").trim();
  const characters = Array.from(cleaned);
  return characters.length > MAX_NAME_LENGTH ? `${characters.slice(0, MAX_NAME_LENGTH - 1).join("").trimEnd()}…` : cleaned;
};

const RUN_RECORD_TITLE: Record<"longest_run" | "fastest_pace", string> = {
  longest_run: "New PR: your longest run",
  fastest_pace: "New PR: your fastest pace",
};

/** `null` when there is nothing to celebrate. */
export function buildPrPush(input: PrPushInput): PushContent | null {
  const [headline] = input.records;
  if (!headline) return null;

  const data = { type: "pr", sessionId: input.sessionId };
  if (input.records.length > 1) {
    return { title: `${input.records.length} new PRs in that session`, body: "Open FORJD to see them.", data };
  }
  const title =
    headline.type === "lift" ? `New PR on ${cleanName(headline.exerciseName) || "a lift"}` : RUN_RECORD_TITLE[headline.record];
  return { title, body: "Open FORJD to see it.", data };
}

export function buildRankPush(input: RankPushInput): PushContent {
  const city = cleanName(input.cityName) || "your city";
  return {
    title: `You moved ${input.direction === "up" ? "up" : "down"} in ${city}`,
    body: "See the leaderboard.",
    data: { type: "rank", weekStart: input.weekStart },
  };
}
