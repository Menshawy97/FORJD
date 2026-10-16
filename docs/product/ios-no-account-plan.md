# iPhone work that needs no Apple Developer account (Phase 11 prep)

Started 2026-10-16 (`main` at bda30e6). The paid Apple Developer account does not exist yet, so
nothing here can be signed, put on TestFlight or run on an iPhone. This plan covers what can be done
anyway, one PR per slice, without changing Android's behaviour. Every config change is checked with
`config/__tests__/ios-settings.test.ts`, which runs the real config plugins (what
`npx expo config --type introspect` prints) and compares the Android manifest with the copy saved in
`config/__fixtures__/android-manifest.json`. That copy changes only when an Android change is meant.
The plugins run against an empty folder, so a gitignored `android/` left by a local prebuild is not
read in place of Expo's template (it was, at first, and CI caught the difference); EAS builds from a
clean clone, so the template is what ships.

## Owner decisions (2026-10-16)

- **Purpose strings:** the camera and photo-library wording in slice 1 is approved as written.
- **Apple Health library:** ADR-068 accepted, `@kingstinct/react-native-healthkit`.
- **Where the Apple Health code waits:** merged into `main` behind an off switch, not kept on a
  branch. That goes against rule 16 as written, so slice 5 starts with its own ADR (an exception like
  ADR-067) before any code. The library's peer, `react-native-nitro-modules`, also has Android native
  code; slice 5 keeps it out of the Android build through Expo's autolinking exclude, so Android stays
  unchanged and the manifest test proves it.
- **Run map on iPhone:** Apple Maps (no key, no cost). A mock-up comes before the code.

## Slices

