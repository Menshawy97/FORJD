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
