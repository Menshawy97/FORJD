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

## Consent model (slice 2)

`privacy_settings` (see `domain-model.md`) holds six flags, all boolean, `NOT NULL`, defaulting
**false**. Every one is opt-in, crash diagnostics included — an off-by-default diagnostic is a
decision, not an oversight, made explicit here so it is never mistaken for one later.

Every rule *about* those flags lives in `PrivacyService`, in code that can be unit-tested —
never as a SQL `CHECK` constraint and never only in RLS (`CLAUDE.md` rule 12). Concretely:

- `location_for_leaderboard` requires `leaderboard_opt_in`. Turning the parent off **cascades**
  the child off — leaving it set would keep a stored "yes" to sharing location for a feature
  the user has left, which anything later reading the flag alone would read as live consent.
  Turning the child on **without** its parent is a `400`, not a silent coercion; silently
  dropping the field would hide a client bug behind a `200`, on a location setting the user
  believes they just enabled.
- The AI-features consent transition stamps or clears `ai_features_consent_at`, and writes an
  audit row, **only on a real transition** — comparing against the row as read, not writing
  unconditionally. The settings screen's Save button re-sends every toggle on each tap; writing
  unconditionally would manufacture a fresh consent record, and a fresh timestamp, every time
  someone opened the screen and saved, destroying the real date consent was given.
- The read-decide-write for any of the above runs inside one transaction holding a row lock
  (`PrivacyRepository.updateLocked`, `SELECT ... FOR UPDATE`) — not a plain read followed by a
  separate write. Two overlapping requests reading the same stale row and each deciding their
  own change is legal is not a contrived race here: the Save button re-sending every toggle
  makes overlapping requests the *ordinary* case, not an edge one.
- **No caching of consent flags.** A cached flag means a revocation has a latency window before
  it is genuinely false, and that class of window is a security parameter to be stated, not
  discovered — the same principle as the session-revocation window above. Add a cache only with
  an explicit, documented TTL, when a real caller (the AI module) actually needs the read to be
  cheap.

A `ConsentGuard` — something that turns "does this user consent to X" into the same kind of
admission decision `JwtAuthGuard` makes for authentication — does not exist yet and is
deliberately deferred. Nothing in slice 2 needs to *gate a route* on a consent flag; every
current consumer (the leaderboard dependency, the AI transition, `crashDiagnostics`) reads the
flag directly at the point of use, because each has its own shape of "what happens when consent
is absent" (a 400, a no-op, a scrubbed identifier) that a boolean-returning guard cannot express
any better than the guard-vs-service split in `AthletesService` already does for authorization.
Build it when a route-level gate is the actual shape a future consumer needs, not before.

`crash_diagnostics` is enforced, not merely stored: Sentry's `beforeSend`
(`apps/api/src/observability/sentry-scrub.ts`) scrubs the user identifier from every crash event
unless the current request scope carries the exact opt-in marker, and it **fails closed** —
absence, `'off'`, and any unrecognised tag value all scrub. Most events come from paths that
never read this user's settings (a crash during bootstrap, an unauthenticated request), and for
those the honest answer is "unknown," which must behave like "no." This is *not* the mechanism
that keeps health data out of Sentry — the non-negotiable rule at the top of this document does
that unconditionally, regardless of any toggle's position — and device-side enforcement is
still separately necessary, because a crash can happen before any network call succeeds.

`city` is public whenever the profile is public, gated only by `public_profile` — it does not
also require `location_for_leaderboard`. The two flags answer different questions:
`location_for_leaderboard` is about *server behaviour* (does this account's location factor
into a leaderboard query), while `city` on the public profile is *display*, the same category
as `display_name` or `training_goals`. A user who has opted into a public profile has already
agreed that identity-adjacent facts about them are visible to other athletes; requiring a
second, narrower flag for one specific field would be a distinction the product does not draw
anywhere else on that same response. `city` is coarse and volunteered besides — see
`domain-model.md` — never a coordinate, never the leaderboard's own precision.

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
