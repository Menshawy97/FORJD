import { notificationListResponseSchema } from "./notifications-feed";

// Emulator walk finding 17 (docs/product/notifications-list-and-profile-counts-plan.md, slice B): the Home bell opens
// a list of the server's own pushes from the last 30 days. `GET /api/v1/users/me/notifications`.
const ITEM = {
  id: "5b0e6f4e-8f7a-4d7e-9c1a-2f4b8f6c1d2e",
  kind: "pr",
  title: "New PR on Bench Press",
  body: "Open FORJD to see it.",
  data: { type: "pr", sessionId: "0c6f2c8e-1b1a-4c55-9d7e-3a9f8d2b7c11" },
  sentAt: "2026-10-14T08:00:00.000Z",
};

describe("notificationListResponseSchema", () => {
  it("accepts a list of sent pushes, PR and rank", () => {
    const rank = { ...ITEM, kind: "rank", title: "You moved up in Cairo", body: "See the leaderboard.", data: { type: "rank", weekStart: "2026-10-10" } };
    expect(notificationListResponseSchema.parse({ items: [ITEM, rank] }).items).toHaveLength(2);
    expect(notificationListResponseSchema.parse({ items: [] }).items).toEqual([]);
  });

  it("refuses a kind the server does not send, and data that is not all strings", () => {
    expect(notificationListResponseSchema.safeParse({ items: [{ ...ITEM, kind: "reminder" }] }).success).toBe(false);
    expect(notificationListResponseSchema.safeParse({ items: [{ ...ITEM, data: { sessionId: 7 } }] }).success).toBe(false);
  });

  it("refuses an item without a sent time", () => {
    const { sentAt: _sentAt, ...unsent } = ITEM;
    expect(notificationListResponseSchema.safeParse({ items: [unsent] }).success).toBe(false);
  });
});
