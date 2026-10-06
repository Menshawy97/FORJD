import { responseFixtures } from "./fixtures";
import { notificationPreferencesResponseSchema, updateNotificationPreferencesRequestSchema } from "./notifications";

describe("updateNotificationPreferencesRequestSchema (Phase 12D)", () => {
  it("accepts any single switch, so two phones changing different switches do not undo each other", () => {
    expect(updateNotificationPreferencesRequestSchema.safeParse({ rank: true }).success).toBe(true);
    expect(updateNotificationPreferencesRequestSchema.safeParse({ weekly: false }).success).toBe(true);
  });

  it("accepts the 12E reminder switches the same way", () => {
    for (const key of ["meals", "noWorkout", "forgeClosing", "weighIn"]) {
      expect(updateNotificationPreferencesRequestSchema.safeParse({ [key]: true }).success).toBe(true);
    }
  });

  it("accepts every switch at once", () => {
    const all = {
      workout: true,
      recovery: false,
      pr: true,
      rank: false,
      weekly: true,
      meals: true,
      noWorkout: false,
      forgeClosing: true,
      weighIn: false,
    };
    expect(updateNotificationPreferencesRequestSchema.parse(all)).toEqual(all);
  });

  it("accepts quiet hours alone, or together with switches", () => {
    const quietHours = { startMinute: 23 * 60, endMinute: 6 * 60 };
    expect(updateNotificationPreferencesRequestSchema.parse({ quietHours })).toEqual({ quietHours });
    expect(updateNotificationPreferencesRequestSchema.parse({ rank: true, quietHours })).toEqual({ rank: true, quietHours });
  });

  it("refuses quiet hours with equal times, a time off the clock, a fraction or a missing half", () => {
    const bad = [
      { startMinute: 600, endMinute: 600 },
      { startMinute: -1, endMinute: 420 },
      { startMinute: 1320, endMinute: 1440 },
      { startMinute: 1320.5, endMinute: 420 },
      { startMinute: 1320 },
      { endMinute: 420 },
      { startMinute: "22:00", endMinute: "07:00" },
      { startMinute: 1320, endMinute: 420, extra: 1 },
    ];
    for (const quietHours of bad) {
      expect(updateNotificationPreferencesRequestSchema.safeParse({ quietHours }).success).toBe(false);
    }
  });

  it("refuses an empty body, because a PATCH that changes nothing is a client bug", () => {
    expect(updateNotificationPreferencesRequestSchema.safeParse({}).success).toBe(false);
  });

  it("refuses an unknown key rather than silently dropping it", () => {
    expect(updateNotificationPreferencesRequestSchema.safeParse({ rank: true, quietHours: "22:00" }).success).toBe(false);
  });

  it("refuses a value that is not a boolean", () => {
    expect(updateNotificationPreferencesRequestSchema.safeParse({ rank: "yes" }).success).toBe(false);
    expect(updateNotificationPreferencesRequestSchema.safeParse({ rank: null }).success).toBe(false);
  });
});

describe("notificationPreferencesResponseSchema (Phase 12D)", () => {
  const base = {
    workout: true,
    recovery: true,
    pr: true,
    rank: false,
    weekly: true,
    meals: false,
    noWorkout: false,
    forgeClosing: false,
    weighIn: false,
    quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 },
  };

  it("requires the quiet hours, as two different valid times", () => {
    const without: Partial<typeof base> = { ...base };
    delete without.quietHours;
    expect(notificationPreferencesResponseSchema.safeParse({ ...without, updatedAt: null }).success).toBe(false);
    expect(
      notificationPreferencesResponseSchema.safeParse({ ...base, quietHours: { startMinute: 5, endMinute: 5 }, updatedAt: null }).success,
    ).toBe(false);
  });

  it("accepts a saved row with its timestamp", () => {
    expect(notificationPreferencesResponseSchema.safeParse({ ...base, updatedAt: "2026-10-05T12:00:00.000Z" }).success).toBe(true);
  });

  it("accepts the never-saved answer: defaults with a null timestamp", () => {
    expect(notificationPreferencesResponseSchema.safeParse({ ...base, updatedAt: null }).success).toBe(true);
  });

  it("requires every switch", () => {
    const missingRank = { ...base, updatedAt: null } as Partial<typeof base> & { updatedAt: null };
    delete missingRank.rank;
    expect(notificationPreferencesResponseSchema.safeParse(missingRank).success).toBe(false);
    const missingMeals = { ...base, updatedAt: null } as Partial<typeof base> & { updatedAt: null };
    delete missingMeals.meals;
    expect(notificationPreferencesResponseSchema.safeParse(missingMeals).success).toBe(false);
  });

  it("has a pinned fixture that validates", () => {
    const fixture = responseFixtures["notification-preferences-response"];
    expect(fixture.schema.safeParse(fixture.sample).success).toBe(true);
  });
});
