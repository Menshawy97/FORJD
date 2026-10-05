import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  NOTIFICATION_PREFERENCE_DISPLAY_NAMES,
} from "./notification-vocabulary";

describe("notification vocabulary (Phase 12D, 12E)", () => {
  it("names the switches the Notifications screen shows, in screen order, with the 12E reminders after the original five", () => {
    expect([...NOTIFICATION_PREFERENCE_KEYS]).toEqual([
      "workout",
      "recovery",
      "pr",
      "rank",
      "weekly",
      "meals",
      "noWorkout",
      "forgeClosing",
      "weighIn",
    ]);
  });

  it("has a default boolean for every key and no extra keys", () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual([...NOTIFICATION_PREFERENCE_KEYS].sort());
    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
      expect(typeof DEFAULT_NOTIFICATION_PREFERENCES[key]).toBe("boolean");
    }
  });

  it("starts every original switch on except Leaderboard moves (slice2-screen-specs.md §5.4), and every 12E reminder off", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      workout: true,
      recovery: true,
      pr: true,
      rank: false,
      weekly: true,
      meals: false,
      noWorkout: false,
      forgeClosing: false,
      weighIn: false,
    });
  });

  it("has a display name for every key", () => {
    expect(Object.keys(NOTIFICATION_PREFERENCE_DISPLAY_NAMES).sort()).toEqual([...NOTIFICATION_PREFERENCE_KEYS].sort());
  });
});
