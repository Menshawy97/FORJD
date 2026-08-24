# Fixed: Expo Go failed to render — duplicate Expo SDK trees in the pnpm store

**Status: RESOLVED.** Confirmed working on a physical iPhone via Expo Go, 2026-08-25 — app
loads and renders past the previously-crashing screen, three successive bundle serves logged
clean with zero runtime errors reaching the dev server console.

This file is kept (not deleted) because the root cause is still present in the dependency
graph — only its blast radius was closed — and because the fix's mechanism is partly inferred
rather than fully isolated. Read this before touching `apps/mobile/metro.config.js`'s
`resolver.blockList` or any Expo/react-native dependency version in this workspace.

## Symptom (both now gone)

Opening the app in Expo Go produced a full-screen red error, in two forms seen in sequence —
fixing the first revealed the second.

**Error 1.** A codegen parse failure, whose file path was the entire diagnosis:

```
..\..\node_modules\.pnpm\react-native@0.86.2_@babel+_8d29f8e8a36ebd95a5fae8981f872237\
  node_modules\react-native\src\private\specs_DEPRECATED\components\
  DebuggingOverlayNativeComponent.js:
Unsupported param type for method "highlightTraceUpdates", param "updates".
Found ReadonlyArray
```

`apps/mobile` pins `react-native@0.81.5`. RN 0.81's codegen cannot parse RN 0.86's newer spec
syntax, and Metro's codegen scans every react-native copy its file watcher can see — not only
the one the app's import graph resolves to.

**Error 2.** With error 1 excluded, the bundle built and the app rendered far enough to throw a
React error instead:

```
Render Error
useLinkPreviewContext must be used within a LinkPreviewContextProvider.
This is likely a bug in Expo Router.
```

The classic signature of two copies of the same package: a component rendered under provider
instance A calls hook instance B, so B's context is empty. Expo Router's own error text guesses
wrong about the cause — it is not a bug in Expo Router.

## Root cause (proven)

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

`apps/mobile` pins `@expo/metro-runtime` to `~6.1.2`, so that one resolves correctly. It never
declares `@expo/dom-webview` at all — so pnpm resolved that unbounded `"*"` to the newest
published release, **57.0.1**, an Expo SDK 57 package. That single package dragged in an entire
parallel SDK 57 tree beside the SDK 54 tree the app actually targets: `expo@57.0.15`,
`expo-router@57.0.15`, `@expo/metro-runtime@57.0.12`, `@expo/log-box@57.0.3`, `@expo/ui@57.0.12`,
`react@19.2.3`, `react-native@0.86.2`, and ~40 more `expo-*@57` packages.

Verified with `pnpm why expo --filter @forjd/mobile` (resolves `expo@54.0.37` correctly, with
the 57 tree hanging entirely off the one unbounded peer) and by reading `expo@54`'s own
`package.json` directly.

**Ruled out as the cause, each checked rather than assumed:** `eas-cli` (its Expo deps are all
SDK-54-era or older); `drizzle-orm`'s optional peer on `expo-sqlite` (a real second-order
contributor to a duplicate `expo-sqlite`, but not the origin of the SDK 57 tree); anything in
`apps/api` or `packages/*` (none declare expo or react-native at all).

**Pre-existing, not introduced by Phase 2 work** — confirmed by diffing `pnpm-lock.yaml` at the
Phase B commit: `react-native@0.86.2` was already present beforehand.

## The fix that was merged, and why one change closed both errors

`apps/mobile/metro.config.js` — a `resolver.blockList` entry excluding every react-native copy
except the pinned `0.81.5`:

```js
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList]),
  /node_modules[\\/]\.pnpm[\\/]react-native@(?!0\.81\.5)/,
];
```

This was written to fix error 1 only. **It turned out to fix error 2 as well**, and the most
likely mechanism — checked, not just assumed — is that `expo-router@57.0.15` itself declares
`react-native: "*"` as a peer dependency:

```jsonc
// node_modules/.pnpm/expo-router@57.0.15_.../node_modules/expo-router/package.json
"peerDependencies": { "react-native": "*", ... }
```

Blocking every non-`0.81.5` react-native copy makes anything that needs to resolve
`react-native` from *inside* the stray SDK 57 subtree fail to resolve — which plausibly makes
the whole `expo-router@57` instance (and whatever pulled it in reachably, most likely
`@expo/log-box`'s dev-tools overlay, which is where an experimental Link Preview feature
specific to newer Expo Router lines would plausibly live) unloadable, rather than only
`react-native` itself. **This causal chain is inferred from the evidence, not independently
isolated** — the pnpm-overrides approach that would have proven or disproven it directly (see
below) was reverted before that could be confirmed.

