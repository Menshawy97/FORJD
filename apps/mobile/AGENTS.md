# Expo SDK is pinned to 54 — do not upgrade without reading ADR-013 first

`apps/mobile` targets **Expo SDK 54** (`expo: ~54.0.37`, `react-native: 0.81.5`), deliberately —
see `docs/decisions/ADR-013-expo-react-native.md`. Expo Go on the App Store ships a single SDK
version at a time; scanning an SDK-mismatched bundle with an older Expo Go client fails
outright, which is the entire reason the app follows whatever SDK Expo Go currently ships
rather than the newest Expo release.

**Do not "helpfully" bump toward a newer SDK** (57, or whatever is newest when you read this).
An unbounded optional peer dependency (`expo@54`'s `@expo/dom-webview: "*"`) once let a stray
SDK 57 tree get resolved alongside the pinned SDK 54 one — see
`docs/product/expo-go-duplicate-sdk-tree.md` for the full incident. Read the versioned docs
that match the pinned version, `https://docs.expo.dev/versions/v54.0.0/`, before writing code
that touches Expo APIs. If a genuine SDK upgrade is ever needed, that is a deliberate decision
requiring a new ADR, not a default.
