# ADR-067: Exception to rule 16 for the Health Connect privacy link

**Status:** Accepted
**Date:** 2026-10-15
**Scope:** The Health Connect privacy-link fix only
([health-connect-privacy-link-plan.md](../product/health-connect-privacy-link-plan.md)). It does
**not** change CLAUDE.md rule 16 for any other Health Connect or HealthKit code, the same way
ADR-035 did not.

## Context

CLAUDE.md rule 16: Health Connect code does not merge until it has run on a physical Android phone.
On 2026-10-15 a Play-rules check found that Health Connect's **privacy policy** link opened FORJD's
last screen instead of the privacy policy. Google's Health Connect guide requires the policy given
to Play Console, and Google reviews every app that asks for health permissions. The fix is a small
native activity (`modules/forjd-health-rationale`) that opens getforjd.com/privacy in the browser,
plus dropping the library's config plugin that pointed the link at `MainActivity`.

The owner's only phone (OPPO A37f, Android 5.1.1) cannot run the app. The owner asked to merge the
fix after an emulator check rather than wait for a borrowed phone, so the beta's Play review is not
held up by hardware.

## Decision

Merge the fix once its tests pass and the `forjd_pixel7_api34` emulator (Android 14, Health Connect
built in) shows the link opening the policy, ahead of a physical-phone run. This is a one-time
exception, like ADR-035, not a precedent.

## Rationale

Rule 16 exists because health platforms behave differently on real phones: real sensor data, real
keystores, vendor builds. This change touches none of that. It reads no health data and does not
alter the permission request; it only routes one system intent to a page in the browser. What the
emulator does not prove, how a vendor's Health Connect build (Samsung, Xiaomi) shows the link, is
the kind of difference rule 16 guards against, so it stays owed.

## Consequences

- The fix ships device-unverified. Owed on a physical phone with the other Health Connect walk
  ([remaining-checklist.md](../product/remaining-checklist.md), "Health Connect test on a physical
  Android phone"): tap **privacy policy** on the Health Connect permission screen, see the policy in
  the browser, return, and grant heart rate and calories.
- Rule 16's default is unchanged for everything after this.
