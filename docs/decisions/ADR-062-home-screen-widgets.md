# ADR-062: Home-screen widgets on Android and iPhone

**Status:** Proposed (2026-10-03), awaiting the owner's decision. Nothing is built on it yet.
**Date:** 2026-10-03
**Plan:** roadmap Phase 12, decision 4 and slices 12H (Android) and 12I (iPhone); drafted under G7 of
[engineering-gaps-plan.md](../product/engineering-gaps-plan.md).
**Related:** [ADR-007](ADR-007-no-mac-ios-toolchain.md) (no Mac), [ADR-027](ADR-027-expo-sdk-57-upgrade.md)
(SDK 57 pin), [ADR-061](ADR-061-what-a-notification-may-say.md) (health values off the home screen).

## Context

The owner wants home-screen widgets on both platforms (2026-09-25): today's workout or program day,
readiness, calories and macros left, and city rank. The roadmap had assumed an iPhone widget meant
hand-written SwiftUI, the case CLAUDE.md's platform note allows only when no library can do the job.
Checked on 2026-10-03:

- **`expo-widgets` 57.0.22** (Expo's own module, versioned with SDK 57) is **iOS only**. Widgets are
  written in JSX with `@expo/ui/swift-ui` components and run in an isolated runtime. A config plugin
  adds the widget extension and needs an App Group (`groupIdentifier`) for app-to-widget data. It also
  covers Live Activities. Not in Expo Go; it needs a development or EAS build. Its documentation gives
  no stability label, so treat it as new.
- **`react-native-android-widget` 0.22.1** (peer `expo >= 54`) draws Android widgets from JSX through a
  config plugin.
- `@bacons/apple-targets` 5.0.0 adds an extension target from hand-written Swift; it is no longer
  needed if `expo-widgets` holds up.

## Decision (proposed)

1. **One shared model:** a pure, unit-tested function builds each widget's content from a local
   snapshot the app writes (today's plan, readiness, nutrition left, rank). Widgets never call the
   network, and only the drawing differs by platform.
2. **Android (12H):** `react-native-android-widget`, isolated in `apps/mobile/src/integrations/widgets/`.
3. **iPhone (12I):** `expo-widgets`, so **no hand-written Swift**: CLAUDE.md's platform note is
   satisfied without the native-code exception. Data goes through the App Group. Built by Codemagic or
   EAS with automatic signing (ADR-007) and checked on a physical iPhone through TestFlight.
4. **A setting hides health values** (readiness, weight, calories) from the home screen; the widget
   then shows only training facts (ADR-061).
5. **Replica first:** each widget's design is shown to the owner and approved before it is built (the
   standing UI approval rule).
6. Live Activities (a run or session on the lock screen and Dynamic Island) become possible through
   the same module, but are **not** part of this decision.

## Consequences

- iPhone widgets need the Apple Developer account (the App Group and the widget bundle id), so 12I
  waits for that account even though no Mac is needed.
- `expo-widgets` is young: if it cannot express a widget, the fallback is `@bacons/apple-targets` with
  the least Swift possible, which would need its own ADR amendment.
- `data-inventory.md` gains the widget snapshot (on the phone only).
