# ADR-011: How the mobile app holds and renews a session

**Status:** Accepted — decision shape below stands. **Mechanics amended by
ADR-013** (2026-08): the mobile client moved from Flutter to Expo React Native.
`flutter_secure_storage` → `expo-secure-store` (confirm its Android default is
comparable to `encryptedSharedPreferences: true` rather than assuming — this ADR's
whole point was not defaulting blindly). The three-Dio-client pattern (public /
refresh-only / authenticated-with-interceptor, plus an interceptor-free replay
client) maps to three `axios` instances with identical reasoning: a separate
refresh client makes recursive refresh structurally impossible, and a separate
replay client avoids the same interceptor-serialization deadlock this ADR's tests
caught in Dio's `QueuedInterceptor` — axios interceptors have an analogous
request-queuing behavior that needs the same test, not an assumption that RN is
immune to the bug class. The `_inFlight ??= refresher.refresh(...)` singleton-future
dedup pattern ports directly. `refreshListenable`-style gating (read auth state at
redirect time, not reactively watched, to avoid tearing down the navigator on every
sign-in) becomes an Expo Router redirect in the root layout using `router`'s
imperative APIs at redirect time.
**Date:** 2026-08

## Context

Slice 11 gave the app its first real session. The API issues a short-lived access token and
a refresh token; the app has to store them somewhere a rooted device cannot trivially read,
attach them to every authenticated request, renew them when they expire, and get the user
back to the welcome screen when renewal fails.

Three constraints shaped the answer. CLAUDE.md rule 11 means the client never speaks to
Supabase directly — everything goes through the NestJS API, which is why password reset had
to become an endpoint rather than an SDK call. Rule 5 means no secrets in mobile source; the
app holds only the user's own session. And rule 1 means `core/` must not depend on features,
which turns out to be load-bearing rather than decorative.

## Decision

**Storage.** Tokens live in `flutter_secure_storage` with
`AndroidOptions(encryptedSharedPreferences: true)` and
`IOSOptions(accessibility: KeychainAccessibility.first_unlock)`, under five `forjd.`-prefixed
keys, cached in memory after first read.

**Three HTTP clients**, not one:

| Client | Interceptors | Used for |
|---|---|---|
| `publicDioProvider` | none | register, login, forgot-password |
| `refreshDioProvider` | none | `POST /auth/refresh` only |
| `apiDioProvider` | `AuthInterceptor` | everything authenticated |

Plus a fourth, interceptor-free client inside `apiDioProvider` used solely to replay a
retried request.

**Renewal.** `AuthInterceptor` signs each request, and on a 401 refreshes once and replays.
Concurrent 401s share a single in-flight future. A failed refresh clears the store, reports
the loss, and propagates the *original* error. The interceptor never navigates.

**Ports.** `core/network` declares `TokenStore` and `TokenRefresher` as interfaces whose
providers throw by default; `main.dart` binds the real implementations.

**Routing.** The router is built once and gated through `refreshListenable`, never by
watching auth state inside `routerProvider`.

## Rationale

**Why `encryptedSharedPreferences` explicitly.** The v9 default on Android is a hand-rolled
AES scheme over plain SharedPreferences. Opting into AndroidX Security Crypto requires API
23, so `minSdk` gained an explicit floor of 23 — a no-op against Flutter's current default,
kept as executable documentation so a future default cannot silently drop below it.
`first_unlock` rather than `unlocked` so a background refresh can still read the token on a
locked device.

**Why the tokens are cached in memory.** The interceptor reads on every outgoing request,
and a keystore round trip per request is a real cost on Android. The cache is written
through on every mutation, so it can never serve a token the store no longer holds.

**Why a separate refresh client.** It makes recursion structurally impossible: the refresh
call physically cannot re-enter the interceptor, so a 401 from `/auth/refresh` can never
trigger another refresh. Skipping by path would work too, but that is a convention someone
can break later; a separate client cannot be broken by accident.

**Why a separate replay client — this one was found by a test, not by reasoning.**
`AuthInterceptor` extends `QueuedInterceptor`, which serialises its own callbacks. Replaying
through the same client meant the retried request queued behind the `onError` that was
awaiting it, and the request hung until it timed out. The replay carries its own
`Authorization` header and is already marked as retried, so it needs nothing the interceptor
provides. The test that caught it — a request that 401s on every attempt — stays.

**Why the future is shared rather than locked.** `_inFlight ??= refresher.refresh(...)`
means every concurrent 401 awaits the same future, so N simultaneous failures produce
exactly one network refresh. `??=` must remain the only assignment site; a second would let
two refreshes race and one rotate a token the other is about to use. Because it is only
touched from the event loop, no mutex is needed.

