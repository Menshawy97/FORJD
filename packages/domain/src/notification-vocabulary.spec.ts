import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  NOTIFICATION_PREFERENCE_DISPLAY_NAMES,
} from "./notification-vocabulary";

describe("notification vocabulary (Phase 12D)", () => {
  it("names the five switches the Notifications screen shows, in screen order", () => {
    expect([...NOTIFICATION_PREFERENCE_KEYS]).toEqual(["workout", "recovery", "pr", "rank", "weekly"]);
  });

  it("has a default boolean for every key and no extra keys", () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual([...NOTIFICATION_PREFERENCE_KEYS].sort());
    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
      expect(typeof DEFAULT_NOTIFICATION_PREFERENCES[key]).toBe("boolean");
    }
  });

  it("starts every switch on except Leaderboard moves (slice2-screen-specs.md §5.4)", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      workout: true,
      recovery: true,
      pr: true,
      rank: false,
      weekly: true,
    });
  });

  it("has a display name for every key", () => {
    expect(Object.keys(NOTIFICATION_PREFERENCE_DISPLAY_NAMES).sort()).toEqual([...NOTIFICATION_PREFERENCE_KEYS].sort());
  });
});
