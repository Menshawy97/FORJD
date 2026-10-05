/**
 * The five notification switches on the Notifications screen (Phase 12D,
 * `docs/product/phase-12d-plan.md`). One copy here, so the API's stored row, the contracts and the
 * phone's cache cannot drift apart.
 *
 * A closed `as const` tuple with a display-name map, the same pattern as the other vocabularies:
 * contracts build `z.enum(...)`/object keys from it and the UI never hardcodes a label.
 */
export const NOTIFICATION_PREFERENCE_KEYS = ["workout", "recovery", "pr", "rank", "weekly"] as const;
export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const NOTIFICATION_PREFERENCE_DISPLAY_NAMES: Record<NotificationPreferenceKey, string> = {
  workout: "Workout reminders",
  recovery: "Recovery alerts",
  pr: "PR celebrations",
  rank: "Leaderboard moves",
  weekly: "Weekly summary",
};

/**
 * What a person has before they save anything (`docs/design/slice2-screen-specs.md` §5.4):
 * everything on except Leaderboard moves, which starts off. The server answers with these when no
 * row exists, so a brand-new account and a never-saved one look the same.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = {
  workout: true,
  recovery: true,
  pr: true,
  rank: false,
  weekly: true,
};
