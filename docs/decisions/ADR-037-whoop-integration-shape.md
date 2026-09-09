# ADR-037: WHOOP integration shape, and the eager-vs-lazy config lesson

**Status:** Accepted
**Date:** 2026-09-09

## Context

Phase 7 built FORJD's second `HealthProvider` implementation (`WhoopProvider`, after
`HealthConnectProvider` in Phase 6) across slices 7A–7H, closing the phase. This ADR is the
closing record `phase-7-plan.md` calls for: the shape the integration actually took, what
still isn't done, and a real incident from this phase worth generalizing into a standing
lesson.

WHOOP has no sandbox and no demo-data mode; a membership costs money and the user chose not
to buy one for this phase (`phase-7-plan.md` decision 1). Every slice below was built and
tested against recorded real WHOOP v2 payload shapes, not a live account.

## Decision — the shape that shipped

1. **Token encryption** (7A, ADR-036): AES-256-GCM in application code, key from
   `TOKEN_ENCRYPTION_KEY` via `ConfigService`, key-versioned for additive rotation.
2. **`external_connections` table** (7B, migration `0016`): the OAuth/token lifecycle lives
   here, separate from `health_connections`, which stays for on-device providers.
3. **`HealthProvider` moved into `packages/domain`** (7C): a mechanical, behavior-preserving
   refactor making "WHOOP is provider #2 through the same interface" literally true once the
   implementation is server-side.
4. **WHOOP client, OAuth service, record mapping** (7D):
   `apps/api/src/integrations/whoop/whoop-client.ts`, `whoop-oauth.service.ts`,
   `whoop-record-mapping.ts` — the first occupant of `apps/api/src/integrations/`.
5. **`WhoopProvider implements HealthProvider`** (7E), verified against the same shared
   contract-test suite `HealthConnectProvider` runs, proving the abstraction actually holds
   across two independent vendors.
6. **Routes, webhook, raw-body capture** (7F): authenticated `authorize`/`sync`/disconnect,
   public `callback`/`webhook`, `main.ts`'s `rawBody: true`, HMAC-SHA256 signature
   verification, `@SkipThrottle()` on the webhook route.
7. **Mobile Connect screen** (7G): built pixel-by-pixel from the design; only the WHOOP card
   is functionally wired, Apple Health and Health Connect render inert (a deliberate,
   explicitly stated deviation from the design — see 7G's PR for the reasoning).
8. **Conformance + doc hygiene** (7H, this slice): two new rules in
   `scripts/ci/check-architecture-conformance.sh` (WHOOP hostname confined to
   `apps/api/src/integrations/whoop/`; no WHOOP hostname or secret-shaped identifier in mobile
   production code), the two stale Flutter references in `integrations.md` and `system.md`
   fixed, this ADR.

Every service/provider/mapping/cipher file added along the way already carries a 100%
coverage entry in `apps/api/package.json` — that bookkeeping happened incrementally in 7A/7D,
not as a batch at close-out, and was confirmed still complete when this ADR was written.

## An incident this phase produced, generalized into a lesson

Merging 7F (PR #141, `WhoopModule` registered into `AppModule`) broke the real staging Cloud
Run deployment for about eight hours before this project's own CI/deploy-watching discipline
caught it. `token-cipher.provider.ts`, `whoop-client.ts`, and `whoop-oauth.service.ts` all
built their providers with a `useFactory` that called `ConfigService.getOrThrow` for
`TOKEN_ENCRYPTION_KEY` / `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` / `WHOOP_REDIRECT_URI` at
eager module construction. That construction runs during `NestFactory.create()`, before any
request ever exercises WHOOP code — so an environment with none of those variables set
(every real environment today: `.github/workflows/deploy-api.yml` never provisions them, and
no live WHOOP credentials exist yet per decision 1) failed to boot the *entire* API, not just
the WHOOP feature. Cloud Run reported this as "container failed to start and listen on the
port... within the allocated timeout," which does not obviously point at a `ConfigService`
call three modules deep.

Fixed in PR #144 by converting all three factories to `config.get(key, "")` — reading the
value lazily, with an empty-string fallback, resolved only inside the methods that actually
need it (`encrypt`/`decrypt`, an outbound WHOOP call, `buildAuthorizeUrl`). An empty
`client_id` still produces *a* URL; it's a URL WHOOP itself would reject if opened, which is a
correctly-scoped failure at the one call site that cares, not a crashed process affecting
every other feature. Verified with a new e2e test
(`apps/api/test/whoop-optional-config.e2e-spec.ts`) that deletes all five variables and
asserts `app.init()` resolves, and — the conclusive check — by watching the real deploy
workflow succeed and then `curl`-ing the live staging service's health endpoint directly.

**The general lesson:** a `useFactory` provider that runs during module construction is part
of the *entire application's* boot path, not a scoped concern of the feature it belongs to.
`getOrThrow` there is only safe when the config it demands is guaranteed present in every
environment that boots the app at all — true for something like `DATABASE_URL`, false for any
integration-specific credential that a given environment or phase legitimately doesn't have
yet. The `openai-vision-client.ts`/`nvidia-vision-client.ts` factories this repo already had
predate any environment that boots without their keys, which is why their eager pattern never
caused this failure — it was never actually exercised without the key present. Phase 7 is the
first time a new integration's provider landed in an environment that couldn't yet supply its
config, and the fix generalizes: **validate integration credentials lazily, at first real use,
unless the environment matrix guarantees they're always set.** A future integration that adds
a new eager `getOrThrow` in a `useFactory` should ask this question explicitly before merging,
not discover the answer via a broken deployment.

## What Phase 7 leaves owed

- **The live WHOOP OAuth round trip has never run.** Everything above is built and tested
  against recorded payload shapes (decision 1), not a real WHOOP account completing a real
  browser login. Revisit once a WHOOP membership exists.
- **The Phase 6F Health Connect physical-device test (ADR-035) is still owed** — unrelated to
  WHOOP, and unchanged by this phase; 7G deliberately left the Health Connect Connect-screen
  card inert rather than crossing ADR-035's own trigger.
- **Decision E from `phase-7-plan.md` is unresolved:** `HEALTH_SOURCE_PRIORITY` already ranks
  `whoop` above `health_connect` for all four readiness inputs, so connecting WHOOP mid-baseline
  silently changes which rows a user's readiness score reads from. Nothing surfaces this to the
  user today, and nothing re-baselines around it. Flagged here again rather than re-flagged
  quietly forever — a future phase should either build the "your data source changed" surface
  `phase-7-plan.md` describes, or make a deliberate decision not to.
- **7G's Apple Health / Health Connect cards render inert**, a stated deviation from the
  design that shows all three as live — reconfirm with the user at the next device walk.

## Related

- [`../product/phase-7-plan.md`](../product/phase-7-plan.md)
- [`ADR-036-token-encryption-at-rest.md`](ADR-036-token-encryption-at-rest.md) — amended
  alongside this ADR to correct its now-false eager-boot claim.
- [`ADR-035-6f-merge-exception-rule-16.md`](ADR-035-6f-merge-exception-rule-16.md) — the
  still-owed Health Connect device test, unaffected by this phase.
- [`ADR-003-health-provider-abstraction.md`](ADR-003-health-provider-abstraction.md)
- [`ADR-004-canonical-health-model.md`](ADR-004-canonical-health-model.md)
- [`../architecture/integrations.md`](../architecture/integrations.md)
