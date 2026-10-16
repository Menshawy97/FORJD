# ADR-068: The Apple Health (HealthKit) library

**Status:** Accepted (2026-10-16, owner). Proposed 2026-10-15. Nothing is installed yet: the provider is
slice 5 of [ios-no-account-plan.md](../product/ios-no-account-plan.md), which merges it switched off under a
rule 16 exception ADR written first. CLAUDE.md rule 17 and `integrations.md` name the library in that slice.
**Scope:** iOS only. The Android counterpart is ADR-034 (`react-native-health-connect`). CLAUDE.md
rule 17 and ADR-034 both reserved this choice for its own ADR when Phase 11 (the iOS track) starts.

## Context

FORJD reads health data through the `HealthProvider` interface (ADR-003). On Android that is
`HealthConnectProvider` over `react-native-health-connect`. iOS needs an `AppleHealthProvider` behind
the same interface, and that needs a library that reaches HealthKit from this app:

- **Expo SDK 57, React Native 0.86** (ADR-027). The New Architecture is always on in this React Native
  version; a library that only works through the old bridge is out.
- **No Mac** (ADR-007): every iOS build happens in the cloud, so a library must ship an Expo config
  plugin that sets the HealthKit entitlement and the purpose strings. Hand-editing an Xcode project is
  not possible here.
- **What FORJD reads** (`HEALTH_METRIC_TYPES` in `packages/domain/src/health-vocabulary.ts`): heart rate
  and active energy during a run (R8, ADR-050), and for readiness (ADR-031) HRV, resting heart rate,
  sleep with its four stages, respiratory rate, steps, weight and VO2 max. Read only; FORJD writes
  nothing to HealthKit.
- **Incremental sync:** the provider should fetch only what is new since the last sync (HealthKit's
  anchored queries), the same way the Android side pages through Health Connect.

Researched 2026-10-15 from the libraries' GitHub pages, npm and release notes. No library's docs name
Expo SDK 57 specifically, so compatibility is a check to do (below), not a fact yet.

## Options

| | `@kingstinct/react-native-healthkit` | `react-native-health` (AE Studio) | Meter-Health fork of `react-native-health` | Small Expo packages (`expo-healthkit-module`, `expo-health-kit`) | Our own Swift Expo module |
|---|---|---|---|---|---|
| New Architecture | Yes: built on Nitro Modules (JSI), not the old bridge | Not stated; open issues report it failing on React Native 0.76+ (#404) and users asking for alternatives (#426) | Its changelog claims TurboModule support (2.0.0) | Unclear | Yes, we would write it that way |
| Expo config plugin | Yes: purpose strings, HealthKit entitlement, optional background delivery | Yes (docs/Expo.md) | Inherited | Yes | We would write it |
| Heart rate, active energy | Yes (100+ quantity types) | Yes | Yes | Partly | Whatever we write |
| Sleep stages, HRV, VO2 max, respiratory rate | Through its quantity and category types (sleep analysis is a category type whose values are the stages); to confirm in the compile check | Yes | Yes | Unclear | Whatever we write |
| Anchored (incremental) queries | Yes (`queryQuantitySamplesWithAnchor`, also returns deletions), plus change subscriptions | Partly (observers) | Partly | No | We would write it |
| Maintenance | Very active: 16.2.0 on 12 Oct 2026 and 16.1.0 on 7 Oct 2026, 963 commits, about 720 stars, MIT | Feature freeze since an August 2023 note ("temporarily holding off on introducing new features"); no releases listed | A small fork, one company | Single maintainers, little use | Ours to keep up, with no Mac to debug on |

## Proposed decision

**`@kingstinct/react-native-healthkit`**, with its peer `react-native-nitro-modules`, behind
`AppleHealthProvider` in `apps/mobile/src/integrations/health/`, exactly where Health Connect sits.

- It is the only option that is both New Architecture native and actively maintained.
- Its config plugin covers what a Mac would otherwise be needed for (entitlement and purpose strings).
- Anchored queries match the Android side's incremental sync, so `AppleHealthProvider` can follow the
  same shape as `HealthConnectProvider` and pass the same contract tests (ADR-003).

**Rejected:**
- `react-native-health`: frozen for new work since 2023 and reported broken on the New Architecture,
  which this React Native version cannot turn off.
- The Meter-Health fork: fixes the New Architecture problem, but a small fork is a weaker bet than a
  library built for it.
- The small Expo packages: little use, unclear coverage, single maintainers; `expo-health-kit` is aimed
  at exporting data, not reading it into an app.
- Our own Swift module: possible (`modules/forjd-health-rationale` shows the local-module pattern), but
  without a Mac every fix is a cloud build, and the library above already does the work. Revisit only if
  it cannot read something FORJD needs (CLAUDE.md's platform note says the same).

## Checks before Phase 11 builds on it

1. **Pin the versions.** Its release notes show breaks tied to `react-native-nitro-modules` versions
   (a fix for 0.33+, and a release that capped the peer below 33). Install the pair it names as
   supported at that time, and record both versions here.
2. **Compile check before the Apple account exists.** An EAS **iOS simulator** build needs no Apple
   signing, so it shows whether the library compiles with Expo SDK 57 and React Native 0.86. The
   simulator itself cannot run on Windows, so this proves the build, not the behaviour.
3. **Behaviour on an iPhone** (rule 16): TestFlight on a physical iPhone, once the Apple Developer
   account exists. Read heart rate and active energy during a run; refuse each one alone; the run keeps
   whichever was granted, the same walk as Android's.
4. **Crash on unrequested types.** Its README warns that reading a type without asking for it first
   crashes the app. `AppleHealthProvider` must only read types it has asked for, and a test pins that.
5. **Guarded like Health Connect.** A conformance rule: the library may only be imported from
   `apps/mobile/src/integrations/health/` (what rule 17 sets for Health Connect).

## Consequences

- When accepted: CLAUDE.md rule 17's "iOS's equivalent is a separate decision" and
  `docs/architecture/integrations.md` are updated to name this library.
- Apple's guideline 5.1.3 applies: HealthKit data is never used for advertising and never stored in
  iCloud. FORJD already sends health data to no analytics or advertising service (rule 15) and does not
  use iCloud. The purpose string must say exactly what is read and why (5.1.1(ii)).
- Read only, so only `NSHealthShareUsageDescription` is needed. If the plugin adds an update (write)
  string by default, it is removed, as `app.config.ts` already does for location strings FORJD does not
  use.

## Related

- [ADR-003](ADR-003-health-provider-abstraction.md): the interface.
- [ADR-007](ADR-007-no-mac-ios-toolchain.md): no Mac, cloud builds, TestFlight.
- [ADR-034](ADR-034-react-native-health-connect-library.md): the Android library.
- [ios-settings-gaps.md](../product/ios-settings-gaps.md): the other iPhone settings the app still lacks.
