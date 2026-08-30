# ADR-019: Username and avatar are real, after all

**Status:** Accepted
**Date:** 2026-08-30
**Overturns:** the "handles dropped" locked decision in `docs/product/slice-2-plan.md`, and
the roadmap's standing note that `avatarUrl` "has no control anywhere in the current design"

## Context

Slice 2 locked a decision that the product has no handle concept. It was not a casual
omission — it was enacted in three places and defended in code:

- `apps/api/src/database/schema/profiles.schema.ts:38` states the schema deliberately carries
  no handle, "for a distinction the product does not make."
- `apps/mobile/src/app/athlete/[userId].tsx`'s header comment lists "No handle line" as one of
  three reasoned divergences from the prototype.
- `docs/product/roadmap.md` records *removing* the `@jmitch` line from `(tabs)/profile.tsx` as
  a **fidelity fix** — the design was judged wrong and the code was corrected to match the
  decision.

Avatar sat in a stranger position. `profiles.avatar_url` exists and
`updateProfileRequestSchema` accepts it, so the value round-trips correctly today — but it is
constrained to an external `http(s)` URL, and `StorageModule` has no consumer and no upload
route. The app can store an avatar URL it has no way to produce.

The design revision of 2026-08-30 makes both concepts load-bearing rather than decorative:

- A **new onboarding screen** (`s_pickUsername`, prototype line 1883) sits between signup and
  goals, asks for a username *and* a photo, and blocks progress until the username validates.
- `s_editProfile` gains a `Username` field and a `Change photo` control.
- `s_athlete` — the public profile — renders `@handle` as part of the identity row.

A handle that appears in onboarding, in settings, and on the public profile is not a display
nicety. It is an identifier, and the "distinction the product does not make" is now a
distinction the product makes three times.

## Decision

**Both decisions are reversed. Username and avatar become real, first-class profile fields.**

**Username** is a new column on `profiles`, separate from `display_name`:

- Format `/^[a-z0-9_]{3,20}$/` — the prototype's own rule, verbatim.
- **Case-insensitive uniqueness**, enforced by a unique index on `lower(username)`, matching
  the pattern `exercises_owner_name_unique` already uses in this schema.
- Nullable, because every existing account predates the field and there is no honest value to
  backfill. The onboarding screen fills it for new accounts; existing accounts are prompted,
  not blocked.
- **Not** a replacement for `display_name`. The design shows both simultaneously on the
  profile screen (`James Mitchell` above `@jmitch`), so they are two fields, not one field
  rendered twice.
- Never client-derived from the display name. The prototype sanitises input as the user
  types (`toLowerCase().replace(/[^a-z0-9_]/g,'')`), so the only reachable client-side error
  is length — but the server validates the full pattern regardless, because a sanitising
  input is a convenience, not a constraint.

**Avatar upload** goes through `StorageProvider`, never the Supabase SDK directly
(CLAUDE.md rule 11). This is `StorageModule`'s first real consumer.

`avatarUrl`'s current `http(s)`-only contract is **revisited when the upload lands, not
before**. ADR-018 established for exercise media that the database should hold a storage
*key* rather than a URL, precisely so the host can change without a migration — and the same
argument applies here. Whether `avatarUrl` becomes `avatarKey`, or gains a sibling, is a
decision for the phase that builds the upload; changing a shipped `/api/v1` field shape
before then would break rule 7 for no present benefit.

## Alternatives rejected

**Keep the decision and change the design.** This is what the roadmap did last time — the
`@jmitch` removal was recorded as fixing the design, not following it. The user has now
revised the design *with* the handle, twice over and in a new dedicated screen. Treating that
as a second mistake rather than as intent would be substituting our judgment for the
designer's on a question that is entirely theirs.

**Reuse `display_name` as the handle.** The design renders both on the same row with
different typography and an `@` prefix on only one. Collapsing them would make
`James Mitchell` and `@jmitch` the same string, which the design explicitly draws as two.

**Make username immutable after signup.** Tempting — it removes the whole class of
handle-squatting and stale-link problems — but `s_editProfile` puts it in an editable text
field alongside Name and Birthday, with no warning copy and no confirmation. The design says
mutable; making it immutable would be an invented constraint the user never asked for.

**Case-sensitive uniqueness.** Would allow `jmitch` and `JMitch` as different accounts, which
is an impersonation vector on a screen whose entire purpose is identifying a person to other
athletes. The prototype's own lowercasing input shows the intent is a single case anyway.

## Consequences

- `apps/mobile/src/app/athlete/[userId].tsx`'s header comment and
  `apps/api/src/database/schema/profiles.schema.ts:38`'s comment both become **wrong** and
  must be rewritten, not merely deleted. A justification left in place outlives the decision
  it justified, and the next session would re-derive the dropped-handle rule from the code.
- Three shipped screens change: `(tabs)/profile.tsx` regains the `@username` line,
  `edit-profile.tsx` gains a Username field and an avatar control, and `athlete/[userId].tsx`
  gains the handle.
- `signup` gains a navigation step: it must route to `pickUsername`, not straight to `goals`.
- Username collisions become a real error path the client must render — the prototype's
  `That username is taken.` copy needs a real server check behind it, which means a
  uniqueness endpoint or a specific 409 on the profile patch.
- `StorageModule` acquires its first consumer ahead of the InBody phase it was reserved for,
  which is a useful forcing function: the provider abstraction gets exercised by something
  simpler than a vision pipeline before that pipeline depends on it.

## Note on numbering

`docs/product/phase-2-plan.md` had reserved **ADR-019** for an on-device exercise catalogue
decision, but never wrote the file. This ADR takes 019 because it exists; the exercise
catalogue decision was renumbered to **ADR-022**, and that plan's "Note on numbering" records
the move. **ADR-017** remains reserved for the canonical exercise model and is still unwritten
— its decision currently lives in `phase-2-plan.md`'s locked-decisions table.
