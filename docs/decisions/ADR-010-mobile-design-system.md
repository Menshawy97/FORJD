# ADR-010: The mobile design system is dark-only, token-driven, and self-contained

**Status:** Accepted — values and rationale below stand. **Mechanics amended by
ADR-013** (2026-08): the mobile client moved from Flutter to Expo React Native,
so the *implementation* of these tokens changed while the *values and reasoning*
did not. `AppColors`/`AppText`/`AppDimens` Dart classes → a `tailwind.config.ts`
`theme.extend` block (NativeWind) holding the identical values, transcribed
straight from the same design-token source; `path_drawing`-stroked SVG icons →
`react-native-svg` rendering the same 24 raw path strings, synchronously, same
"a transcription error fails the build rather than rendering an invisible icon"
test requirement; Archivo bundled via `assets/fonts/` + `expo-font`, same
no-network-fetch-for-a-login-screen rationale carried over unchanged; hand-written
DTO mirrors are no longer needed at all — the RN app imports
`packages/contracts` (Zod) directly, closing the "hand-written DTOs can drift...
nothing enforces the correspondence" risk this ADR flagged as an open follow-up.
**Date:** 2026-08

## Context

Slice 11 was scoped as "mobile auth UI". The screens it needed had been designed in a
Claude Design project, `FORJD Mobile` — a dark, typography-led system built on Archivo,
near-black `#08090a`, and an orange `#e9712f` accent, with 40+ screens covering phases well
beyond this one.

The app was on a Material 3 theme seeded from a single green, `Color(0xFF1B5E20)`, and had
no text styles, no spacing constants, no shared widgets, and no icons. The two shared
nothing. Building slice 11's five screens against the existing theme would have meant
building them a second time the moment the design was adopted, so the tokens had to land
first or not at all.

A second question came with it: how much of a design system to build for five screens. The
answer is shaped by what comes next — every phase from 2 onward adds screens to this same
system, and the primitives here (button, field, row, chips, tab bar) are the ones those
screens are drawn from.

## Decision

The design's tokens and primitives are transcribed into `lib/core/theme/` and
`lib/core/widgets/`, and the app becomes dark-only. Specifically:

- **Three token classes plus a theme.** `AppColors`, `AppText`, `AppDimens` hold the raw
  values; `AppTheme.dark` assembles a `ThemeData` from them.
- **`AppTheme.light` is deleted**, and `MaterialApp` sets `theme`, `darkTheme` and
  `themeMode: ThemeMode.dark`.
- **`ColorScheme.dark` is written out field by field**, never derived with `fromSeed`.
- **Archivo is bundled** at `assets/fonts/Archivo-Variable.ttf` (SIL OFL 1.1, licence
  committed beside it), not fetched by `google_fonts`.
- **Icons keep the design's SVG path data** and are stroked in a `CustomPainter` using
  `path_drawing`.
- **DTOs are hand-written mirrors** of the Zod contracts rather than generated.

## Rationale

**Dark-only, with light deleted rather than left behind.** A light theme nobody has
designed is not free: `MaterialApp` will render it for anything Material builds around the
router, so the cost of keeping it is an occasional unbranded flash rather than a tidy unused
getter. Deleting it makes the absence explicit and a compile error rather than a surprise.

**Written-out `ColorScheme`, not `fromSeed`.** Seeding re-derives every slot tonally. Feed
it `#e9712f` and the surfaces, containers and outlines that come back are Material's
interpretation, not the design's values — the palette would be *inspired by* the design
rather than *be* it. Writing all twenty-odd slots is more lines and exactly reproducible.

**The split between `ThemeData` and token classes.** `ThemeData` carries anything Material
constructs on its own — dialogs, snackbars, the text cursor, the ripple, and in particular
`InputDecorationTheme`, so a plain `TextField` is already correct and no screen restates the
design. The token classes carry what only FORJD's own widgets use, such as the `#77776f`
label grey that has no `ColorScheme` slot at all. Using only one of the two would mean
either unstyled Material surfaces or contorted mappings for colours Material has no concept
of.

**Bundled Archivo over `google_fonts`.** `google_fonts` fetches from `fonts.gstatic.com` at
first render. That is a third-party network call to draw the login screen of a health app,
which runs against the spirit of CLAUDE.md rule 15; it introduces a fallback-font flash on
first launch that is very visible in a typography-led design; and it makes any
layout-sensitive test depend on CI having network. Bundling costs ~650 KB and a licence
file, and is deterministic offline.

Upstream publishes only a variable face, so weight is selected through the `wght` axis via
`fontVariations`. Every style sets both that and `fontWeight` — the axis moves the rendered
weight, `fontWeight` governs the fallback face. `AppText.weighted` exists because a bare
`copyWith(fontWeight:)` changes one and silently leaves the other, which looks like a no-op
rather than a bug.

**`path_drawing` over `flutter_svg` or Material icons.** Material icons are already bundled
and cost nothing, but they are filled and Material-shaped; substituting them would break a
design whose identity *is* its thin-stroke iconography. `flutter_svg` is heavier, wants
whole SVG documents rather than the 24 bare path strings the design provides, and loads
asynchronously — widget tests would need `pumpAndSettle` and could catch an empty frame.
`path_drawing` is pure Dart with no platform channel, is the same parser `flutter_svg` uses
internally, and renders synchronously. A test parses all 24 paths, so a transcription error
fails the build rather than rendering an invisible icon.

**Hand-written DTOs.** Five small classes did not justify adding `freezed` and
`json_serializable`, a second `build_runner` builder alongside Drift, and the CI time that
comes with them.

**One deliberate addition to the design.** Inputs get a 1px accent `focusedBorder`. The
design specifies no focus state, and an invisible keyboard focus ring is an accessibility
regression rather than a stylistic choice.

## Consequences

- Every screen from Phase 2 onward composes these primitives. Adding a screen should mean
  adding a layout, not adding colours.
- There is no light mode, and adding one later means designing one — not flipping a flag.
- The hand-written DTOs can drift from `packages/contracts/src/index.ts` silently. Nothing
  enforces the correspondence. **Generating them from the Zod schemas is an open follow-up**,
  recorded in the roadmap; until then, the contract is the source of truth and changes go
  there first.
- Letter-spacing is converted from the design's CSS `em` to logical pixels by multiplying by
  font size. The arithmetic sits in a comment beside each value, because a mis-converted
  `em` is the single most likely way for the type scale to look plausible and render wrong.
- No golden tests. `flutter test` substitutes Ahem for bundled fonts, so goldens would need
  an explicit `FontLoader` — a separate decision, not a free addition.
- The APK grows ~650 KB for the font.
