# ADR-041: Google and Apple sign-in through a native ID token, verified upstream

**Status:** Accepted
**Date:** 2026-09-19

## Context

The design has "Continue with Google" and "Continue with Apple" buttons on the login and signup
screens. Until Phase 8 they only showed a toast. The API is email and password only, behind
`AuthProvider` (ADR-008), and Apple requires an iOS app that offers Google sign-in to offer Apple
sign-in as well.

## Decision

1. **Native sheets, not a browser flow.** The phone's own Google account sheet (and Sign in with
   Apple) returns an **ID token**. The app sends it to `POST /api/v1/auth/social`; the API
   exchanges it through `AuthProvider.signInWithIdToken` (Supabase `signInWithIdToken`), which
   verifies the token with Google or Apple. FORJD never verifies a token itself, never reads
   email or claims from the client, and no password or client secret touches the app.
2. **Same account model.** A first sign-in creates the account through the same
   `upsertFromIdentity` as any login (user, profile and privacy rows). A later sign-in, or an
   email account with the same address, lands on the same user. The response is the normal
   session plus `isNewUser`; the audit row records only the provider and `isNewUser`.
3. **Only vouched-for addresses.** A sign-in whose email the provider does not confirm is
   refused and its session revoked, so nobody can pre-register a victim's address and inherit the
   account when the victim signs in later. A local row already holding the address under a
   different login is also answered with the constant `401` (never a `409`, which would reveal
   the address is registered) and the session is revoked.
4. **Adapters isolate the SDKs** (rule 4): `apps/mobile/src/integrations/auth/{google,apple}.ts`
   are the only files that may import them (a conformance rule enforces it). Both load lazily so
   Expo Go, which has no native module, reports "unavailable" instead of crashing at startup.
5. **Apple is built but off.** It needs a paid Apple Developer account. The button is shown
   dimmed as "Coming soon" until `extra.appleSignInEnabled` is set at build time; Apple's nonce
   flow (hash to Apple, raw value to the API) is implemented and tested now.
6. **The only config in the app is Google's OAuth web client ID**, which is public by design. The
   client secret lives in the Supabase dashboard only (rule 5).

## Consequences

- New native dependencies (`@react-native-google-signin/google-signin`,
  `expo-apple-authentication`) need a **dev-client rebuild**; Google sign-in does not work in
  Expo Go.
- A live Google round trip stays owed until Google Cloud (OAuth consent screen, web and Android
  client IDs with the EAS signing SHA-1) and the Supabase Google provider are configured.
- Google's native sheet sends no nonce, so a leaked Google ID token could be replayed until it
  expires (about an hour). Supabase still checks issuer, audience and expiry. Accepted for now;
  revisit if the SDK gains nonce support.
- Supabase project settings must keep email confirmation on (they do, R11): the linking safety
  above assumes an unconfirmed password account cannot exist for someone else's address.
- Identity linking by verified email is Supabase's behaviour; the e2e test proves an
  email-signup account keeps its data when the same address later uses Google.
