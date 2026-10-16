# ADR-069: Exception to rule 16 for Apple Health, merged switched off

**Status:** Accepted
**Date:** 2026-10-17
**Scope:** `AppleHealthProvider` and its library setup (slice 5 of
[ios-no-account-plan.md](../product/ios-no-account-plan.md)), merged **switched off**. It does not change
CLAUDE.md rule 16 for turning Apple Health on, or for any other Health Connect or HealthKit code, the
same way ADR-035 and ADR-067 did not.

## Context

CLAUDE.md rule 16: HealthKit code does not merge until it has run on a physical device (an iPhone
through TestFlight, ADR-007). There is no Apple Developer account yet, so there is no TestFlight and no
signed build, and the earliest an iPhone run can happen is after the account exists. ADR-068 chose the
library, `@kingstinct/react-native-healthkit`. On 2026-10-16 the owner chose to merge the provider into
`main` **switched off**, rather than keep it on a long-lived branch, so it stays current with the code
around it.

## Decision

Merge `AppleHealthProvider`, its tests and the library behind one build flag,
`APPLE_HEALTH_ENABLED` (read in `app.config.ts`, the same pattern as `APPLE_SIGN_IN_ENABLED`), which is
**off** in every `eas.json` profile. With the flag off:

1. **No iPhone code path reaches HealthKit.** `getDeviceHealthProvider()` returns `null` on iOS, as it
   does today, so no screen can call `connect()`, `requestPermissions()` or `sync()`.
2. **The iPhone build holds and declares no HealthKit.** The library's config plugin, which adds the
   HealthKit entitlement and the permission text, is listed only when the flag is on, and the library
   and its Nitro peer are autolinked into iOS only then (`apps/mobile/react-native.config.js`), so a
   switched-off binary has no HealthKit code for App Store checks to find undeclared. Apple can reject an app
   that declares HealthKit without using it visibly (guideline 2.5.1), and the App Store privacy labels
   would otherwise have to describe a feature that is off.
3. **Android is unchanged.** HealthKit is Swift only, and the native code of its peer,
   `react-native-nitro-modules`, is excluded from Android autolinking, so the Android app links the same
   native modules as before. `config/__tests__/apple-health-config.test.ts` and the Android manifest test
   prove both.

Switching the flag on is **not** covered by this exception. It needs the rule 16 run: a TestFlight build
on a physical iPhone that reads heart rate and active energy during a run, refuses each one alone, and
keeps whichever was granted (ADR-068, check 3), then the owner's go-ahead, a note in this ADR, and the
App Store privacy labels' Health row confirmed.

## Rationale

Rule 16 guards against health platforms behaving differently on real devices. While the flag is off,
none of that behaviour can happen: nothing reads HealthKit and the shipped app does not ask for it.
What merges is code that is unit tested (contract tests with a mocked native module) and was compiled
for iPhone by the EAS simulator build 3ceba342 (2026-10-17, library linked; ADR-068 check 2). Switched
off, later builds no longer compile it; the first switched-on TestFlight build does again. What stays owed is exactly what rule 16 asks for,
before anyone can use it.

## Consequences

- The provider can drift from HealthKit's real behaviour until the iPhone run; the contract tests and
  the "only read what was asked for" test (ADR-068, check 4) limit how far.
- Two mapping differences from Health Connect, documented in `apple-health-sample-mapping.ts`: HRV is
  SDNN (Health Connect: RMSSD), and `sleep_duration` is time asleep per segment (Health Connect: the whole
  session). Each reading keeps its source (rule 10), so readiness baselines must not mix sources.
- HealthKit hides read refusals, so `requestPermissions` reports every supported metric as granted once
  the sheet has been shown; a refusal shows up as no data. "Already asked" comes from HealthKit's own
  record (`getRequestStatusForAuthorization`), not the provider instance, because the run screen asks
  only on the first run and builds a new provider each run. The iPhone walk checks a first and a second
  run.
- Overlapping sleep from several sources (watch, phone, other apps) arrives as separate segments; each
  keeps its source, and the read side must pick one source per night before readiness uses sleep
  (rule 10's read-time source priority). Owed before switch-on.
- A full sync (`since: null`) reads all history at once; the run flow always passes `since`. Read in
  chunks before any backfill uses it.
- The permission text in `app.config.ts` was approved by the owner on 2026-10-17, as written.
- The library is installed for both platforms; on Android only its JavaScript is bundled, unused.
- Owed before the flag is turned on: the iPhone walk above, tracked in
  [remaining-checklist.md](../product/remaining-checklist.md).
