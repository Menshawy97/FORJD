# ADR-035: One-time exception to rule 16 for merging 6F ahead of a physical device

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** This PR (#130, `HealthConnectProvider`) only. Does **not** change CLAUDE.md rule 16's
default for any future Health Connect or HealthKit code.

## Context

CLAUDE.md rule 16: *"HealthKit/Health Connect code does not merge until it has run on a
physical device... A green CI build is not done."* Phase 6F (`HealthConnectProvider`,
`health-connect-record-mapping.ts`) was written and verified this session against the
`forjd_pixel7_api34` emulator and a real EAS cloud dev-client build — installed cleanly,
launched without crashing, and `adb dumpsys` confirmed Health Connect's permission-rationale
activity and `HealthDataSdkService` bind action are correctly registered. See
`docs/product/roadmap.md`'s 2026-09-08 session-close entry for the full verification record,
including what was explicitly **not** verified: the live JS→native call path
(`connect()`/`requestPermissions()`/`sync()`) was never exercised, since no UI calls this
provider yet, and no physical Android phone was available this session.

The user asked directly to merge 6F now, ahead of that physical-device run, to unblock
downstream work (6E's `HealthProvider` interface already merged; UI screens that will
eventually consume `HealthConnectProvider` are the next planned work), with an explicit
tracked note that the device test is still owed.

## Decision

**Merge PR #130 now**, as a one-time, explicitly-requested exception to rule 16 — not a
reinterpretation of the rule, not a precedent for future Health Connect/HealthKit PRs. Rule
16's default (physical device required before merge) stands unchanged for everything after
this PR.

**The physical-device test remains outstanding and is tracked, not closed by this merge:**
- `docs/product/phase-6-plan.md`'s 6F entry and `docs/product/roadmap.md`'s Phase 6 timeline
  row are updated to say explicitly that `HealthConnectProvider` is merged but
  **device-unverified** — the live call path has never run against a real Health Connect
  installation.
- Before any UI screen goes live wiring real users to `HealthConnectProvider` (the
  "light up the UI" post-6F work), that device test must happen. This ADR does not authorize
  skipping it forever — only merging the code now, so the interface/adapter shape is settled
  and downstream slices aren't blocked on hardware availability.

## Rationale

Rule 16 exists because emulator behavior for health platforms is known to diverge from real
devices — no real sensor data, no hardware-backed keystore, and (per `roadmap.md`'s own
hardware-table note from when the emulator was provisioned) the emulator "only replays what
you write into it." None of that risk is eliminated by this merge; it is deliberately deferred,
with the gap named explicitly rather than allowed to blur into "6F is done."

## Consequences

- `HealthConnectProvider` ships on `main` unverified against real Health Connect / real sensor
  data / a real hardware keystore. Its unit tests (mapping logic, mocked-native-module wiring,
  the shared contract suite) still hold — this ADR does not weaken those, only the merge gate.
- The device day, whenever it happens, is scoped to *confirming* this code (and fixing what it
  finds), not building it from scratch.
- No screen may call `HealthConnectProvider` in a way real users would reach until the device
  test closes this gap — enforced by review, since there is no automated check for "has this
  path been exercised on hardware."

## Related

- [`../product/roadmap.md`](../product/roadmap.md) — 2026-09-08 session-close entries for 6F's full verification record.
- [`../product/phase-6-plan.md`](../product/phase-6-plan.md) — 6F's original device-gating language, which this ADR narrowly excepts for this one merge.
