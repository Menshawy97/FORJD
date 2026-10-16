# iPhone work that needs no Apple Developer account (Phase 11 prep)

Started 2026-10-16 (`main` at bda30e6). The paid Apple Developer account does not exist yet, so
nothing here can be signed, put on TestFlight or run on an iPhone. This plan covers what can be done
anyway, one PR per slice, without changing Android's behaviour. Every config change is checked with
`config/__tests__/ios-settings.test.ts`, which runs the real config plugins (what
`npx expo config --type introspect` prints) and compares the Android manifest with the copy saved in
`config/__fixtures__/android-manifest.json`. That copy changes only when an Android change is meant.

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
| 1 | iPhone settings: full camera and photo-library purpose strings, no Face ID prompt, `expo-background-task` plugin (`processing` mode and task identifier), `usesNonExemptEncryption: false` | This PR |
| 2 | A `simulator` build profile in `eas.json` and one EAS iOS simulator build, the compile check of today's app before any Apple Health code (uses one of the free plan's monthly iOS builds) | Next |
| 3 | App Store privacy labels, mapped from [play-data-safety-answers.md](play-data-safety-answers.md) (documents only) | Planned |
| 4 | Apple Maps under a run's route on iPhone: mock-up first, then the change in `integrations/maps/route-map.tsx`. A simulator build proves it compiles, not that it draws | Planned |
| 5 | Apple Health: the rule 16 exception ADR, then `AppleHealthProvider` behind the unchanged `HealthProvider`, the shared contract tests with a mocked native module, the conformance rule, off by default; a simulator build as the compile check | Planned |

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
