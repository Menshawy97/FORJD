# ADR-043: Health data is collected only after explicit consent

**Status:** Accepted
**Date:** 2026-09-19

## Context

The Phase 8 store checklist requires "explicit consent screens before requesting HealthKit /
Health Connect / WHOOP permissions, separate from generic app permissions". Before this, WHOOP
could be connected and health observations stored with no consent step; only the AI features
had a consent flag (R2).

## Decision

1. **A separate consent**, `privacy_settings.health_data_consent` (+ `_at`), off by default and
   independent of every other flag. Same transition rules as the AI consent: the date is written
   only on a real change, one audit row per changed consent in the same transaction, and a plain
   Save never manufactures a record (the app also omits an unchanged value from Save).
2. **Enforced on the server, read live, never cached.** `PrivacyService.requireHealthDataConsent`
   guards `POST /integrations/whoop/authorize`, WHOOP sync and `POST /health-data/observations`
   (`403 health_data_consent_required`). WHOOP webhooks are acknowledged either way but fetch and
   store nothing without consent. Withdrawal is therefore effective on the next request.
3. **Asked at the moment it matters.** WHOOP "Connect" answers the 403 by opening the
   `health-consent` explainer (modelled on the location explainer; there is no consent screen in
   the design, so it is extrapolated and its copy is a draft for legal review). "Allow" records
   consent and returns to Connect; "Not Now" changes nothing.
4. **Withdrawn in Privacy Settings** ("Health data" row).
5. **A connection without consent reads as not connected.** `GET /integrations/whoop/status`
   reports `connected: false`, so a connection made before consent existed (or kept after it was
   withdrawn) shows "Connect", which walks the person through consent and re-authorizes rather
   than leaving a live-looking connection that collects nothing.

## Consequences

- Withdrawing stops collection but keeps the WHOOP connection and its encrypted tokens; existing
  observations stay until the person disconnects or deletes the account. The consent screen says
  so. Re-granting resumes collection from the next event; no backfill runs.
- The WHOOP OAuth callback does not itself re-check consent: no data is fetched at that point,
  and sync and webhooks are guarded.
- Health Connect (on-device) will reuse the same check when its connect flow is built; the
  physical-device test owed by ADR-035 is unchanged.
- `data-inventory.md` lists health metrics as collected only under this consent.
