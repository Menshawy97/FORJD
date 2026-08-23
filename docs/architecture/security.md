# Security & privacy

## The one non-negotiable rule

Health data — from HealthKit, Health Connect, WHOOP, or InBody scans — is
never used for advertising or marketing, and never sold or shared with
third parties, full stop. This is Apple App Review Guideline 5.1.3(i)
verbatim and Google's Health Connect policy equivalent — treated as an
engineering constraint (`CLAUDE.md` rule 15: no analytics/advertising SDK
ever receives health data, "not even for debugging"), not only a policy
statement.

## Baseline

TLS everywhere. Encrypted DB fields where appropriate. Encrypted object
storage. Secrets in a secret manager, never mobile source (`CLAUDE.md` rule
5). Token encryption for `ExternalConnection` records. Access control
enforced in NestJS guards, RLS as defense-in-depth only (`CLAUDE.md` rule
12). Audit logs. User data export and deletion (real deletion, not hiding).
Provider disconnect. Consent tracking. Minimal permissions requested per
provider capability, not blanket grants.

## Session revocation has a window, and the window is the token lifetime

Access tokens are verified in process against Supabase's published signing keys rather
than by calling Supabase on each request (ADR-012). That removed roughly nine tenths of
the latency of every authenticated request, and it has one security consequence worth
stating in this document rather than only in the ADR: **an access token cannot be recalled
before it expires.**

Signing out revokes the refresh token, so a session cannot renew itself, and it dies at the
end of at most one access-token lifetime. Deleting an account is the same. The lifetime is
therefore a security parameter, not a convenience setting, and it is configured in the
Supabase dashboard rather than in this repository — which is exactly the kind of setting
that drifts unnoticed. Target: **900 seconds**.

Anything that must take effect immediately — a compromised account, a legal hold — cannot
rely on token expiry alone and needs a deliberate mechanism. None exists today, and none is
needed until the product has a reason for one; `IdentityCache` is bounded and clearable,
which is the seam such a mechanism would use.

## The public athlete profile has an accepted timing window

`GET /api/v1/athletes/:userId` (slice 2, `AthletesService`) answers **404, never 403**, for
every refusal — unknown user, private profile, missing privacy row, malformed id — through
one `refuse()` call, so the response body, status and message are identical for "no such
account" and "that account exists but is private". That closes the enumeration oracle at the
response-shape level, which is the threat this document's other sections are about.

It does not close a *timing* side channel: the private-profile path runs one more query
(a privacy-table lookup) than the unknown-user path, which returns as soon as the profile
lookup misses. A large-sample statistical timing attack could in principle distinguish the
two. This is accepted rather than fixed, for the same reason the session-revocation window
above is accepted rather than eliminated: closing it (e.g. an unconditional dummy privacy
read on every path) adds real complexity for a threat that requires an attacker to run a
timing attack over a network against a uniformly rate-limited endpoint (`ThrottlerGuard`
applies to every route), which is impractical at the precision such an attack needs. Stated
here rather than left to be rediscovered.

## Data separation

Authentication data, health data, analytics, AI context, and uploaded
documents (InBody photos) are kept as distinct concerns — not one
undifferentiated user-data blob — so that access control, retention policy,
and export/deletion can each be reasoned about per category.

## Store-readiness checklist (Phase 8, but tracked from Phase 0)

- Privacy policy + ToS, reviewed by a lawyer before any public beta —
  engaged in week 1 (see `docs/product/roadmap.md`), not Phase 8, because
  legal turnaround is the one dependency not under engineering control.
- Explicit consent screens before requesting HealthKit/Health
  Connect/WHOOP permissions, separate from generic app permissions.
- Account data export.
- Account + data deletion — actually removed, not soft-hidden. Required by
  both stores for any app with signup.
- Age gating — minimum age decided and enforced.
- App Store health-data justification written before submission, per
  HealthKit data type requested.
- Google Play Data Safety section must exactly match actual data
  practices — a mismatch is a suspension risk, not just a rejection risk.
- Location/leaderboard consent (Phase 10) is its own opt-in, separate from
  every other consent, folded into the same legal-review conversation as
  the core privacy policy rather than opening a second engagement.

## Leaderboard/location privacy (Phase 10)

Location is captured only during an active, leaderboard-opted-in workout —
"when in use," never background tracking. Leaderboard participation is a
separate opt-in from general app usage. A user can hide from leaderboards
or delete location history independent of deleting their whole account.
Location lives on `WorkoutSession`, never on the user record — this is what
makes "the leaderboard doesn't follow you when you relocate" true by
construction rather than by a rule someone has to remember to enforce.

Anti-cheat: only live-tracked sessions (real start/end timestamps, location
captured at start) count toward `leaderboard_eligible`. Manually logged or
backdated workouts never qualify.
