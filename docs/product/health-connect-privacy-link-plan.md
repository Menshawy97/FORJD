# Health Connect privacy link opens the privacy policy (plan)

**Status:** planned 2026-10-15, not started. Owner approved the approach ("open the website policy
in the browser") on 2026-10-15.

## The problem

Health Connect's permission screen shows a **privacy policy** link. Tapping it sends an intent to
the app: `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` up to Android 13, and
`android.intent.action.VIEW_PERMISSION_USAGE` (category `HEALTH_PERMISSIONS`) through an
activity alias from Android 14. Google's Health Connect guide says the activity that receives it
"must display the same privacy policy you provide for your app in the Google Play Console"
(developer.android.com, Health Connect "Get started"). Google reviews every app that asks for
health permissions, so a link that goes nowhere useful is a likely reason to refuse them.

Today the `react-native-health-connect` config plugin (`app.config.ts` plugins list) points both
the intent filter and the alias at `MainActivity`. No FORJD code reads that intent, so the link
just opens FORJD on whatever screen it was last on. Checked 2026-10-15: no match for
`PERMISSIONS_RATIONALE` or `VIEW_PERMISSION_USAGE` anywhere in `apps/mobile/src`.

## The fix

A small native activity that opens `https://getforjd.com/privacy` (the URL already in
`apps/mobile/src/legal/links.ts` as `PRIVACY_POLICY_URL`, the same one going on the Play listing)
in the phone's browser and closes itself. Nothing in the app's own screens changes, so there is
no mock-up.

1. New local Expo module `apps/mobile/modules/forjd-health-rationale/`, Android only, laid out like
   `modules/forjd-ongoing-notice/` (ADR-063):
   - `HealthPermissionsRationaleActivity.kt`: on create, start `Intent.ACTION_VIEW` with the
     privacy URL, then `finish()`. Translucent theme, `noHistory`, `excludeFromRecents`, so
     nothing flashes and it never sits in the back stack. If no browser can open the link
     (`ActivityNotFoundException`), it finishes quietly rather than crashing.
   - Its `AndroidManifest.xml` declares the activity (exported, with the
     `ACTION_SHOW_PERMISSIONS_RATIONALE` filter) and the Android 14+ alias (exported, guarded by
     `android.permission.START_VIEW_PERMISSION_USAGE`, `VIEW_PERMISSION_USAGE` +
     `HEALTH_PERMISSIONS`), both with fully qualified names. The manifest merger adds them to the
     app.
   - No JavaScript side: nothing in `src/` imports it.
2. Remove `'react-native-health-connect'` from the `app.config.ts` plugins list. That plugin only
   edits the manifest (the two entries above); the library's native code, including the
   permission delegate that `requestPermission()` needs, is linked through its own
   `expo-module.config.json` and is not affected. Keeping the plugin would leave a second
   `ViewPermissionUsageActivity` alias and the filter on `MainActivity`, so Android could pick
   either.

## Tests first (RED, then GREEN)

Jest cannot run Kotlin, so the tests pin the files the build reads:

- `apps/mobile/config/__tests__/health-rationale-manifest.test.ts` (new):
  - the module manifest has an exported activity with the `ACTION_SHOW_PERMISSIONS_RATIONALE`
    filter;
  - it has an exported alias with `VIEW_PERMISSION_USAGE` + `HEALTH_PERMISSIONS`, the
    `START_VIEW_PERMISSION_USAGE` permission, and `targetActivity` equal to that activity's name;
  - the Kotlin file opens exactly `PRIVACY_POLICY_URL` (read from `src/legal/links.ts`), so the
    two cannot drift;
  - `app.config.ts`'s plugins list does not include `react-native-health-connect`.
- Existing tests stay green (`pnpm --filter @forjd/mobile test`, typecheck, lint,
  `scripts/ci/check-architecture-conformance.sh`).

## Checking it runs

1. Step one, before writing code: confirm Expo autolinking includes a local module whose
   `expo-module.config.json` lists no `modules` (only native files). If it does not, give the
   module an empty Expo module class instead.
2. `npx expo prebuild --platform android --clean` (writes the gitignored `apps/mobile/android/`),
   then `gradlew :app:processDebugMainManifest` and read the merged manifest: exactly one
   rationale filter and one alias, both on the new activity, none on `MainActivity`.
3. Install on the `forjd_pixel7_api34` emulator (Android 14, Health Connect built in). Open
   FORJD's Health Connect ask, tap **privacy policy**: the browser opens getforjd.com/privacy.
   Also send the Android 13 intent by hand (`adb shell am start -a
   androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE -n com.forjd.app/<activity>`) and check the
   same.
4. Granting heart rate and calories still works afterwards (the delegate is untouched).

## Rule 16 (open, owner decision)

CLAUDE.md rule 16: Health Connect code does not merge until it has run on a physical Android
phone. ADR-035 was a one-time exception and is not a precedent. The owner's only phone (OPPO A37f,
Android 5.1.1) cannot run the app, so either the walk happens on a borrowed Android 9+ phone
before merging, or the owner writes a new ADR exception for this change. The phone check is the
same as step 3: tap the link, see the policy, then grant both permissions.

## Docs in the same PR

`docs/architecture/integrations.md` (Health Connect section: where the rationale intent goes), the
roadmap entry, this plan's status, and the checklist line under "Play Console forms".
