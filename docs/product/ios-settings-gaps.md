# iPhone settings the app still lacks (Phase 11 prep)

Read from `apps/mobile/app.config.ts`, the config plugins in `node_modules` and the screens, on
2026-10-15 (`main` at 3d214c9). Nothing here is fixed yet: iOS starts with Phase 11 (ADR-007), and each
fix should land, test-first, before the first TestFlight build. Apple's App Review Guidelines are
quoted by number.

## Would get the first submission rejected

1. **Sign in with Apple must be on for iPhone** (guideline 4.8, Login Services). An app that offers a
   third-party login such as Google must also offer a login that limits data to name and email, lets the
   person hide their email, and does no ad tracking. Sign in with Apple is that option. It is built but
   off: `extra.appleSignInEnabled` reads `APPLE_SIGN_IN_ENABLED`, and the entitlement plugin is not added
   yet (the comment in `app.config.ts` says so). Needs the Apple Developer account. FORJD's own email
   sign-in does not exempt it, since Google is offered too.
2. **Purpose strings that do not cover every use** (guideline 5.1.1(ii): "clearly and completely
   describe your use of the data"):
   - `NSCameraUsageDescription` mentions only the nutrition share card, but the InBody screen also opens
     the camera (`inbody.tsx`, `launchCameraAsync`).
   - `NSPhotoLibraryUsageDescription` mentions only InBody scans, but the profile photo
     (`edit-profile.tsx`, `pick-username.tsx`) and the nutrition share background (`nutrition-share.tsx`)
     also pick from the library.
3. **A microphone prompt for a microphone FORJD never uses.** *(Fixed 2026-10-16 with the Android
   permission change.)* Expo applies `expo-image-picker`'s
   config plugin automatically (it is on prebuild's legacy auto-plugin list), and with no options it adds
   a generic `NSMicrophoneUsageDescription` ("Allow $(PRODUCT_NAME) to access your microphone"). FORJD
   picks and takes photos only. Fix: list the plugin with `microphonePermission: false`. (On Android the
   same default adds `RECORD_AUDIO`, see the Android note at the end.)

## Would break on iPhone

4. **Background upload would not be allowed.** 12C's background upload uses `expo-background-task`,
   whose config plugin adds the `processing` background mode and the
   `BGTaskSchedulerPermittedIdentifiers` entry iOS requires. It is not in the plugins list and not on
   Expo's auto-plugin list, so the iPhone build lacks both. iOS refuses to schedule the task, or stops
   the app, when an identifier is missing from Info.plist. Fix: add `'expo-background-task'` to plugins.
   Android is unaffected, which is why it has not shown up.
5. **Apple Health is not wired.** The HealthKit entitlement and `NSHealthShareUsageDescription` come
   with the library [ADR-068](../decisions/ADR-068-apple-health-library.md) proposes. Read only, so no
   update (write) string.
6. **Google sign-in on iPhone** needs an iOS OAuth client and its reversed client ID as a URL scheme.
   `app.config.ts` adds it only when `GOOGLE_IOS_URL_SCHEME` is set, which it is not yet.
7. **Push on iPhone** needs an Apple push key (APNs) uploaded to EAS, which needs the Apple account.
   `expo-notifications` adds the push entitlement itself.

## Worth settling, not blocking

8. **Export compliance.** Set `ios.config.usesNonExemptEncryption: false` (FORJD uses only HTTPS), so
   App Store Connect does not ask about encryption on every upload.
9. **Privacy manifest.** Apple requires reasons for some system APIs (for example user defaults and
   file timestamps). Expo's modules ship their own manifests; after the first TestFlight upload, read
   Apple's email for any "ITMS-91053" warning and add the missing reasons under `ios.privacyManifests`.
10. **No map on iPhone.** The run screen's Google map is Android-only (`route-map.tsx` loads it only on
    Android with a key); iPhone shows the striped fallback. Either an iOS Google Maps key, or Apple Maps
    on iPhone. A product choice, not a review risk.
11. **App Store privacy labels.** Apple's equivalent of Play's Data safety form; the answers in
    [play-data-safety-answers.md](play-data-safety-answers.md) carry over, with Apple's own category names.
12. **Background location review note.** The `location` background mode is on (runs keep tracking with
    the screen off, When In Use only, the blue status-bar pill). App Review usually asks why: the review
    notes should say "GPS tracking of a run the person starts and stops".
13. **iPhone only.** `ios.supportsTablet` is not set, so the app is iPhone only, which avoids an iPad
    layout review. Keep it that way unless iPad is wanted.

Already right: in-app account deletion exists (guideline 5.1.1(v)); the location strings claim only
When In Use (the Always and motion strings are deleted on purpose); health data never reaches an
analytics or advertising service (rule 15, guideline 5.1.3); nothing is stored in iCloud.

## Android note found on the way (fixed 2026-10-16)

Fixed: the five permissions are now in `blockedPermissions`, `expo-image-picker` is listed with
`microphonePermission: false` (which also removes item 3's iPhone microphone prompt), and Save Image asks
write-only. Checked on the emulator; see the checklist. The original finding:

The installed Android build (EAS dev build `001a2aac`, `dumpsys package`) declares `RECORD_AUDIO`
(from the same `expo-image-picker` default) and `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and
`READ_MEDIA_AUDIO` (from `expo-media-library`'s default granular permissions), none of which FORJD
needs: photos are picked through the system picker and share cards are only saved. Google Play's Photo
and Video Permissions policy (compliance required since 28 May 2025) allows
`READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` only when the system photo picker cannot serve the app's core
use, and apps that are not compliant are subject to removal. Tracked as a beta item in
[remaining-checklist.md](remaining-checklist.md).
