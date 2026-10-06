# ADR-060: How push notifications reach the phone

**Status:** Accepted (2026-10-03, by the owner). Built in slice 12F.
**Date:** 2026-10-03
**Plan:** roadmap Phase 12, decision 2 and slice 12F; drafted under G7 of
[engineering-gaps-plan.md](../product/engineering-gaps-plan.md). What a push may *say* is
[ADR-061](ADR-061-what-a-notification-may-say.md).

## Context

12F sends server-side notifications: a leaderboard move after the Monday snapshot, a PR celebration
when a session uploads. The app already has `expo-notifications` 57 behind an injected seam for local
notifications (ADR-026). A push needs a transport from the NestJS API to the phone. Constraints:

- **Free tiers only** (the project's standing constraint): no paid push vendor.
- **Rule 5:** FCM and APNs credentials live on the server, never in the app.
- **Rules 3-4:** the API reaches the transport through an interface, in `apps/api/src/integrations/push/`.
- **Rule 8:** the adapter has contract tests.

## Options

| | Expo push service (`expo-server-sdk` 7.x) | FCM HTTP v1 direct (`firebase-admin` 14.x), APNs later |
|---|---|---|
| Cost | Free | Free |
| Phone side | `getExpoPushTokenAsync`, one token type on both platforms | `getDevicePushTokenAsync`, FCM token on Android, APNs token on iOS |
| Server side | One HTTP API for both platforms; receipts to poll | FCM for Android now; APNs needs its own client and the Apple Developer account |
| Who sees the payload | Expo's servers, then Google or Apple | Google or Apple only |
| Credentials | FCM key and APNs key uploaded to the Expo account (EAS) | FCM service account and APNs key in Google Secret Manager |
| iOS without a Mac (ADR-007) | Works through EAS credentials | Works, with more setup |

## Decision

1. **A `NotificationProvider` interface** in `apps/api/src/integrations/push/` (`send(tokens, message)`,
   plus `invalidTokens()` for tokens the platform rejects). It has a fake for tests and contract tests
   for the real adapter (rule 8). No business code imports a push SDK; the conformance check gains
   that rule.
2. **Recommended first adapter: the Expo push service.** One API covers both platforms, it is free,
   and the payload carries no health values anyway (ADR-061), so the extra hop through Expo carries
   only generic text. Because the provider is an interface, switching to FCM direct later is an
   adapter, not a rewrite.
3. **Device tokens** go in a `device_push_tokens` table (user, token, platform, timestamps). They are
   deleted on sign-out and on account deletion, included in the data export, and listed in
   `data-inventory.md`. Registration is a versioned `POST /api/v1/users/me/push-tokens` (rule 7).
4. **Permission is asked at the moment it is first useful**, never at launch. A refusal leaves the app
   working as it does today.

## Owner's answer (2026-10-03)

Routing generic notification text through Expo's servers is acceptable, so the first adapter is the
Expo push service. FCM direct stays the fallback behind the same interface.

## Built (2026-10-06, slice 12F-2)

The Expo adapter is a thin `fetch` client over Expo's two HTTP endpoints, not `expo-server-sdk`: the repo's convention for external services (Turnstile, WHOOP) is an injected `fetch` and a Zod-checked reply, there is no dependency to keep current, and the API is small. The interface is `send` and `receipts` (receipts are read about 15 minutes later, and a token the service reports dead is deleted). The optional `EXPO_ACCESS_TOKEN` stays out of the deploy workflow until "enhanced push security" is switched on. A push token is treated as a bearer-ish secret: never logged, never returned by any endpoint. **Delivery is at-least-once.** Expo send is not idempotent, so the adapter retries only a 5xx or a failed connection and never a timeout or an unreadable reply (the first attempt may have been accepted); the sender (slice 3) dedupes by key before it sends, and a rare duplicate push is accepted over a lost one. A token that is not shaped like an Expo token is refused as one bad message instead of sent, because Expo refuses a whole batch for one malformed token. A big batch stops after three unreachable chunks in a row.

## Consequences

- The privacy policy names the push processor(s); the Play Data safety form lists the device push token.
- 12F's exit check: a payload captured in a test contains no health value (ADR-061).
