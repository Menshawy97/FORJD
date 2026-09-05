# ADR-027: Expo SDK 54 → 57

**Status:** Accepted
**Date:** 2026-09-05
**Relates to:** ADR-013 (Expo React Native replaces Flutter), ADR-007 (no Mac/iOS toolchain)

## Context

ADR-013 chose Expo Go as the development loop for this app, on Windows, with no Mac. The whole
value of that choice is scanning a QR code and hot-reloading on a physical iPhone in about a
second.

It comes with one hard constraint, which ADR-013 records and `apps/mobile/AGENTS.md` restated:
**Expo Go on the App Store ships exactly one SDK version at a time.** An SDK-mismatched bundle
does not degrade — it fails to load. So the app does not track the newest Expo release; it tracks
whatever Expo Go currently ships.

On 2026-09-05 the development iPhone's Expo Go was updated to **SDK 57**. Every SDK 54 bundle
this app produced became unloadable on the only device it is tested on. The upgrade was therefore
not a choice about staying current — it was the pin doing exactly what ADR-013 said it would do,
in the direction the constraint pushes it.

`AGENTS.md` said "do not bump toward a newer SDK (57…)" and "an SDK upgrade is a deliberate
decision requiring a new ADR". This is that decision and that ADR.

## Decision

Move `apps/mobile` from Expo SDK 54 to **SDK 57**:

| | Before | After |
|---|---|---|
| `expo` | `~54.0.37` | `~57.0.20` |
| `react-native` | `0.81.5` | `0.86.3` |
| `react` | `19.1.0` | `19.2.3` |
| `jest-expo` | `~54.0.18` | `~57.0.5` |
| `@types/react` | `~19.1.17` | `~19.2.18` |

Every `expo-*` and `react-native-*` package was realigned by `npx expo install --fix` rather than
by hand, so the versions are the ones SDK 57 actually pins rather than the ones that happened to
resolve.

## Three things this broke, and what they teach

**1. The Metro blockList had a hardcoded react-native version, and it inverted.**

`metro.config.js` excludes every `react-native@*` copy in pnpm's shared store *except* the app's
own — Metro's codegen scans all of them, and a mismatched copy's spec syntax can crash Expo Go
from a package this app never imports. The exclusion was written as a literal negative lookahead
on `0.81.5`.

After the upgrade that filter meant "block everything except 0.81.5", which blocks the app's own
react-native — the one copy it must never block — while *admitting* the stray it was written to
exclude. It is a config that silently does the opposite of its purpose the moment the version
moves, and nothing about it would look wrong on inspection.

It now derives the version from `package.json`. A pin that has to be remembered during an upgrade
is a pin that will be forgotten during one.

**2. `resolver.unstable_enableSymlinks` became config drift.**

Metro did not follow symlinks by default, and pnpm's entire `node_modules` strategy is built on
them. From SDK 57 it is the default, and `expo-doctor` flags the override. Removed rather than
left as a no-op somebody would later have to work out the status of.

**3. `StyleSheet.absoluteFillObject` is gone in RN 0.86.**

Three usages in `nutrition-share.tsx`. Replaced with `StyleSheet.absoluteFill`, which RN 0.86.3
does export and which is valid in every position the old one was used in, including inside a
style array.

`expo-web-browser` also now has to be registered as a config plugin; it was implicit before.

## What was deliberately not done

**TypeScript stays at 5.9.3.** `expo-doctor` wants `~6.0.3`. TypeScript has no effect on whether
the bundle builds or runs — it is a typechecking tool — and TS 6 is a major version across a
monorepo that also contains a NestJS API. Bundling that migration into an upgrade whose whole
purpose is "make the phone able to load the app" would have coupled two unrelated risks. It is a
follow-up, not part of this.

**`eas-cli` stays a local dependency.** `expo-doctor` prefers it global. Pre-existing, unrelated
to the SDK, and changing it would alter how CI invokes builds — out of scope here.

## Consequences

- The app now requires **Expo Go 57**. An older Expo Go cannot load it, which is the same
  constraint as before pointing the other way.
- ADR-013's development loop is preserved, which is the entire point: this upgrade exists to keep
  hot-reload-on-device working, not to be current.
- The next upgrade will be triggered the same way — by the Expo Go client on the test device
  moving — and `AGENTS.md` now says so explicitly rather than naming a version to avoid.
- A green `tsc` and a green Jest run do not prove an SDK upgrade worked. Jest compiles neither
  NativeWind nor native modules. `AGENTS.md` now requires a real `expo export` plus a load on the
  physical device before an upgrade is called done.
