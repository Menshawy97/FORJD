# Open bug: Expo Go fails to render — duplicate Expo SDK trees in the pnpm store

**Status: OPEN. Partially fixed. The app still does not render in Expo Go.**

This file exists so the next session does not have to re-derive any of this. It records what
the bug is, what was proven, what was fixed, what was tried and reverted (and why), and the
options that remain.

## Symptom

Opening the app in Expo Go produces a full-screen red error. It has surfaced as **two
different errors**, in sequence — fixing the first revealed the second.

**Error 1 (fixed).** A codegen parse failure, whose file path is the entire diagnosis:

```
..\..\node_modules\.pnpm\react-native@0.86.2_@babel+_8d29f8e8a36ebd95a5fae8981f872237\
  node_modules\react-native\src\private\specs_DEPRECATED\components\
  DebuggingOverlayNativeComponent.js:
Unsupported param type for method "highlightTraceUpdates", param "updates".
Found ReadonlyArray
```

`apps/mobile` pins `react-native@0.81.5`. Nothing in it depends on `0.86.2`. RN 0.81's codegen
cannot parse RN 0.86's newer spec syntax, and Metro's codegen scans every react-native copy its
**file watcher** can see — not only the one the app's import graph resolves to.

**Error 2 (still open).** With the stray react-native excluded, the bundle builds and the app
renders far enough to throw a React error instead:

```
Render Error
useLinkPreviewContext must be used within a LinkPreviewContextProvider.
This is likely a bug in Expo Router.
```

Component stack: `<anonymous>` -> `ThemeProvider` -> `SafeAreaEnv` -> ...
Call stack: `useLinkPreviewContext` (`.../LinkPreviewContext.js`) <-
`Object.assign$argument_0` (`.../expo-router/build/layouts/StackClient.js`).

**It is not a bug in Expo Router.** It is the classic signature of *two copies of the same
package*: a component rendered under copy A's provider calls copy B's hook, so B's context is
empty. Expo Router's own error text guesses wrong about the cause.

## Root cause (proven, not assumed)

`expo@54.0.37` declares two **optional peer dependencies with the version range `"*"`** — no
upper bound:

```jsonc
// node_modules/.pnpm/expo@54.0.37_.../node_modules/expo/package.json
"peerDependencies": {
  "@expo/dom-webview": "*",     // optional
  "@expo/metro-runtime": "*",   // optional
  "react": "*",
  "react-native": "*",
  "react-native-webview": "*"   // optional
}
```

`apps/mobile` pins `@expo/metro-runtime` to `~6.1.2`, so that one resolves correctly. It does
**not** declare `@expo/dom-webview` at all — so pnpm resolved that unbounded `"*"` to the newest
published release, **57.0.1**, an Expo SDK 57 package.

That single package dragged in an entire parallel SDK 57 tree beside the SDK 54 tree the app
actually targets:

```
expo@57.0.15            expo-router@57.0.15      @expo/metro-runtime@57.0.12
@expo/log-box@57.0.3    @expo/ui@57.0.12         react@19.2.3
react-native@0.86.2     @react-native/*@0.86.2   + ~40 more expo-*@57 packages
```

`react-native@0.86.2` is what error 1 tripped over. **`expo-router@57.0.15` existing alongside
`expo-router@6.0.24` is what error 2 is** — two module instances, two separate
`LinkPreviewContext` objects.

Verified with `pnpm why expo --filter @forjd/mobile` (resolves `expo@54.0.37` correctly, with
the 57 tree hanging off the one unpinned peer) and by reading `expo@54`'s own `package.json`.

**Not the cause, ruled out by checking:** `eas-cli` (its Expo deps are all SDK-54-era or older
— `@expo/config@10`, `@expo/prebuild-config@8`); `drizzle-orm`'s optional peer on `expo-sqlite`
(a real second-order contributor to the duplicate `expo-sqlite`, but not the origin of the 57
tree); anything in `apps/api` or `packages/*` (none declare expo or react-native at all).

**Also pre-existing, not introduced by Phase 2 work** — confirmed by diffing `pnpm-lock.yaml`
at the Phase B commit: `react-native@0.86.2` was already in the lockfile beforehand.

## What was fixed and merged

`apps/mobile/metro.config.js` — a `resolver.blockList` entry excluding every react-native copy
except the pinned `0.81.5`:

```js
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList]),
  /node_modules[\\/]\.pnpm[\\/]react-native@(?!0\.81\.5)/,
];
```

