# ADR-013: Expo React Native replaces Flutter for the mobile client

**Status:** Accepted
**Date:** 2026-08
**Supersedes:** ADR-001

## Context

ADR-001 chose Flutter, and slice 11 shipped real Flutter code on top of it: auth
screens, a 5-tab shell, profile/edit-profile, the ADR-010 design-token theme, an
offline-capable Drift(SQLite) local DB, and 69 passing tests wired into CI.

A design handoff (`FORJD mobile app design/design_handoff_forjd_mobile/`) then
arrived covering 41 screens across the rest of the product. Implementing it is a
long, screen-heavy phase of work, and the development loop for that phase turns
out to matter more than it did for slice 11's five screens.

Development happens on Windows, with no Mac owned or rented (ADR-007). Under
Flutter, the only way to see a change on the physical iPhone is Codemagic → cloud
build → TestFlight install — ADR-007 itself records this as "iOS iteration speed
is a CI build (~5-15 min) plus a TestFlight install, not a hot reload... changes
are batched into meaningful chunks rather than tested one file edit at a time."
That's an acceptable cost for a handful of iOS-specific bridge changes; it's a
poor cost to pay for implementing 41 screens of UI, where the whole value of fast
iteration is seeing layout/spacing/copy changes immediately.

Expo Go removes that cost entirely for pure-JS changes: no build, no signing, no
Xcode, no Mac — scan a QR code once, then every save hot-reloads on the physical
device in about a second. This is strictly better than the floor ADR-007 assumed,
for the specific phase of work about to start.

## Decision

The mobile client moves to **Expo (React Native) + TypeScript**, replacing
Flutter. `apps/mobile` (Flutter) is deleted in the same change that scaffolds the
new Expo app at the same path — this is not a parallel migration; there is no
period where both apps coexist as live targets.

The 69 existing Flutter tests are not ported. The new app starts its test suite at
zero and builds it test-first per the project's standing TDD rule, one phase of
functionality at a time.

## Rationale

- **The no-Mac constraint is decisive, not marginal.** It's a first-class
  constraint recorded in root `CLAUDE.md` and the reason ADR-007 exists at all.
  Expo Go's zero-build loop is a materially better fit for it than anything
  Flutter+Codemagic offers, specifically during a screen-implementation phase.
- **The abstraction seams already in place absorb the pivot.** ADR-008
  (`AuthProvider`/`StorageProvider`) and ADR-012 (local JWT verification) are both
  backend-side seams — this pivot is invisible to them, which is exactly what
  those ADRs were for. No backend change is required by this ADR alone.
- **The rest of the tradeoff is closer than it looks, not a clear loss.**
  Flutter's `health` package (HealthKit + Health Connect in one wrapper) is more
  mature than RN's equivalent, but the app already commits to hiding either one
  behind its own `HealthProvider` interface (CLAUDE.md rule 3), so the wrapping
  work is comparable either way. Drift's compile-time-checked SQL doesn't have a
  direct RN equivalent, but `drizzle-orm/expo-sqlite` keeps the same query/schema
  mental model the backend (`apps/api`) already uses with Drizzle — one ORM
  concept across the stack instead of two, which the Flutter app never had.
- **`packages/domain` and `packages/contracts` become directly consumable.** They
  are plain TypeScript/Zod. Under Flutter they required hand-written Dart mirror
  DTOs (see ADR-010's "hand-written DTOs can drift... nothing enforces the
  correspondence" — a documented open risk). Under Expo the mobile app imports
  the same packages the API does, closing that drift risk structurally rather
  than by convention.
- **NativeWind over plain `StyleSheet.create`.** 41 screens is enough repeated
  layout code that utility classes meaningfully cut boilerplate; NativeWind v4
  compiles to `StyleSheet` objects at build time so there's no runtime cost.
  `tailwind.config.ts` is configured with the design's exact token values
  (colors, Archivo type scale, spacing, radii — transcribed from
  `02-design-tokens.md`), which preserves ADR-010's "write exact values, no
  derived/seeded theme" intent rather than reopening that argument for RN.

## Consequences

- The 69 Flutter tests, the Drift schema, and the hand-written DTO layer are all
  deleted, not migrated. RN test coverage starts from zero and is rebuilt
  test-first, phase by phase, alongside the screens.
- CI's `mobile` job (`.github/workflows/ci.yml`) and the two Flutter-specific
  greps in `scripts/ci/check-architecture-conformance.sh` need RN-targeted
  replacements — see the implementation plan for slice 1.
- Once a screen needs a native module outside Expo Go's managed sandbox (first
  expected in the HealthKit/Health Connect work), the app moves to EAS Build for
  that flow specifically — see the ADR-007 amendment. This doesn't reopen the
  no-Mac question; EAS Build is a no-Mac cloud build, same as Codemagic was.
- ADR-006 (InBody extraction vendor) is reversed separately, in ADR-014 — that
  decision is about AI vendor choice, not mobile framework, and is unrelated to
  this ADR's reasoning.
- ADR-010 and ADR-011 need their storage/mechanics sections rewritten for RN
  (token module, `expo-secure-store`, axios instead of Dio) — their *values* and
  *rationale* carry over unchanged; see the amendment notes added to each.
