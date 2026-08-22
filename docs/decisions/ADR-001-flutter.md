# ADR-001: Flutter for the mobile client

**Status:** Superseded by ADR-013 (2026-08) — mobile client moved to Expo React Native.
**Date:** 2026-08

## Context

FORJD needs a single mobile client shipping to both iOS and Android, with an
offline-first live-workout experience, native health-platform integrations
(HealthKit, Health Connect), and a solo/small-team maintenance budget.

Native (Swift + Kotlin, two codebases) gives the best platform fidelity but
roughly doubles UI implementation and maintenance work — not viable at 12
hrs/week solo. React Native was considered; Flutter was chosen instead.

## Decision

Build the mobile client in Flutter, with a thin native layer only where a
Dart package cannot reach the platform API (see ADR-007 for how this applies
to HealthKit specifically).

## Rationale

- One codebase, one state-management approach, one test suite across iOS and Android.
- Mature offline-first story (Drift for local SQLite) that a live workout session
  depends on (see `docs/architecture/workout-engine.md`).
- Maintained community packages exist for both target health platforms
  (`health` package — see ADR-007), reducing native bridge code to near zero
  at the start.
- Development happens on Windows (see ADR-007) — Flutter's tooling is fully
  functional there; native iOS development is not.

## Consequences

- Any platform capability without a Flutter plugin requires a small
  platform-channel bridge, written by whoever has access to that platform's
  toolchain at the time (native Kotlin is straightforward on Windows; native
  Swift requires the workflow described in ADR-007).
- UI will not have pixel-perfect platform-native widgets by default; the
  design system (see design brief in the source planning docs) is built once
  in Flutter and applied to both platforms rather than per-platform HIG/Material
  fidelity.
