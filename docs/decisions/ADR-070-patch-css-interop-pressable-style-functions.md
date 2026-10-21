# ADR-070: Patch react-native-css-interop so Pressable style functions survive

**Status:** Accepted (2026-10-21).
**Scope:** `apps/mobile`, iOS and Android. A pnpm patch to `react-native-css-interop@0.2.6`, NativeWind 4.2.6's
runtime: `patches/react-native-css-interop@0.2.6.patch`, registered under `patchedDependencies` in
`pnpm-workspace.yaml`.

## Context

The production smoke test (2026-10-20) found the avatar camera badge rendered as a bare icon on device. #433 fixed
that badge by giving it a plain style object. The same cause was suspected app-wide, and was confirmed on the
emulator on 2026-10-21 against the production APK. Holding a press on Welcome's **Create Account** (`pressScale`)
did not shrink it, and holding **Log In** (`pressGhost`) gave no highlight. Releasing still navigated, so the press
itself registered.

The cause is in css-interop's native runtime (`dist/runtime/native/native-interop.js`). NativeWind registers
`Pressable` with `cssInterop(Pressable, { className: "style" })`, so every `Pressable` renders through the interop,
with or without a `className`. The interop treats the `style` prop as inline styles to merge with the className
styles. `collectInlineRules` pushed a style *function* into the rule list, and `applyRules` spread it into the
result (`{ ...fn }`, which is `{}`). The final `style` was an object, so React Native's `Pressable` never called the
function, and `pressed` never reached it.

This affected every press-feedback style in the app: `pressScale` and `pressGhost`
(`apps/mobile/src/components/press-feedback.ts`, about 58 call sites) and about 20 inline
`style={({ pressed }) => ...}` functions. Their resting look comes from `className`, so nothing looked broken until
someone pressed a button.

Jest never caught it. `wrap-jsx` loads css-interop's component registrations only when `NODE_ENV !== "test"`, so in
tests `Pressable` is React Native's own, and its style function works.

The runtime has no `Platform` branch, and the same `*.native.js` files load on iOS and Android. So the bug, and the
fix, are the same on both.

## Options

1. **Move every call site to NativeWind's `active:` classes** (`active:scale-[0.985]`, `active:bg-...`).
   NativeWind supports these on `Pressable`. But that means editing about 80 call sites, adding Tailwind tokens for
   every pressed colour that is a `colors.*` value today, and keeping a rule nobody can lint for: "never pass a
   style function to a Pressable". The next one written would fail silently again.
2. **An app-level replacement for the `Pressable` interop.** Swap the entry in css-interop's `interopComponents` map
   for a wrapper that tracks `pressed` itself. That depends on internal module load order: `components.js` is
   loaded lazily on the first JSX call and would overwrite an entry set earlier. It also duplicates Pressable's own
   pressed state.
3. **Patch the interop to keep a style function** (chosen). About 20 lines in one file. When the inline `style`
   is a function, `collectInlineRules` skips it, and `interop()` passes the component
   `(state) => [classNameStyles, fn(state)]`. The className styles sit underneath, as inline styles always did, and
   React Native's `Pressable` calls the function with its own `pressed`.

## Decision

Option 3. Every existing call site works unchanged, and the fix covers style functions on any component the interop
wraps.

Two limits, documented in the patch:
- A component that css-interop upgrades to a Reanimated component (a className with `animate-*` or `transition-*`)
  still loses a style function, because its style has to be an object for `useAnimatedStyle`. No `Pressable` in
  the app uses those classes today.
- A style function's result now beats a className's `!important` styles. Nothing in the app combines the two.

## Consequences

- `apps/mobile/src/components/__tests__/pressable-style-function.test.tsx` loads css-interop's real component
  registrations, so `Pressable` renders through the patched interop in Jest. It fails without the patch. #433's
  badge tests stay as they are; they still pass.
- **Upgrading NativeWind or css-interop:** pnpm refuses to install if the patched version no longer matches.
  Re-check `native-interop.js` upstream, carry the patch forward or drop it if it's fixed there, and re-run the test
  above.
- Checked on the Android emulator with a production APK. iOS runs the same JavaScript, but per rule 16's spirit it
  gets a look on the TestFlight iPhone when the next iOS build goes out: hold a primary button and check that it
  shrinks.