This **fixes error 1** — the bundle now builds past the codegen crash. It does not address
error 2, since blocking `expo-router@57` the same way is untested and treats the symptom.

Note `config.watchFolders` **must stay `[workspaceRoot]`**. Narrowing it to just
`packages/domain` + `packages/contracts` was tried and broke module resolution outright
(`Unable to resolve module .../expo-router/entry.js`) — pnpm's virtual store lives at the
workspace root. Confirmed by running a real Metro export, not assumed.

## What was tried and reverted — do not repeat without reading this

A `pnpm-workspace.yaml` `overrides` block pinning the unbounded peers:

```yaml
overrides:
  "@expo/dom-webview": "0.2.8"        # last pre-SDK-renumbering release (55.x+ are SDK-aligned)
  "@expo/metro-runtime": "~6.1.2"
```

**It worked at the dependency level and still failed.** After it, `pnpm why --filter
@forjd/mobile` reported single correct versions for all three packages — `expo-router@6.0.24`,
`@expo/metro-runtime@6.1.2`, `react-native@0.81.5`. But:

1. **The device error was unchanged** — still `useLinkPreviewContext`. (The 57.x copies also
   remained physically present in `node_modules/.pnpm`, accumulated from earlier installs;
   whether a fully clean store would behave differently was never tested.)
2. **It broke 39 of 61 mobile test suites** (was: all green) with
   `Invariant Violation: __fbBatchedBridgeConfig is not set, cannot invoke native modules`,
   thrown from `expo-router/testing-library` -> `expo-modules-core`. Pinning `@expo/dom-webview`
   to `0.2.8` evidently disturbs something `jest-expo`'s native-module mocking depends on.

Reverted in full (`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and a `.npmrc` carrying
`auto-install-peers=false`, which alone changed nothing). Mobile tests confirmed green again
afterward. **Only the `metro.config.js` blockList was kept.**

## Options for the next session, roughly in order of preference

1. **Declare `@expo/dom-webview` directly in `apps/mobile/package.json`** at the version
   `expo@54` actually expects, rather than overriding it workspace-wide. This is the same shape
   of fix as `@expo/metro-runtime: ~6.1.2` (which is declared and *does* resolve correctly), and
   it is the difference between the peer that works and the peer that doesn't. Find the right
   version with `npx expo install @expo/dom-webview`, which resolves against the installed SDK.
   Verify the mobile test suite stays green — that is what the override approach failed.
2. **Add `expo-router` to the Metro blockList** the same way react-native was, as a targeted
   follow-on to the fix already merged. Treats the symptom rather than the duplication, but is
   low-risk, easy to reverse, and testable in minutes.
3. **A genuinely clean store.** Delete `node_modules` and `pnpm-lock.yaml` entirely and
   reinstall, so nothing is reused from an earlier resolution. Every attempt so far reinstalled
   over an existing store; stale 57.x directories persisted throughout, and it was never
   established whether Metro was reaching those leftovers rather than a currently-linked copy.
4. **Upgrade the app to Expo SDK 57.** Removes the mismatch by eliminating the older tree, but
   contradicts ADR-013's reason for pinning SDK 54: Expo Go ships one SDK version, and the whole
   justification for the Expo pivot is the zero-build Expo Go loop on a physical iPhone. Only
   viable once Expo Go itself ships 57.

## How to reproduce and verify

```powershell
# Reproduce: start the dev server and open in Expo Go on a physical device.
cd apps/mobile; npx expo start --offline --clear
```

`--clear` is not optional when testing a fix — Metro's transform cache holds modules resolved
against the previous dependency graph and will happily serve a stale bundle.

```powershell
# Inspect the duplication directly.
pnpm why expo --filter @forjd/mobile
pnpm why expo-router --filter @forjd/mobile
Get-ChildItem node_modules/.pnpm -Directory | Where-Object Name -match '^(react-native|expo-router|expo)@'
```

**Any fix must keep the mobile suite green** — that is precisely the check the reverted attempt
failed:

```powershell
pnpm --filter @forjd/mobile test --ci
```

Never run it at the same time as the API suite; they starve each other and report false
failures.

## Why this matters beyond the annoyance

ADR-013 justifies the whole Flutter -> Expo pivot on the zero-build Expo Go loop against a
physical iPhone from a Windows dev machine. While this bug stands, **that loop is broken** —
which is the one thing the pivot was supposed to buy. Jest does not compile NativeWind or
native modules, so the test suite passing is not evidence the app runs; a real device is the
only proof, and right now it cannot be obtained.
