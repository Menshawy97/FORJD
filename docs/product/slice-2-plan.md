# Plan: Slice 2 — profile & settings screens, plus the backend to support them

## Context

Slice 1 (Flutter → Expo pivot, auth + 5-tab shell) is **merged and `main` is green**
([PR #12](https://github.com/Menshawy97/FORJD/pull/12)). 117 mobile tests, 54 API tests,
both bundles compiling, and the auth screens verified against the design by reading
computed styles from a real web render rather than by reading code.

Slice 2 builds the six profile/settings screens: `editProfile`, `units`, `goals`,
`notifs`, `privacy`, `location`, plus the `athlete` (public profile) screen. Four of
these are blocked on backend fields that do not exist, and **the user chose to include
that backend work in this slice** rather than build screens against a partial contract.

The design source of truth is the runnable prototype
(`FORJD mobile app design/FORJD Mobile.dc.html`), **not** the handoff markdown — the
markdown paraphrases and has been caught contradicting it outright. A 795-line
screen-by-screen spec was extracted from the prototype during planning; see Phase 0,
because it currently lives in session scratchpad and will be lost otherwise.

### Decisions already made (do not re-litigate)

| Decision | Choice |
|---|---|
| Slice scope | Backend fields **and** all screens, in one slice |
| Push notifications | **None in Phase 1** — `notifs` is device-local only |
| Units model | **Three independent preferences** (weight/distance/energy), not derived |
| Public profile | **Build the endpoint** and the `athlete` screen |
| Handles (`@jmitch`) | **Dropped** — no `handle` column; show city, or nothing |
| Athlete stat tiles | **Omitted** — they need Phase 10 leaderboard/analytics data |
| Auth-code coverage | **100% required** on `athletes.service.ts` + `privacy.service.ts` |
| Crash diagnostics | **Off by default** — every privacy flag is opt-in |
| `sex` enum | Already narrowed to `male\|female\|prefer_not_to_say` (done in slice 1) |

---

## Phase 0 — Make the spec durable (do this first, it is the resumability dependency)

The extracted prototype spec exists only in this session's scratchpad at
`…/scratchpad/slice2-screen-specs.md` (795 lines). **Copy it into the repo** as
`docs/design/slice2-screen-specs.md` and commit it. Everything downstream references it,
and regenerating it costs a full prototype re-extraction.

It contains, verified against the prototype: exact copy strings, layout order, typography,
colours, sizing, interactive states, and save/toast behaviour for all six screens; the
shared primitives (`hdr`, `field`, `btn`, `lbl`, `row`, `chips`, `toggle`, `card`,
`tabbar`, `flash`); and a list of **ten places the handoff markdown disagrees with the
prototype**. Sharp examples: `05-interactions.md` claims "disabled does not exist in this
design" while `goals` disables Save at `opacity .4`; `privacy` has three permission rows,
not the two documented; the toggle knob travels 19px, not 21 (21 overflows the 46px track);
`units` is a bespoke two-up pill row, not the documented segmented control.

Docs-only, so CI skips it via `paths-ignore` — that absence is correct, not a failed trigger.

---

## Backend (phases A–F). Each phase ends green and is independently mergeable.

### Phase A — schema + migration + repository (no wire change)

- Extend `apps/api/src/database/schema/profiles.schema.ts`: `weightUnit`/`distanceUnit`/
  `energyUnit` (`text`, NOT NULL, defaults `kg`/`km`/`kcal`), `trainingGoals` + `activities`
  (`text[]`, NOT NULL, default `sql\`'{}'::text[]\``), `city` + `citySlug` (nullable).
- New `privacy-settings.schema.ts` — `publicProfile`, `leaderboardOptIn`,
  `locationForLeaderboard`, `aiFeaturesConsent` (+ `aiFeaturesConsentAt` timestamp),
  `crashDiagnostics`. All boolean, NOT NULL, **default false**.
- Two drizzle-kit migrations: `0003` (generated) for the columns/table; `0004`
  (`--custom`) for the one real backfill —
  `INSERT INTO privacy_settings (user_id) SELECT id FROM users ON CONFLICT DO NOTHING;`.
  Rule 14 forbids hand-editing/Studio, not `--custom`.
- `UsersRepository`: new columns in the patch type and `toProfile`; create the privacy row
  in `upsertFromIdentity` **inside the existing transaction**; `PrivacyRepository` with a
  defensive `findOrCreate` so a missing row can never 500 the settings screen.

**Two non-obvious calls, both deliberate:**
- **Name it `training_goals`, not `goals`.** A `goals` table already exists and models
  *measurable targets* (`target_value`, `target_date`, `status`). The screen's
  "Get stronger / Lose fat" are untargeted intents. Reusing it would force
  `target_value` to be meaningless.
- **`text[]` and `text`, never PG enums or CHECK constraints.** The recent `sex` narrowing
  was free precisely because the column is `text`. `ALTER TYPE` cannot remove a value at
  all. Consequence to handle: filter array members through the known-value set in
  `toProfile`, so a future narrowing degrades to "that chip is deselected" rather than the
  API's own response failing its own schema.

*Why first:* the only phase with a migration, so pausing here leaves the DB ahead of the
API — the safe direction.

### Phase B — goals, activities, units on the wire *(highest priority: onboarding path)*

**Fix the union duplication first.** `packages/contracts` does not depend on
`@forjd/domain`, which is *why* `Sex` was duplicated and drifted. Add the workspace
dependency, move the value tuples into domain as `as const` arrays
(`TRAINING_GOALS`, `ACTIVITIES`, `WEIGHT_UNITS`, …), and have contracts build
`z.enum(...)` from them. This slice adds six more union types; duplicating them multiplies
the bug that already bit once.

`unitSystem` is **kept and redefined as a preset**, marked `@deprecated`, removed in
`/api/v2`. Removing it now is a breaking change to `/api/v1` (rule 7), and deriving it on
read is lossy — `kg`+`mi` has no correct answer and `kJ` has none under either system.
Server rule in `UsersService`: preset-only request sets weight+distance but **never
touches energy**; explicit fields always win; specific-units-only never back-derives the
preset.

Regenerate fixtures in the same commit — CI diffs them with `git diff --exit-code`.

**Carried forward from Phase A's reviews, and done:**
- **Validate the two arrays on write**, for membership *and* a maximum length
  (`z.array(z.enum(TRAINING_GOALS)).max(n)`). `toProfile`'s read-side filter is graceful
  degradation for a narrowed value set, not an input check, and nothing at the database level
  bounds these arrays. **Done in Phase B** (`chipListSchema` in `packages/contracts`).
- **Derive `citySlug` from `city` server-side, and bound `city`.** Filed under Phase B at the
  time; both are properly Phase E's job, since `city` does not reach the wire until then.
  **Done in Phase E** (`slugifyCity` in `apps/api/src/users/city-slug.ts`, called from
  `UsersService.toPatch`; `citySchema` in `packages/contracts` bounds it to 1–120 chars).

### Phase C — privacy storage + endpoint

`PATCH /api/v1/users/me/privacy`. `privacy` rides along on `meResponse` so the settings
screen is one read; there is deliberately **no** `GET /users/me/privacy` (two sources for
one truth).

Invariants live in `PrivacyService`, not the repository: turning off `leaderboardOptIn`
cascades `locationForLeaderboard` off; turning on `locationForLeaderboard` without its
parent is a `BadRequestException` (silent coercion would hide a client bug); consent
transitions stamp/null `aiFeaturesConsentAt` and write an audit row — **only on real
transitions**, so a no-op PATCH cannot manufacture a consent record.

**No caching of consent flags in this slice.** A cached flag means revocation has a
latency window, and `security.md` treats that class of window as a security parameter that
must be stated rather than discovered. Add it with an explicit TTL when the AI module
actually needs it.

Wire `crashDiagnostics` into `apps/api/src/instrument.ts` (`beforeSend` scrubs the user
identifier when off) so the flag is enforced somewhere rather than being a stored boolean
nobody reads. Device-side enforcement is separate and necessary — a crash can happen
before any network call succeeds.

### Phase D — public profile (`GET /api/v1/athletes/:userId`)

The sharpest authorization surface in the slice. New `apps/api/src/athletes/` module.

- **Refusal is 404, never 403.** A 403 confirms the account exists, making the endpoint an
  enumeration oracle over accounts that hold health data — the same reasoning already
  applied to forgot-password in this repo. Unknown user and private user must return
  **byte-identical** responses, and a test must assert exactly that.
- **`publicProfileResponseSchema` is a standalone shape, not `Pick<ProfileResponse, …>`.**
  A derived type puts adding a field to the owner's profile one keystroke from exposing it
  to strangers. `toPublicProfile` names every field explicitly — no object spread.
- Check privacy **before** copying any field, never build-then-strip.
- Self-view bypasses the flag (you can always see your own profile; also enables the
  design's "Your public profile" self-view header).
- Authenticated-only. "Public" means visible to other FORJD users, not to search engines.
- Contents: `userId`, `displayName`, `avatarUrl`, `city`, `trainingGoals`, `activities`,
  `isSelf`. **No stat tiles** (Phase 10 data), no email/DOB/sex/height/units/flags.
- Guard-vs-service split: **a guard decides admission, a service decides projection.** A
  guard returns a boolean and cannot express which fields may appear; making it try means
  duplicating the DB read. Rule 12 requires authorization in unit-testable code, not in a
  class named `Guard`.

### Phase E — city and plan

`city` from the client as a **string only — no coordinates ever cross the network.**
`security.md` states location lives on `WorkoutSession`, never the user record; a lat/long
on `profiles` would contradict it. Device reverse-geocodes locally
(`expo-location`'s `reverseGeocodeAsync`); server derives `citySlug` for future grouping.
No `cities` table — leaderboards are Phase 10, and `domain-model.md` forbids placeholder
tables for phases that haven't started. Setting a city requires **no** consent flag; it is
volunteered and coarse.

`plan: 'free'` hardcoded from a single `SubscriptionService.getPlan()` seam. Billing is
Phase 10. The `editProfile` Plan row renders as `Free plan` / `Go Pro`, non-navigating.

### Phase F — docs (no CI run; `paths-ignore`) — done

`domain-model.md` (new table + columns), `security.md` (consent model, the 404-not-403
decision, the deferred `ConsentGuard`, the no-caching decision), and **an ADR for
unitSystem-as-preset** — that is a reversal of an implied earlier design, which is exactly
what `docs/decisions/` is for.

Landed as [ADR-016](../decisions/ADR-016-unit-system-as-preset.md), written during Phase B
rather than held for this phase — the reversal was decided and coded together, so writing it
down immediately kept the decision and the code it justifies from drifting apart. (015 went
to the Supabase topology decision, reserved first — see `docs/product/roadmap.md`.) All of
Phase F's remaining doc obligations — `domain-model.md`, `security.md`'s consent model and
deferred `ConsentGuard` — landed together in this phase's own commit.

**Backend is complete.** Phases A–F are all merged and green on `main`. Everything from here
is mobile (G–J).

---

## Mobile (phases G–J) — strict TDD, RED before GREEN, per phase

**All done.** Phases G, H, I and J are merged and green on `main` — slice 2 is closed. See
each phase's entry below for what it produced.

Reuse what slice 1 built rather than re-deriving: `src/components/icon.tsx` (27 verified
glyphs), `screen-background.tsx` (ember gradient + safe-area), `toast.tsx`,
`press-feedback.ts`, `src/theme/tokens.ts` + `tailwind.config.ts`, and the
`apiClient`/`secureStorage` pattern.

- **G — `editProfile` + `units`. Done, merged, green on `main`.** Note `editProfile`
  defines its own `inputStyle` at **height 50**, not the 52 used by `field()`/`btn()` —
  that is the prototype's value, not a transcription error. Sex chips: Male / Female /
  Rather not say.
- **H — `location` + `goals`. Done, merged, green on `main`.** `location`'s "Allow" writes
  `city` via the existing `PATCH /users/me/profile` (no new endpoint needed — the plan's
  original "Class B, needs backend work" note for both screens was stale by the time H was
  built; Phase B's `trainingGoals`/`activities`/`city` fields already covered them). The
  **back-chevron trap** is real and now live: `signup.tsx` redirects to
  `/goals?returnTo=newAccount` on success, so back from the first-run path returns to
  `signup`, not `home`, and the destination after Save resets to `profile` — matching
  `slice2-screen-specs.md` §4.6/§4.8 exactly. `location` is built but not yet linked from
  any screen (`rank` is a placeholder, `privacy` doesn't exist yet); it takes an optional
  `?back=privacy` query param for Phase I to use once the privacy screen exists. Both
  screens' `goalsReturnTo`/`locationReturnTo` are ported as query params, not app state, per
  the spec's note not to port `03-navigation.md`'s stack-depth version.
- **I — `privacy` + `notifs`. Done, merged, green on `main`.** `privacy` cut nothing: the
  `PATCH /users/me/privacy` endpoint already existed, so the spec's "blocked on backend"
  note for that screen was stale. It renders from `getMe()`'s `privacy` object (real
  accounts start all-off; §6.4's defaults describe the prototype's local state only) and
  **mirrors the server's leaderboard/location dependency client-side in both directions** —
  parent off cascades the child off, child on turns the parent on — so the server's 400 is
  structurally unreachable without inventing a disabled row state the design does not
  define. Its Location permission row is what finally makes Phase H's `?back=privacy` param
  real. "Preview my public profile" and "Download my data" render **inert**: the athlete
  screen is Phase J and `POST /me/export` does not exist, so the prototype's "Export
  requested — we will email you" toast would be factually untrue.
  `notifs` persists device-locally to **AsyncStorage behind `store/notification-preferences.ts`**
  — chosen over `expo-sqlite` (a table holding five scalars), MMKV (needs a custom dev
  client, breaking the Expo Go workflow ADR-007 depends on) and `expo-secure-store` (for
  secrets; it is the auth layer's seam). Behind a seam specifically so that moving these
  server-side once push exists (Phase 6/8) is an adapter swap, not a screen rewrite. It has
  **no Save button** — toggles apply and persist immediately — and quiet hours is a local
  window whose `Change` control is a deliberate stub, since no editor exists anywhere in
  the design.
  Two new shared components came out of this phase and should be reused, not re-derived:
  `components/toggle.tsx` (presentational; the row owns the tap) and
  `components/toggle-row.tsx`.
- **J — `athlete`** + wire `profile` to real `/users/me` data, replacing hardcoded
  "James Mitchell". Handle line shows city alone (handles dropped). Include the private/
  hidden state the prototype renders.

**One deliberate deviation from the prototype:** in `notifs`/`privacy` only the 46×27
toggle track is tappable. `05-interactions.md`'s own accessibility section requires a 44px
minimum, so make the **whole row** tap-to-toggle. This changes behaviour, not appearance,
so it does not compromise design fidelity.

---

## Verification

**Per phase, before moving on:** `pnpm --filter api test:cov` and `test:e2e`;
`pnpm --filter @forjd/mobile test/typecheck/lint`; conformance script. **Run the API's
`lint` too** — it was skipped once and cost a CI round.

**Coverage gate — the trap that already bit twice.** `test:cov` uses `rootDir: src` and
counts only `*.spec.ts`; **e2e does not count**. Every new file under `apps/api/src`
(except `*.module.ts`, `*.interface.ts`, `database/schema/**`) needs a colocated spec **in
the same commit**, or the global thresholds fail. Five new files this slice, five specs.
Add the agreed per-path 100% thresholds for `athletes.service.ts` and
`privacy.service.ts`, mirroring the existing `./src/auth/guards/**` entry.

**Also unresolved from slice 1:** CI reports ~43% API coverage where local reports ~59%.
They are measuring different file sets. Not blocking, but diagnose it during Phase A
rather than being surprised again.

**Mobile bundle check is mandatory and separate from tests** — Jest compiles neither
NativeWind nor native modules, so a broken import passes the suite and fails on device.
Fetch the manifest with `Expo-Platform: ios`, read `launchAsset.url`, curl it expecting
HTTP 200 and a multi-MB body. Note `npx expo start --offline` is required in this
environment (plain `expo start` fails with `TypeError: fetch failed`).

**Design fidelity — verify by rendering, not by reading code.** Static review missed the
ember gradient, the wrong base colour, and the entire icon set. Run `expo start --web
--port 8082 --offline`, then read **computed** styles via the browser's JS console and
compare against the prototype values in `docs/design/slice2-screen-specs.md`. This is how
slice 1's screens were confirmed exact (e.g. headline letter-spacing `-0.54px` = exactly
`-0.02em × 27px`). Guard against false positives: a `1px` border computes to `0.8px` at
DPR 2 — inject a control element before calling it a defect.

**Checkpoint discipline:** at each phase boundary, update `docs/product/roadmap.md`, open
a PR, get CI green, merge, then confirm the run on `main` itself — a green PR is not proof
the merge commit is green.

---

## Still open — surface these rather than guessing

1. **Is RLS actually configured on Supabase? Still genuinely open — needs a human decision,
   not an engineering call.** Nothing in the repo creates a policy and the API connects as the
   owning role, so rule 12's "RLS is defense-in-depth" currently describes something that does
   not exist for any table, `privacy_settings` included. Two honest paths: build the policies
   (real work, and a decision about who else might read the DB directly — Studio, an admin
   tool, a future service — that a human should make), or correct CLAUDE.md rule 12 and this
   repo's docs to say plainly that NestJS guards are the *only* enforcement today. Both are
   legitimate; picking between them is not something a backend phase should decide on its own.
2. **Resolved in Phase D/F.** `city` is public whenever the profile is public, gated only by
   `publicProfile` and not separately by `locationForLeaderboard` — the two flags answer
   different questions (server behaviour vs. display), and requiring a second flag for one
   field would be a distinction the product draws nowhere else on that response. Recorded in
   `docs/architecture/security.md`.
3. **Still open — a content/locale call, not a backend one.** Energy default is hardcoded
   `kcal` for everyone; kJ is the norm in some markets. Lower stakes than at plan-writing time:
   Phase B made `energyUnit` a real, user-editable field, so a "wrong" default is now a
   one-time change per account rather than a structural gap. Worth a product decision before
   launch in a kJ-majority market, not before.
4. **Still open — a copy decision for whoever builds the mobile screens (Phase I).**
   `Analyse` (British, privacy screen) vs `programs` (US, goals screen) — pick one spelling
   convention and apply it consistently; the prototype itself is inconsistent.
5. **Resolved in Phase F.** `preferences.notifications_enabled` is annotated in
   `apps/api/src/database/schema/preferences.schema.ts` explaining it is unwired by design
   this phase, so a future session does not mistake its presence for a working feature.
6. **Still open — a design-scope question, not a backend one.** `heightCm` has no screen and
   `avatarUrl` has no control anywhere in the current design. Neither blocks phases G-J, since
   both fields already round-trip correctly through the API for whichever future screen adds
   them; flagging here so their absence from the design isn't mistaken for an oversight in the
   backend.
7. **Resolved.** `eslint-plugin-react-hooks`'s rules are registered and verified active
   (`react-hooks/rules-of-hooks: error`, `exhaustive-deps: warn`) —
   [PR #14](https://github.com/Menshawy97/FORJD/pull/14), merged and green on `main` before
   Phase A started.
