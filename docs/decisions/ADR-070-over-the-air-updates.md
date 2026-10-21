# ADR-070: Over-the-air updates for JavaScript-only changes

**Status:** Accepted
**Date:** 2026-10-21
**Scope:** `expo-updates` in the mobile app, the runtime version policy, and how an update is published.

## Context

Every change to the app has gone out as a new store build, including a one-line copy fix. The owner
wants to ship small changes without waiting on App Store and Play review, and to keep the stores for big
changes. `eas.json` already gave the `staging` and `production` profiles update channels, but
`expo-updates` was not installed, so the channels did nothing (`eas build` warned about it, and
remaining-checklist.md asked whether over-the-air updates were wanted).

An Expo app has two layers. The native layer (native modules, config plugins, permissions, icon and
splash, the SDK) only changes with a build. The JavaScript bundle (every screen, the logic, the copy,
the styling) is what an update replaces. An update with JavaScript that calls a native module the
installed build does not have crashes on that phone.

## Decision

1. **`expo-updates` with EAS Update** (`updates.url` is this EAS project). Each build reports its
   channel, set by its `eas.json` profile, so a staging update never reaches a production phone.
2. **Runtime version: the fingerprint of the native layer** (`runtimeVersion: { policy: 'fingerprint' }`).
   An update reaches only builds with the identical fingerprint, so a native change can never go out as an
   update by mistake: the phones simply do not take it and wait for the store build. `appVersion` was
   the alternative, but it depends on someone remembering to bump `version` after every native change,
   and forgetting means a crash. `apps/mobile/fingerprint.config.js` leaves out four things that do not
   reach native code: `extra` (an update carries its own copy, and it differs between staging and
   production only by the API address), package.json scripts, `eas.json`, and the address check
   `config/api-base-url.js`.
3. **Launch never waits for the network** (`fallbackToCacheTimeout: 0`, `checkAutomatically: 'ON_LOAD'`).
   The app opens on the bundle it has, checks for a newer one in the background, and runs it from the
   next cold start. Rule 6 holds: an offline launch is unchanged, and the app never calls
   `Updates.reloadAsync()`, so a live workout is never reloaded under the athlete. The cost is that most
   people see a fix on their second launch after it is published, not their first.
4. **Publish only through `pnpm update:staging` / `pnpm update:production`**
   (`apps/mobile/scripts/publish-update.js`), never a bare `eas update`. `eas update` reads neither the
   build profile's `env` in eas.json nor `EAS_BUILD_PROFILE`, so a bare run would bundle
   `extra.apiBaseUrl` as the localhost default, skip the production address check, and cut every phone on
   the channel off from the server. The script:
   - takes `API_BASE_URL` and `GOOGLE_WEB_CLIENT_ID` from the channel's own profile in eas.json, and
     sets `FORJD_UPDATE_PROFILE` so `app.config.ts` runs the same address check a production build runs;
   - refuses a production update from a working tree with uncommitted changes;
   - works out each platform's runtime version with the EAS environment variables a build of that
     profile gets (`eas env:exec`; the Maps key and the Firebase file decide which plugins apply), and
     publishes only to platforms with a finished build on the channel that has that runtime version.
     None means the native layer changed, so it stops and says a store build is needed.
5. **Staging first.** Publish to staging, check it on the phone, then publish the same commit to
   production.

## What goes where

| Over the air | Store build |
|---|---|
| Screens, layout, styling, copy, translations | A new or upgraded native library, or any package with native code |
| Bug fixes and logic in TypeScript | A config plugin or its options in `app.config.ts`, a permission, a purpose string |
| Images and fonts the JavaScript imports | The icon, the splash screen, the app name |
| New API calls to endpoints the server already has | An Expo SDK upgrade (ADR-027) |

The fingerprint decides this, not the table. When the script says no build can take the update, it is a
store build. Store review rules still apply to updates: an update may fix and adjust the app, but a change
to what the app is for goes through review.

## Consequences

- **Nothing changes for phones that already have the app.** Their builds have no `expo-updates`. The
  first build of each channel after this ADR is the one that can take updates.
- **One more request at launch:** to `u.expo.dev`, with the platform, runtime version, channel and current
  update ID. No user ID and no health data (recorded in data-inventory.md; rule 15 is unaffected).
- **Rollback:** `eas update:rollback` on the channel. If a new bundle crashes at launch, `expo-updates`
  goes back to the previous one by itself.
- **The address guard depends on using the script.** A bare `eas update` still bypasses it, since EAS has
  no hook that runs before an update. This ADR and production-setup.md say to use the script.
- **Unverified until the first build:** that the fingerprint EAS's Linux builders compute matches the
  one the script computes on Windows. If it does not, the script refuses every update (it never sends an
  incompatible one). The first check is to build staging, publish a test update with the script, and see
  the phone take it on its second launch.
