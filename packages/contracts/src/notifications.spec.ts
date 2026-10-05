import { responseFixtures } from "./fixtures";
import { notificationPreferencesResponseSchema, updateNotificationPreferencesRequestSchema } from "./notifications";

describe("updateNotificationPreferencesRequestSchema (Phase 12D)", () => {
  it("accepts any single switch, so two phones changing different switches do not undo each other", () => {
    expect(updateNotificationPreferencesRequestSchema.safeParse({ rank: true }).success).toBe(true);
    expect(updateNotificationPreferencesRequestSchema.safeParse({ weekly: false }).success).toBe(true);
  });

  it("accepts all five at once", () => {
    const all = { workout: true, recovery: false, pr: true, rank: false, weekly: true };
    expect(updateNotificationPreferencesRequestSchema.parse(all)).toEqual(all);
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
  const base = { workout: true, recovery: true, pr: true, rank: false, weekly: true };

  it("accepts a saved row with its timestamp", () => {
    expect(notificationPreferencesResponseSchema.safeParse({ ...base, updatedAt: "2026-10-05T12:00:00.000Z" }).success).toBe(true);
  });

  it("accepts the never-saved answer: defaults with a null timestamp", () => {
    expect(notificationPreferencesResponseSchema.safeParse({ ...base, updatedAt: null }).success).toBe(true);
  });

  it("requires every switch", () => {
    const missingRank = { workout: true, recovery: true, pr: true, weekly: true, updatedAt: null };
    expect(notificationPreferencesResponseSchema.safeParse(missingRank).success).toBe(false);
  });

  it("has a pinned fixture that validates", () => {
    const fixture = responseFixtures["notification-preferences-response"];
    expect(fixture.schema.safeParse(fixture.sample).success).toBe(true);
  });
});
