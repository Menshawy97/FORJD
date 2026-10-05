# ADR-061: What a notification may say

**Status:** Accepted (2026-10-03, by the owner).
**Date:** 2026-10-03
**Plan:** roadmap Phase 12, decision 3 (slices 12B, 12E-12G); drafted under G7 of
[engineering-gaps-plan.md](../product/engineering-gaps-plan.md).
**Related:** [ADR-043](ADR-043-health-data-consent.md) (health-data consent),
[ADR-060](ADR-060-push-notification-transport.md) (transport). CLAUDE.md rule 15.

## Context

Notifications come in two kinds that travel differently:

- **Push** (12F, 12G) is composed on the server and passes through Google's or Apple's servers, and
  possibly Expo's (ADR-060), before it reaches the phone. Its text can sit on a lock screen.
- **Local** (12B's ongoing session or run notification, 12E's reminders and weekly summary) is
  composed on the phone and never leaves it.

Rule 15 says health data never reaches an analytics or advertising SDK. A push service is neither,
but it is a third party, and a lock screen is visible to anyone near the phone. The rule's intent
covers both.

## Decision

1. **Push text carries no health value, ever.** No weight, heart rate, HRV, sleep, calories, body
   composition or readiness score, in the title, the body or the data payload. "Your recovery changed:
   open FORJD", never "HRV fell 22%". Data payloads carry only ids and a type, and the app fetches the
   details after it opens.
2. **Training facts that the person published are allowed in push**: a leaderboard rank or a PR
   exercise name ("New PR on Back Squat"). Weights lifted count as training, not health data (they are
   already on the public profile when the person allows it). Confirmed by the owner (2026-10-03).
3. **Local notifications may show values**, because they never leave the phone (the run's time,
   distance and pace; a session's next set and rest countdown). The 12H widget setting "Hide health
   values from the home screen" also applies to the ongoing notifications' lock-screen view
   (`VISIBILITY_PRIVATE` on Android).
4. **Any notification based on health data** (12G recovery alerts) is sent only with health-data
   consent (ADR-043), read live when the notification is built, as the API already does for ingest.
5. **Enforced in code, not only stated:** push messages are built by one function per kind, each with
   a unit test asserting that a fixture full of health values produces text containing none of them.
   This mirrors the Sentry allowlist (G1).

## Consequences

- 12F and 12G each ship with those tests; a review checks that no new push kind skips them.
- The FAQ and the privacy policy say what notifications contain.
