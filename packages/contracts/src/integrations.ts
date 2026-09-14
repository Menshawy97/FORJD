import { z } from 'zod';

/**
 * `GET /integrations/whoop/status` (Phase 7G) -- the mobile Connect screen's only way to know
 * whether WHOOP is currently connected. Deliberately separate from `HealthConnectionResponse`
 * above: that shape describes `health_connections` (on-device providers), while WHOOP's
 * connection state lives in `external_connections` (Phase 7B) -- two different tables the
 * plan kept separate on purpose (a Health Connect/Apple Health row has no OAuth tokens to
 * hold). `lastSyncAt` is `null` until the first successful sync completes, same convention
 * as `HealthConnectionResponse.lastSuccessfulSyncAt`.
 */
export const whoopStatusResponseSchema = z.object({
  connected: z.boolean(),
  lastSyncAt: z.string().datetime().nullable(),
});
export type WhoopStatusResponse = z.infer<typeof whoopStatusResponseSchema>;

/** `POST /integrations/whoop/authorize` -- the URL the mobile app opens in an in-app browser
 *  (`expo-web-browser`'s `openAuthSessionAsync`) to start the WHOOP OAuth consent flow. */
export const whoopAuthorizeResponseSchema = z.object({
  authorizeUrl: z.string().url(),
});
export type WhoopAuthorizeResponse = z.infer<typeof whoopAuthorizeResponseSchema>;
