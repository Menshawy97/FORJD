# ADR-012: Access tokens are verified in process, not by asking Supabase

**Status:** Accepted
**Date:** 2026-08

## Context

`JwtAuthGuard` called `supabase.auth.getUser(token)` on every authenticated request. Two
consequences followed, and neither was going to get better on its own:

1. **Every authenticated request began with an HTTPS round trip to a third party.** The
   cost is fixed per request and applies to every endpoint Phases 2-11 will add, so it
   compounds with the size of the product.
2. **Supabase Auth availability became a dependency of every endpoint**, including ones
   that otherwise touch only our own Postgres.

Measured on this machine against the live `forjd-dev` project, 40 sequential
`GET /users/me` calls (`scripts/perf/measure-auth-latency.ts`):

|                   | p50      | p95      | mean     | min      |
| ----------------- | -------- | -------- | -------- | -------- |
| Asking Supabase   | 123.3 ms | 253.1 ms | 137.1 ms | 102.0 ms |
| Verifying locally | 14.3 ms  | 20.7 ms  | 12.2 ms  | 4.8 ms   |

Roughly nine times faster at the median and twelve at the tail, on the cheapest
authenticated endpoint in the API — one guard and one profile read. That is close to the
floor every other authenticated endpoint pays.

The roadmap deferred this once already, correctly: it recorded that caching verification
"trades away revocation latency… that is a real security cost, not a free win, so it
should be a deliberate decision with a chosen TTL and not a reflex optimisation." This ADR
is that deliberate decision.

## Decision

`SupabaseAuthProvider.verifyAccessToken` verifies the JWT in process against the project's
published signing keys, fetched from `/auth/v1/.well-known/jwks.json`.

The `forjd-dev` project signs with **asymmetric ES256 keys** and publishes a JWKS — checked
before writing any code, because the legacy shared-secret mode would have meant a different
implementation. A real token was decoded to confirm every claim this depends on rather than
assuming the documented shape: `iss` is `<SUPABASE_URL>/auth/v1`, `aud` is `authenticated`,
`sub` carries the external id, and `user_metadata.email_verified` carries confirmation
state.

Four properties are deliberate:

- **The algorithm list is pinned** to `ES256`/`RS256` rather than read from the token's own
  header. A verifier that honours the header will accept an HS256 token signed with the
  public key — which is public. `alg: none` and that confusion attack both have tests.
- **The key set is cached and re-fetched only on an unfamiliar `kid`**, with a cooldown, so
  key rotation is handled without a burst of unknown-`kid` tokens becoming a burst of
  outbound requests.
- **Verification runs on every request and is never cached.** Expiry is checked during
  verification, so a skipped verification is a token that outlives its own lifetime. It is
  now cheap enough that doing it every time costs nothing worth saving.
- **The identity-to-user lookup is cached, bounded, for 60 seconds** (`IdentityCache`). Its
  key includes the email address, so an identity presenting a _different_ address misses
  and re-enters the repository — which is where an address already bound to another account
  is rejected. Keying on the external id alone would let a cache hit skip that check.

Nothing outside `apps/api/src/auth/providers/` changed. `AuthProvider` keeps its shape, so
the swap is invisible downstream (rule 3, ADR-008).

## Consequences

**An access token cannot be recalled before it expires.** This is the whole cost, stated
plainly. Previously, revoking a session took effect on the next request because every
request asked Supabase. Now the access-token lifetime _is_ the revocation window.

Mitigations, in order of how much they actually help:

1. **Shorten the access-token lifetime.** It is currently **3600 seconds** — verified by
   decoding a live token, not assumed. An hour is too long a window for a product holding
   health data. Set it to **900 seconds** in the Supabase dashboard (Authentication →
   Sessions). The mobile client already refreshes transparently on a 401, so a shorter
   lifetime costs users nothing; it only costs a more frequent refresh call.
   **This is an outstanding manual step and the ADR is incomplete without it.**
2. **Signing out still revokes the refresh token** server-side, so a signed-out session
   cannot renew itself. It dies at the end of at most one access-token lifetime.
3. Deleting an account leaves at most one lifetime during which a stolen token still
   authenticates. The `IdentityCache` adds at most 60 seconds to that.

**Supabase Auth is no longer on the request path**, so an outage there stops new logins and
refreshes but leaves existing sessions working. That is a genuine availability improvement
and was not the motivation.

**jose is pinned to v5.** v6 dropped its CommonJS build and this application compiles to
CommonJS, so v6 would have failed at runtime in production, not merely in Jest. Revisit
when the API moves to ESM.

**The JWKS endpoint is fetched lazily on first use.** The first authenticated request after
a cold start pays for it. On a host that sleeps (ADR-014) that lands on the same request
already paying for the cold start.

## Alternatives considered

**Caching the result of the remote call for 30-60 seconds.** Keeps revocation latency at
the cache TTL rather than the token lifetime, which is strictly better for revocation. But
it still pays a full round trip once per user per window, still makes Supabase a
per-request dependency in the miss case, and it caches an _authentication decision_, which
is a more dangerous thing to hold than a database row. Rejected in favour of the
short-token-lifetime mitigation, which bounds the same risk without keeping the dependency.

**Hand-rolling verification with `node:crypto`.** Rejected. Algorithm confusion and `alg:
none` are exactly the mistakes a bespoke verifier makes, and the project's own rule 0 says
to prefer a battle-tested library over hand-rolled code.

**Leaving it alone until measured latency justified a change.** The measurement above is
that justification, and it was taken before the change rather than argued from intuition.
