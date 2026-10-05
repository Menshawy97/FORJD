import { z } from 'zod';

import { NOTIFICATION_PREFERENCE_KEYS } from '@forjd/domain';

// Notification switches (Phase 12D, docs/product/phase-12d-plan.md). @forjd/domain's tuple is the
// source of truth for which switches exist.

const switches = Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((key) => [key, z.boolean()])) as Record<
  (typeof NOTIFICATION_PREFERENCE_KEYS)[number],
  z.ZodBoolean
>;

/**
 * `PATCH /api/v1/users/me/notifications`. Any subset of the switches, so a phone sends only the one
 * that changed and two phones changing different switches do not undo each other. An empty body is a
 * client bug and an unknown key is refused rather than silently dropped.
 */
export const updateNotificationPreferencesRequestSchema = z
  .object(switches)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one switch to change' });
export type UpdateNotificationPreferencesRequest = z.infer<typeof updateNotificationPreferencesRequestSchema>;

/**
 * `GET` and `PATCH /api/v1/users/me/notifications`. `updatedAt` is `null` when the person has never
 * saved a change, in which case the switches are the defaults.
 */
export const notificationPreferencesResponseSchema = z.object({
  ...switches,
  updatedAt: z.string().datetime().nullable(),
});
export type NotificationPreferencesResponse = z.infer<typeof notificationPreferencesResponseSchema>;
