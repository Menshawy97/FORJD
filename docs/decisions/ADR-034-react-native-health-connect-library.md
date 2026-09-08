# ADR-034: `react-native-health-connect` is the Android Health Connect library

**Status:** Accepted
**Date:** 2026-09-08
**Supersedes:** CLAUDE.md rule 17 and `docs/architecture/integrations.md`'s naming of the
pub.dev `health` package as the implementation behind `HealthProvider`. That was Flutter-era
text predating ADR-013/ADR-027's move to Expo/React Native and was never corrected — there is
no RN equivalent of that package, and nothing named it until this ADR.

## Context

Phase 6 plan decision 3 named this an unresolved fork blocking slices 6E/6F: FORJD's docs
still prescribed a Flutter-only package for a codebase that has been Expo/React Native since
ADR-013/ADR-027. 6E (the `HealthProvider` interface + contract tests) does not itself need a
concrete library — it is written against `integrations.md`'s interface, provider-agnostic by
design — but 6F (the actual Health Connect adapter) does, and the plan required this decision
be made explicitly, with the user's input, before either slice's provider code lands, rather
than assumed.

Researched this session: the current options for reading Android Health Connect data from an
Expo/React Native app, evaluated against FORJD's actual metric list
(`packages/domain/src/health-vocabulary.ts`'s `HEALTH_METRIC_TYPES`, which includes sleep
*stages*, not just sleep duration) and CLAUDE.md's New Architecture requirement.

## Decision

**`react-native-health-connect`** (matinzd), MIT-licensed, npm + GitHub.

- Actively maintained: latest release (4.1.3, at research time) was one month old, 252
  commits, New Architecture (Fabric/TurboModules) support stated explicitly in its own docs.
- Covers every metric type in `HEALTH_METRIC_TYPES`, including `SleepSessionRecord`'s `stages`
  array — actual sleep-stage segments, not just a duration total, which is what ADR-031's
  readiness methodology depends on.
- Thin wrapper over Android's own official Health Connect Kotlin SDK, so it exposes whatever
  that SDK exposes rather than an independently-maintained reimplementation.

**Alternatives considered and rejected:**
- `expo-health-connect` — deprecated/archived; folded into `react-native-health-connect` v4.
  Installing both breaks the Android build (duplicate Kotlin class).
- `react-native-health`, `react-native-health-kits`, `react-native-health-link` — HealthKit
  (iOS)-focused or thin unified wrappers with unclear/weaker Health Connect and sleep-stage
  support; none showed comparable maintenance activity or record-type coverage.
- A custom native module wrapping the Health Connect Kotlin SDK directly — rejected as
  redundant work: `react-native-health-connect` already *is* that thin wrapper, with New
  Architecture support and an Expo config plugin already built. Revisit only if a future
  Health Connect SDK release exposes something this library hasn't wrapped yet.

**Scope note, explicit per the user's own question this session:** this ADR is Android-only.
Apple Health/HealthKit is a separate system reached through a separate library, decided in a
separate ADR when Phase 11 (the iOS track, ADR-007) starts. Nothing here presumes that choice.

## Consequences

- CLAUDE.md rule 17 and `docs/architecture/integrations.md` are corrected in this same PR to
  name `react-native-health-connect` and Expo/React Native, not the pub.dev `health` package
  and Flutter.
- `apps/mobile`'s Health Connect adapter (6F, not this ADR) needs a **custom dev client**, not
  Expo Go — `npx expo prebuild` plus an EAS or local dev build. This is standard for any native
  module on this project already (`expo-sqlite`, `expo-secure-store`, etc. all require it);
  nothing new about the *shape* of the requirement, only a new native dependency triggering it.
- Before Health Connect ships to real (non-developer) users, Google requires a Play Console
  health-data-access declaration and review, roughly 1-2 weeks — a Phase 8 (privacy & beta
  prep) or later concern, not something 6E/6F need to resolve now.
- `scripts/ci/check-architecture-conformance.sh` gets a new rule in 6E (added ahead of the
  adapter that could violate it, per the phase plan): `react-native-health-connect` may only
  be imported from `apps/mobile/src/integrations/health/`.
- The package is not installed as part of this ADR or 6E — 6E's `HealthProvider` interface and
  contract-test suite are provider-agnostic and add no dependency. Installing it and writing
  `HealthConnectProvider` is 6F's job, and 6F remains device-gated per CLAUDE.md rule 16
  regardless of this decision.

## Related

- [`ADR-003-health-provider-abstraction.md`](ADR-003-health-provider-abstraction.md) — the interface this library implements.
- [`ADR-007-no-mac-ios-toolchain.md`](ADR-007-no-mac-ios-toolchain.md) — why Android/Health Connect ships before iOS/HealthKit.
- [`ADR-031-readiness-score-methodology.md`](ADR-031-readiness-score-methodology.md) — why sleep-stage data specifically was a hard requirement on this choice.
- [`../product/phase-6-plan.md`](../product/phase-6-plan.md) — decision 3, which this ADR resolves.