| # | Slice | State |
|---|---|---|
| 1 | iPhone settings: full camera and photo-library purpose strings, no Face ID prompt, `expo-background-task` plugin (`processing` mode and task identifier), `usesNonExemptEncryption: false` | Merged (#423) |
| 2 | A `simulator` build profile in `eas.json` and one EAS iOS simulator build, the compile check of today's app before any Apple Health code (uses one of the free plan's monthly iOS builds) | Merged (#424): builds (f3a08ef2) |
| 3 | App Store privacy labels, mapped from [play-data-safety-answers.md](play-data-safety-answers.md) (documents only) | Merged (#425): [app-store-privacy-labels.md](app-store-privacy-labels.md) |
| 4 | Apple Maps under a run's route on iPhone: mock-up first, then the change in `integrations/maps/route-map.tsx`. A simulator build proves it compiles, not that it draws | Merged (#426) |
| 5 | Apple Health: the rule 16 exception ADR, then `AppleHealthProvider` behind the unchanged `HealthProvider`, the shared contract tests with a mocked native module, the conformance rule, off by default; a simulator build as the compile check | This PR (ADR-069) |

Blocked on the Apple account: Sign in with Apple switched on, iPhone push (APNs key), TestFlight,
the privacy-manifest warnings Apple emails after the first upload, and every check on a real iPhone,
including the one that lets slice 5's switch be turned on. Google sign-in on iPhone also needs an iOS
OAuth client in Google Cloud (owner).

## Slice 1 (2026-10-16)

Test first: `ios-settings.test.ts` failed on the five iPhone items and passed on the Android manifest,
then `app.config.ts` changed:

- `NSCameraUsageDescription` names the InBody scan and the nutrition share card;
  `NSPhotoLibraryUsageDescription` names the InBody scan, the profile photo and the share card background.
- `expo-secure-store` listed with `faceIDPermission: false`, which deletes the generic Face ID prompt.
- `expo-background-task` listed; its plugin only edits the iPhone Info.plist.
- `ios.config.usesNonExemptEncryption: false` (Info.plist `ITSAppUsesNonExemptEncryption = false`).

`npx expo config --type introspect` before and after: the Android section is identical.

Found on the way: the Sign in with Apple entitlement is already in the iPhone build, because Expo
applies `expo-apple-authentication`'s plugin by itself. Only the account is missing for it.

## Slice 2 (2026-10-16)

Test first: `config/__tests__/eas-simulator-profile.test.ts` failed, then `eas.json` gained a
`simulator` profile: `extends: staging` with `ios.simulator: true`. It is the staging app (same API and
settings), not a development client, sets nothing for Android, and leaves the other profiles as they
were. Run it with `eas build --platform ios --profile simulator`, from a clean clone of the branch.

**Result: the iPhone app builds.** Four EAS simulator builds on 2026-10-16; the fourth,
[f3a08ef2](https://expo.dev/accounts/forjd/projects/forjd-mobile/builds/f3a08ef2-8217-4549-9ffd-f085ddca37e4),
finished in about 10 minutes (compiled, bundled, `.app` archive produced). The first three each found a
problem, fixed test-first in this PR:

1. **Prebuild could not read any Info.plist** (build 86751d84). The ADR-039 override forced
   `@xmldom/xmldom` 0.9, and `@expo/plist` is written for 0.8. Now `>=0.8.15 <0.9.0`, patched for every
   advisory that affects 0.8; `pnpm audit` totals unchanged, no xmldom entry (ADR-039 amendment,
   `ios-plist-parse.test.ts`).
2. **Bundling could not find `@forjd/contracts`** (build 49c22e4e). Metro resolves the workspace
   packages through their compiled `dist/`, which git does not hold; `eas-build-post-install` now
   builds them. Every earlier EAS build was a development build, which never bundles, so this would
   likely also have stopped the first Android staging or production build.
3. **Babel could not find `babel-preset-expo`** in Xcode's bundling step (build fdff57b2). It reached
   the app only through pnpm hoisting; it is now the app's own dev dependency (the version expo
   already uses). Same Android note as 2.

What this proves: the iPhone app compiles and bundles with Expo SDK 57 and React Native 0.86, with
slice 1's settings. What it does not: that it runs (the simulator cannot run on Windows) or that a
signed device build works (Apple account). Builds used: 4 of the free plan's monthly iOS builds.

## Slice 4 (2026-10-16)

The owner approved the mock-up (live run and run complete, Apple's dark map under the same ember route,
markers and GPS pill, Apple's Maps logo and Legal link left visible). Test first: seven iPhone tests in
`route-map.test.tsx` failed, then `route-map.tsx` gained a native-map choice: Google on Android with a
key, Apple (MapKit, no provider) on iOS, stripes otherwise. Android's props are unchanged and its tests
still pass; the existing no-key tests now name Android, and the missing-module test covers both
platforms. ADR-050 amended; the data inventory gains an Apple Maps row. Not yet seen on an iPhone.

## Slice 5 (2026-10-17)

ADR-069 written first: the rule 16 exception covers merging switched off, not switching on. Then,
test-first:

- **Library** `@kingstinct/react-native-healthkit` 16.2.0 and `react-native-nitro-modules` 0.37.1, pinned.
  `react-native.config.js` keeps both out of Android autolinking; before and after, Android links the
  same 14 React Native packages and 44 Expo modules.
- **Switch** `APPLE_HEALTH_ENABLED` (no `eas.json` profile sets it). Off: no HealthKit entitlement, no
  health permission text, `extra.appleHealthEnabled: false`. On: the entitlement and a read-only text,
  no write text, no background delivery. `config/__tests__/apple-health-config.test.ts`.
- **`AppleHealthProvider`** behind the unchanged `HealthProvider`, with the pure
  `apple-health-sample-mapping.ts`; the shared contract suite, a mocked native module, and a test that it
  never reads a type it has not asked for. `getDeviceHealthProvider()` returns it on iPhone only when
  switched on.
- **Conformance rule:** the library and its Nitro peer only in `integrations/health/` (proved by a
  planted import). CLAUDE.md rule 17 and `integrations.md` name the library.

**Owed before the switch:** the owner approves the permission text; a TestFlight build on a physical
iPhone (Apple account) reads heart rate and active energy during a run, refuses each alone, and keeps
whichever was granted, and a second run still reads both; the readiness read side picks one sleep source
per night; then the App Store privacy labels' Health row is confirmed. Compiled for iPhone by EAS
simulator build 3ceba342 (library linked); switched-off builds no longer link it (review finding).
