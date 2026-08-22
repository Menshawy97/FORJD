# ADR-007: No-Mac iOS toolchain, and Android-first sequencing

**Status:** Accepted
**Date:** 2026-08

## Context

Development happens on Windows. Apple Health / HealthKit / Xcode / TestFlight
are macOS-gated, and the decision was made not to buy or rent Apple hardware
(a Mac Mini, or pay-as-you-go cloud Mac services) at any point in this project.
A physical iPhone and a physical Android 14+ device are both available.

This rules out the workflow implied by the source planning docs (Apple Health
before Health Connect, native Swift/Kotlin bridges written directly). A
replacement strategy is required that keeps iOS shippable without ever
touching Mac hardware, owned or rented.

## Decision

1. **Health Connect ships before Apple Health.** Android is the platform
   developed and tested natively throughout Phases 0-9; the limited beta
   launches on Google Play. iOS is a dedicated track (Phase 11) that runs in
   parallel with Phase 10 (leaderboards/subscriptions), not earlier.

2. **The `health` package (pub.dev, carp-dk) implements `HealthProvider` for
   both platforms**, wrapping HealthKit and Health Connect behind one Dart
   API. This shrinks the native bridge surface to near zero on both
   platforms — not an iOS-only workaround. If it cannot express something
   needed (e.g. WorkoutKit zone configuration), a targeted native bridge is
   written for just that gap, behind the unchanged `HealthProvider`
   interface (`CLAUDE.md` rules 3, 17).

3. **iOS config surface (`Info.plist`, entitlements, privacy manifest) is
   edited as plain text on Windows.** These files don't require Xcode to
   edit correctly, only to be aware of their schema.

4. **~~Codemagic~~ EAS Build builds and signs with no Mac in the loop** (amended
   by ADR-013 — mobile client is now Expo React Native, not Flutter; Codemagic
   was Flutter-specific tooling). EAS Build's managed credentials flow is the
   RN-ecosystem equivalent: an Apple Developer API key entered once in a
   browser lets EAS fetch/create certificates and provisioning profiles, build
   on its own macOS runners, and submit to TestFlight via `eas submit` — same
   no-Mac shape Codemagic provided, different vendor. **This step is now needed
   less often than ADR-007 originally assumed**: Expo Go requires no build at
   all for pure-JS/TS changes (no signing, no cloud runner, no Xcode) — EAS
   Build is only invoked once a screen needs a native module outside Expo Go's
   managed sandbox. See ADR-013 for the full reasoning.

5. **The physical iPhone, via TestFlight, is the HealthKit test
   environment** — not the iOS Simulator (which is Mac-only software
   anyway, and whose HealthKit data is synthetic: it can't even write
   characteristic data like date of birth). Real Apple Health history, real
   permission dialogs, real sensors. `CLAUDE.md` rule 16: no HealthKit code
   merges until it has run there.

## Spike C — validates this ADR

A timeboxed (4 hour, $0) spike in Phase 0/1: get a Flutter hello-world from
this Windows machine onto the physical iPhone via Codemagic → TestFlight,
touching no Mac. This is gated on Apple Developer *organization* account
approval (typically 2-4 weeks), so it is tracked as an early checkpoint
rather than a Phase 0 blocker — everything else in Phase 0 proceeds
regardless of when it lands. Record the measured round-trip time for one
iOS change here once run; that number is what Phase 11 batches its work
against.

**Spike C result:** _TBD — pending Apple Developer organization approval._

## Consequences

- iOS iteration speed is a CI build (~5-15 min) plus a TestFlight install,
  not a hot reload. iOS-specific changes are batched into meaningful chunks
  rather than tested one file edit at a time.
- The cost of the entire iOS strategy is $0 beyond the $99/yr Apple
  Developer Program fee — no hardware purchase, no cloud-Mac rental line
  item.
- If the `health` package ever requires more native Swift than a small,
  contained bridge, this ADR's premise should be revisited — that would be
  the signal that the no-Mac strategy has hit its actual limit, not a
  reason to quietly write more native code around it.
