import { z } from 'zod';

// Device push tokens (Phase 12F, docs/product/phase-12f-plan.md). The phone registers its token once it has
// permission and removes it before sign-out. The contract is provider-agnostic: ADR-060 picks the Expo push service
// first and keeps FCM direct as a fallback behind the same interface, so it checks the shape of a token, not Expo's
// format.

/** The platforms a token can come from. iPhone push waits for Phase 11 (ADR-007). */
export const PUSH_PLATFORMS = ['android', 'ios'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Printable ASCII with no whitespace: every real token is, and nothing else belongs in a stored identifier. */
export const pushTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\x21-\x7e]+$/, { message: 'A push token has no spaces or control characters' });

/** `POST /api/v1/users/me/push-tokens`. Idempotent; answers 204. The user is the caller, never a field. */
export const registerPushTokenRequestSchema = z
  .object({ token: pushTokenSchema, platform: z.enum(PUSH_PLATFORMS) })
  .strict();
export type RegisterPushTokenRequest = z.infer<typeof registerPushTokenRequestSchema>;

/** `DELETE /api/v1/users/me/push-tokens`. Answers 204 whether or not the token was stored. */
export const removePushTokenRequestSchema = z.object({ token: pushTokenSchema }).strict();
export type RemovePushTokenRequest = z.infer<typeof removePushTokenRequestSchema>;