Also confirmed necessary, by testing the alternative and having it fail: `config.watchFolders`
**must stay `[workspaceRoot]`**. Narrowing it to just `packages/domain` + `packages/contracts`
broke module resolution outright (`Unable to resolve module .../expo-router/entry.js`) — pnpm's
virtual store lives at the workspace root. Confirmed by running a real Metro export, not
assumed.

## What was tried and reverted — do not repeat without reading this

A `pnpm-workspace.yaml` `overrides` block pinning the unbounded peers directly:

```yaml
overrides:
  "@expo/dom-webview": "0.2.8"        # last pre-SDK-renumbering release (55.x+ are SDK-aligned)
  "@expo/metro-runtime": "~6.1.2"
```

**It worked at the dependency-resolution level and still failed at runtime.** After it,
`pnpm why --filter @forjd/mobile` reported single correct versions for all three packages. But:

1. The device error was reportedly unchanged at the time (tested before the Metro blockList
   fix's full effect was understood; the 57.x copies also remained physically present in
   `node_modules/.pnpm`, accumulated from earlier installs).
2. **It broke 39 of 61 mobile test suites** (was: all green) with
   `Invariant Violation: __fbBatchedBridgeConfig is not set, cannot invoke native modules`,
   thrown from `expo-router/testing-library` -> `expo-modules-core`. Pinning `@expo/dom-webview`
   to `0.2.8` evidently disturbs something `jest-expo`'s native-module mocking depends on.

Reverted in full. Mobile tests confirmed green again afterward, and the `metro.config.js`
blockList — kept — was independently confirmed (61/61 suites, 251/251 tests) not to have this
side effect.

## The other cause of that session's specific symptom — unrelated, don't confuse the two

Separately from the dependency-duplication bug above, the same debugging session also hit a
**"request timed out"** connecting from the phone. That had nothing to do with any of the
above: **the dev server was simply not running** (nothing listened on port 8081). Once
restarted, a second, unrelated problem surfaced — `.claude/launch.json`'s `--offline` flag was
briefly swapped for `--host lan`, which broke startup entirely, because `--offline` exists
specifically to skip an Expo CLI dependency-validation step that throws
`TypeError: Body is unusable: Body has already been read` on Node 24. The two flags cannot be
combined (`CommandError: Specify at most one of: --offline, --host, --tunnel, --lan,
--localhost`). The working invocation is `EXPO_OFFLINE=1` as an environment variable alongside
`--host lan`, which `.claude/launch.json` now uses (`env: { "EXPO_OFFLINE": "1" }`,
`runtimeArgs` without `--offline`).

## If this regresses — the ranked options that remain

1. **Declare `@expo/dom-webview` directly in `apps/mobile/package.json`**, at the version
   `expo@54` actually expects (find it via `npx expo install @expo/dom-webview`), the same shape
   of fix as the already-correct `@expo/metro-runtime: ~6.1.2`. This is the fix that should
   have worked as an `overrides` block and didn't — declaring it as a direct dependency instead
   of a workspace-wide override is untried and may behave differently.
2. **A genuinely clean store.** Delete `node_modules` and `pnpm-lock.yaml` and reinstall from
   scratch. Every attempt so far reinstalled over an existing store; stale 57.x directories
   persisted throughout every attempt, including the one that ended up working.
3. **Upgrade to Expo SDK 57.** Contradicts ADR-013's reasoning for pinning SDK 54 (Expo Go ships
   one SDK version at a time) — only viable once Expo Go itself ships 57.

## How to reproduce a check

```powershell
cd apps/mobile
$env:EXPO_OFFLINE = "1"
npx expo start --host lan
```

Never combine `--offline` and `--host` as CLI flags — use the env var instead.

```powershell
# Inspect the duplication directly -- still present in the store even though unreachable.
pnpm why expo --filter @forjd/mobile
pnpm why expo-router --filter @forjd/mobile
```

**Any future dependency change here must keep the mobile suite green** — that is precisely
what the reverted attempt failed:

```powershell
pnpm --filter @forjd/mobile test --ci
```

Never run it at the same time as the API suite; they starve each other and report false
failures.
