import { z } from 'zod';

// The notifications list behind the Home bell (emulator walk finding 17, replica approved 2026-10-14;
// docs/product/notifications-list-and-profile-counts-plan.md slice B). The server's own pushes to the caller from the
// last 30 days, newest first: the same title and body the push showed, and its data (a kind and an id, ADR-061), so a
// tap opens what tapping the push would. Local reminders are not listed (owner decision). No read state.

/** The kinds the server sends; kept in step with the `push_outbox_kind` check. */
export const NOTIFICATION_KINDS = ['pr', 'rank'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.string()),
  sentAt: z.string().datetime(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** `GET /api/v1/users/me/notifications/feed`. The user is the caller, never a parameter. */
export const notificationListResponseSchema = z.object({
  items: z.array(notificationItemSchema),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
