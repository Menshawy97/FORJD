# Expo SDK is pinned to 57 — do not upgrade without reading ADR-027 first

`apps/mobile` targets **Expo SDK 57** (`expo: ~57.0.20`, `react-native: 0.86.3`, `react: 19.2.3`),
deliberately — see `docs/decisions/ADR-027-expo-sdk-57-upgrade.md`, and ADR-013 for why this app
follows Expo Go's SDK at all.

Expo Go on the App Store ships a **single SDK version at a time**, and scanning an
SDK-mismatched bundle fails outright. That is the entire reason this app tracks whatever SDK
Expo Go currently ships rather than the newest Expo release — and it is why the pin moves when,
and only when, the installed Expo Go moves. It moved from 54 to 57 on 2026-09-05 because Expo Go
on the development iPhone was updated to 57, which made every SDK 54 bundle unloadable.

**Do not "helpfully" bump toward a newer SDK** (58, or whatever is newest when you read this).
Read the versioned docs that match the pin, `https://docs.expo.dev/versions/v57.0.0/`, before
writing code that touches Expo APIs. An SDK upgrade is a deliberate decision requiring an ADR,
not a default — and in practice the trigger is always the same: the Expo Go client on the test
device changed.

## Two things that bite on every upgrade

**The Metro blockList pin.** `metro.config.js` excludes every `react-native@*` copy in pnpm's
shared store except the app's own, because Metro's codegen scans all of them and a mismatched
copy's spec syntax can crash Expo Go from a package this app never imports. That version is now
**derived from `package.json`**, not hardcoded. It used to be a literal `0.81.5`, and the SDK 57
upgrade silently turned it into a filter that excluded the app's own react-native — the one copy
it must never exclude. Leave it derived.

**A stray SDK tree can resolve alongside the pinned one.** An unbounded optional peer
(`expo@54`'s `@expo/dom-webview: "*"`) once pulled a whole SDK 57 tree in beside pinned SDK 54 —
see `docs/product/expo-go-duplicate-sdk-tree.md` for the incident. After any dependency change,
check that only one `react-native@*` and one `expo@*` are actually reachable.

## Verifying an upgrade

A green `tsc --noEmit` and a green Jest run are **not** sufficient. Jest does not compile
NativeWind or native modules, so it cannot tell you the bundle builds. Run a real Metro export
(`npx expo export --platform ios`) and then load the app on the physical device before calling
an upgrade done.
