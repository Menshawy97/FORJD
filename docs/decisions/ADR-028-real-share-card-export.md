# ADR-028 — Real image export on both share screens, via a dev-client build

- **Status**: Accepted
- **Date**: 2026-09-05
- **Phase**: post-3K follow-up
- **Relates to**: overturns the scope reduction recorded in `nutrition-share.tsx`'s own docblock
  and in `workout-share.tsx`'s; settled the open question in
  [`../product/live-screen-device-findings.md`](../product/live-screen-device-findings.md)

## Context

Both share screens' Save Image / Instagram / More buttons only show a toast. `nutrition-share.tsx`
records this as a deliberate scope reduction from when it shipped: "real device capture/sharing is
out of scope for this lowest-priority phase, not a bug to silently 'fix' by reaching for new native
permissions." The user has since asked for it to actually work, on both screens together — which is
exactly what CLAUDE.md means by "add a new ADR before overturning one."

The open question the earlier note left unanswered: capturing a view as an image needs
`react-native-view-shot`, which is **not** one of the modules bundled into the Expo Go client.
Unlike `expo-media-library` and `expo-sharing` (both genuine Expo SDK packages, present in Expo
Go), `react-native-view-shot` is a third-party native module. Requiring it means this app can no
longer be tested day-to-day in the plain Expo Go client — it needs a **development build**
(`expo-dev-client`), a custom app built once via EAS/Codemagic and reinstalled only when a native
dependency changes.

This is not a cost-free decision for a project whose whole device-testing strategy (ADR-013) has
been "Expo Go, no Mac required." It was put to the user directly, including what a dev-client
switch costs in practice:

- **No new paid service.** Android dev-client builds are free and fully local
  (`eas build --local` or plain Gradle). iOS goes through the same EAS/Codemagic pipeline
  ADR-007 already uses for TestFlight — it is spending from the same free allowance, not adding a
  second one.
- **Rebuilds are rare, not per-edit.** A new build is only needed when a *native* dependency
  changes. Day-to-day JS/TSX work still hot-reloads through the dev client exactly like Expo Go.
- **The one real limit** is EAS's free monthly build cap, which is unlikely to bite for a project
  that only rebuilds on native-dependency churn.

## Decision

**Add `expo-dev-client`, `react-native-view-shot`, `expo-media-library`, and `expo-sharing`, and
move day-to-day mobile testing from Expo Go to a development-client build.** `eas.json` already
had an unused `development` build profile from initial project scaffolding; this is the first
feature to actually use it.

Both share screens wrap their preview card in a `ViewShot`. **Save Image** captures the card and
writes it to the device's photo library via `expo-media-library`. **Instagram** and **More** both
open the OS share sheet via `expo-sharing`'s `shareAsync` — there is deliberately no
Instagram-specific deep link (`instagram://library?LocalIdentifier=...`). That scheme is
iOS-only, requires the image to already be a saved Photos asset with a local identifier, and has
no Android equivalent — building it would mean a platform-asymmetric special case for one button
label. The OS share sheet already lists Instagram (and every other installed app that accepts an
image) as a target, so tapping "Instagram" and picking Instagram from the sheet reaches the same
place with one implementation instead of two.

## Consequences

**`apps/mobile/AGENTS.md`'s testing loop changes.** It currently says the app is developed and
tested via Expo Go against a pinned SDK. That note now needs to say "a development-client build"
instead — the SDK-pinning discipline ADR-013/ADR-027 established is unchanged, only the client
app on the test device is different.

**Capture and permission failures are real states, not edge cases.** `MediaLibrary`'s permission
can be denied, `ViewShot.capture()` can fail if the ref is not yet mounted, and `Sharing` can be
unavailable on a simulator. Each screen surfaces a specific toast for a permission refusal versus
a generic failure, the same distinction `nutrition-share.tsx`'s existing camera/gallery permission
handling already makes.

**Both screens share one capture/save/share module**, `src/share/capture.ts`, so the two paths
cannot drift the way this ADR's own context warns against — nutrition's card gaining real export
while the workout card's stayed mocked (or the reverse) is the divergence this ADR exists to
prevent.

**A physical-device walk is mandatory before this ships**, for the same reason ADR-026's own
notification code required one: Jest has no native `react-native-view-shot` implementation to
exercise, so nothing about actual pixel capture, the Photos permission prompt, or the share sheet
opening can be proven by a unit test. Unverified until that walk: that the saved image actually
matches the visible card (not a blank or stale frame), and that the OS share sheet lists Instagram
when it is installed.

## Alternatives considered and rejected

- **Server-side card rendering** (e.g. rendering the card as an image on the API and returning a
  URL to share) — rejected: it would mean building an entire second rendering pipeline duplicating
  the RN layout, just to avoid a client-side capture library, and it would put a purely
  presentational artifact through a network round-trip that has no other reason to exist.
- **A platform-specific Instagram deep link** — rejected above; asymmetric and duplicative of what
  the share sheet already offers.
- **Keeping Expo Go and leaving the buttons mocked indefinitely** — this was the status quo the
  user explicitly asked to change.