**Why the original error propagates.** The caller asked for a profile. "Your profile request
failed" is true; "your refresh failed" is an implementation detail they did not ask about.

**Why the interceptor does not navigate.** Navigation from inside a network interceptor
couples the two and makes both harder to test. It reports the loss, and the router — which
already observes auth state — decides what the user sees.

**Why ports instead of importing the feature.** `core/network` importing `features/auth`
would invert the layering and, more concretely, make the interceptor untestable without the
whole auth stack. The cost is one throwing default per port. Those defaults throw rather
than no-op because a missing override should fail loudly at startup, not silently sign every
request as anonymous.

**Why `SessionRefresher` is not a method on `AuthRepository`.** The interceptor inside
`apiDio` needs a `TokenRefresher`. A repository that also held `apiDio` would close the loop
`apiDio → tokenRefresher → repository → apiDio`, which Riverpod rejects outright. Splitting
the refresher out is both the fix and the more honest description of its dependencies — it
needs the refresh client and nothing else.

**Why `refreshListenable` and not `ref.watch`.** `app.dart` passes
`ref.watch(routerProvider)` to `MaterialApp.router`. Had `routerProvider` also watched auth
state, every sign-in would produce a brand-new `GoRouter` — tearing down the navigation
stack, dropping in-flight animations, and losing any pushed route. Login would appear to
work and everything subtler would not. `redirect` uses `ref.read`, which is evaluated at
redirect time and so always current without creating a dependency. A test asserts the
`GoRouter` instance survives an auth transition.

**Why the gate is a four-value collapse.** `AuthState` has five variants, but the router only
cares about `unknown / signedOut / signedIn / awaitingConfirmation`. Collapsing means a
failed login changes the error message without re-running every redirect.

**Why `AuthUnknown` exists at all.** Without it the first frame of a cold start reads as
signed-out and bounces an already-signed-in user to the welcome screen before the keystore
has answered. It is the difference between a warm start that goes straight to the app and
one that flashes.

**Why no pre-emptive expiry check.** Comparing `expiresAt` against the device clock makes
clock skew a false-positive machine. The server's 401 is the honest signal.

## Consequences

- Token verification remains uncached server-side (see the roadmap's deferred items), so
  every authenticated request costs a Supabase round trip. Unchanged by this ADR.
- Logout revokes the refresh token server-side but clears locally regardless. A network
  failure must not strand someone in a session they asked to leave.
- A half-written session — tokens present, identity missing — reads as signed out. Rendering
  a session that cannot be used is worse than asking for a password.
- **Password reset is only half a flow.** `POST /auth/forgot-password` sends the link;
  completing the reset needs a deep-link handler and a `POST /auth/reset-password`. The app
  ends at "check your email" and the user finishes in a browser. This is the largest known
  gap left by slice 11.
- Nothing yet pins `flutter_secure_storage` to a single file. A conformance grep asserting it
  is imported only from `secure_token_store.dart` — in the same spirit as the existing
  Supabase grep — is proposed but not implemented.

## Addendum (RN/Expo port, slice 3G follow-up): distinguishing why a session was cleared

The RN port's `clearSession()` (`apps/mobile/src/auth/secureStorage.ts`) is called from two
places that mean very different things to the user: `profile.tsx`'s manual "Log out" button,
and `apiClient.ts`'s response interceptor when a 401-triggered refresh itself fails. Both
paths correctly land the user on `/welcome` — the redirect this ADR already describes ("Why
the interceptor does not navigate") is unaffected — but a forced sign-out gave no indication
anything unusual had happened. The screen the user was on (e.g. the workout builder) showed
its own generic failure message and then silently vanished into the welcome screen, which
read as a bug rather than an expired session.

The fix is a single in-memory, non-persisted flag: `clearSession({ expired: true })` sets it,
`consumeSessionExpired()` reads and clears it in one step, and `welcome.tsx` consumes it once
on mount to show "Your session expired. Please log in again." above its CTAs. `profile.tsx`'s
manual logout calls the plain `clearSession()` and never sets the flag.

This keeps the ADR's core rule intact — the interceptor still does not navigate, it only now
also leaves one extra bit behind for the screen that already owns the redirect target to
read. The flag deliberately does not survive an app restart: if the OS kills the app between
the forced clear and the user reopening it, the banner is silently skipped rather than shown
on an unrelated later launch. Individual authenticated screens (builder.tsx,
edit-profile.tsx, and the rest) needed no changes — the fix lives entirely in the shared auth
layer, not duplicated per screen.
