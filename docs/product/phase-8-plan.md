# Session plan — Phase 8 (privacy & beta prep), Google/Apple sign-in, roadmap refresh, text contrast

## Context

Phases 0–7 and the 29-slice audit remediation are merged and green on `main`. The next row in
`docs/product/roadmap.md` is **Phase 8 — Privacy & beta prep**. It has no written plan, and the
roadmap's own "Current status" header is stale (dated 2026-09-02; its timeline table still
shows the audit at 11/29). The user picked this session's scope:

1. Phase 8's engineering-only parts: a health-data consent screen, a **minimum age of 16**, and
   a data inventory that the Google Play Data safety form can be filled from.
2. A roadmap refresh.
3. Faint grey text made readable. This is R19's unapplied "GREEN part 1". The user sees samples
   first.
4. **Make Google and Apple sign-in work.** Today the buttons are toast-only placeholders
   (`login.tsx:179`, `signup.tsx:211`) and the API is email/password only.

User decisions already made:
- Social sign-in uses the **native phone sheet**: native SDKs return an ID token, and the app
  sends it to our API. This needs a dev-client build, so it will not run in Expo Go.
- **Apple**: build the code now. The button is visible but disabled with "Coming soon" until a
  paid Apple Developer account exists.
- **Age**: date of birth is asked once. Under-16s are turned away and their account is removed.
- **Where DOB is asked**: the new screenshot `FORJD mobile app design/screenshots/signuppage2.png`
  adds a **DATE OF BIRTH** field (placeholder `mm/dd/yyyy`, calendar icon on the right, helper
  "You must be at least 16 years old to use FORJD.") to the existing **"Your Profile"**
  pick-username step, below USERNAME and above Continue. Email sign-ups and new Google/Apple
  users both land on this step. The Create Account screen is unchanged.

Exploration also found two store-blocking gaps, which fall inside "Phase 8 parts I can build":
- **Account deletion leaves the Supabase Auth user alive**, because nothing calls
  `auth.admin.deleteUser`. `login` lazily re-creates local rows via `upsertFromIdentity`, so a
  deleted, or underage-rejected, user could simply log back in.
- **Export skips about 12 tables**: owned exercises and foods, favourites, `food_servings`,
  `macro_goals`, saved meals, `goals`, `preferences`, `health_connections`, past enrollments.

## Working rules for every slice

- One PR per slice, test-first (RED, then GREEN), with the `code-reviewer` agent run before merge.
- After each merge, confirm the post-merge CI run on `main` is green (CLAUDE.md "Merging").
- Build UI pixel by pixel against the screenshots and the prototype.
- First action: commit this plan as `docs/product/phase-8-plan.md` (the handoff rule).
- Shared-tree caution: check `git status` and `gh pr list` before each slice. Use branches cut
  at HEAD, and never pull while another session is active.
- Local Postgres specs: export `DATABASE_URL` with `127.0.0.1` (this machine's IPv6 quirk).
  Apply migrations via `psql` if the drizzle-kit spinner hangs.

## Slices, in order

### S0 — Roadmap refresh and plan commit (docs only)
- Rewrite `roadmap.md`'s "Current status" to today's truth: Phases 0–7 done, 6F device test and
  live WHOOP still owed, audit 29/29, food-catalogue work #180–#183 (ADR-040).
- Fix the timeline's Audit row, and set the Phase 8 row to "In progress" with a link to
  `phase-8-plan.md`.
- Add `docs/product/phase-8-plan.md`, a copy of this plan.
- Docs-only, so no CI run on `main` is expected.

### 8A — Data inventory (docs)
- New `docs/architecture/data-inventory.md`. For each data category: where it is collected,
  where it is stored, which third party receives it, whether it is encrypted, and whether it is
  exported and deleted. Third parties: Supabase, OpenAI (with consent), WHOOP, server-side
  Sentry. There are no analytics or ad SDKs. Add a row for Google/Apple sign-in.
- A draft of the Play **Data safety** answers, derived from the table.
- Record known mismatches as follow-ups, not fixes. Example: `crash_diagnostics` claims to
  control whether reports are sent, but it only strips the user id (`sentry-scrub.ts`).
- Link it from `security.md`'s store-readiness checklist.

### 8B — Deletion that actually deletes (api + mobile)
- `AuthProvider` gains `deleteUser(externalId)`. `SupabaseAuthProvider` implements it via
  `client.auth.admin.deleteUser` (the service-role client already exists at
  `supabase-auth-client.ts`).
- `AccountDeletionService` (`apps/api/src/users/account-deletion.service.ts`) calls it after
  the DB delete. Failure handling follows the existing WHOOP-revoke precedent.
- Scrub the email out of `auth.password_reset_requested` audit rows for that address.
- Mobile `delete-account.tsx`: also clear the on-device SQLite dbs (`forjd-workout-sessions.db`,
  catalogue) and the `forjd.*` AsyncStorage keys.
- Extend the orphan check in `apps/api/test/users-deletion.e2e-spec.ts` to every user-owned
  table.
- Tests: provider spec for `deleteUser` (stubbed client), service spec, e2e.

### 8C — Export completeness (api + contracts)
- Add the missing tables to `AccountExportService.exportAccount` (`account-export.service.ts`)
  and to `accountExportSchema` (`packages/contracts/src/account-export.ts`).
- Regenerate the fixtures.
- Image files stay URL-only, which 8A documents.

### 8D — Age gate, minimum 16 (domain, contracts, api, mobile)
**Domain**, in `packages/domain`:
- `MINIMUM_AGE_YEARS = 16` and a pure `ageInYears(dob, today)` helper.
- Boundary unit tests: birthday today, 29 February, and the day before the 16th birthday.

**Contracts**:
- `setDateOfBirthRequestSchema`.
- `updateProfileRequestSchema.dateOfBirth` (`users.ts:241`) must be 16 or older, and cannot be
  cleared back to `null`. This stops a user from changing their date of birth to get around the
  gate later.

**API**:
- `PUT /api/v1/users/me/date-of-birth`. If the user is under 16, the endpoint reuses
  `AccountDeletionService` (plus 8B's auth-user deletion) and returns 403 with code `underage`.
- **Server enforcement (rule 12)**: `JwtAuthGuard` rejects a user with a null DOB with 403
  `date_of_birth_required`. Routes can opt out with an `@AllowWithoutDateOfBirth()` decorator:
  - `GET /users/me`
  - the DOB endpoint
  - the username and avatar endpoints
  - logout, delete and export
- The DOB-set flag is cached alongside the identity (`identity-cache.ts`), and setting the DOB
  invalidates that entry.
- The e2e helpers get a DOB for their test users.

**Mobile**:
- The `pick-username.tsx` "Your Profile" screen gains the DATE OF BIRTH field exactly as in
  `signuppage2.png`:
  - label style from `lbl`
  - the same input box as USERNAME
  - `mm/dd/yyyy` placeholder and calendar icon (check the prototype's glyph set first)
  - helper text
  - it opens the existing `@react-native-community/datetimepicker` with `maximumDate` set to
    today
- Continue sends the DOB first. On `underage`, the app clears the session and `welcome.tsx`
  shows "You must be at least 16 to use FORJD. Your account has been removed." This reuses the
  one-shot `consumeSessionExpired` pattern in `secureStorage.ts`.
- Signed-in users with a null DOB (existing accounts, or an interrupted onboarding) are routed
  to this step by `AuthGate` in `_layout.tsx`, with the username prefilled. The `apiClient.ts`
  interceptor handles `date_of_birth_required` the same way.
- `edit-profile.tsx`'s picker gets a `maximumDate` of the 16th-birthday cutoff.
- Tests: domain, contracts, service/guard specs, auth/users e2e, and RTL tests for
  pick-username, welcome and gate routing.

### 8E — Health-data consent (migration, contracts, api, mobile)
- `privacy_settings` gains `health_data_consent` (boolean, default false) and
  `health_data_consent_at`. The migration is generated by drizzle-kit.
- Mirror the R2 AI-consent plumbing exactly:
  - `PrivacySettings` (domain)
  - `privacySettingsResponseSchema` / `updatePrivacyRequestSchema`
  - `PrivacyRepository` / `applyConsentTransition`
  - audit actions `privacy.health_consent_granted` / `privacy.health_consent_withdrawn`
  - `toPrivacyResponse` in the export
  - fixtures
- Enforcement follows the `BodyService.requireAiConsent` pattern: return 403 at
  `POST /integrations/whoop/authorize` and at `POST /health-data/observations`. WHOOP
  webhook/sync ingestion skips users without consent.
- Withdrawing consent stops new collection; existing data stays until disconnect or deletion,
  and the copy says so.
- Mobile:
  - New `health-consent.tsx`, modelled on `location.tsx` (the prototype's `s_location`
    explainer pattern and `allow location question.png`): icon tile, heading, three
    "why / what / if you decline" answers, "Allow" / "Not Now". The copy is drafted for later
    legal review.
  - `connect.tsx`'s WHOOP connect goes through this screen first when consent is off.
  - The Health Connect card stays inert (the ADR-035 device test is still owed), but the
    consent screen is ready for it.
  - `privacy.tsx` gains a "Health data" toggle row. Also fix `privacy.tsx`'s stale "Download my
    data" comment.

### 8F — Google sign-in, native (api, contracts, mobile)
**Domain and contracts**:
- `SOCIAL_AUTH_PROVIDERS = ['google','apple'] as const`.
- `socialSignInRequestSchema { provider, idToken, nonce? }`.
- The response is the session plus `isNewUser`.

**API**:
- `AuthProvider.signInWithIdToken({provider,idToken,nonce})`. `SupabaseAuthProvider` implements
  it via `client.auth.signInWithIdToken`.
- New `POST /api/v1/auth/social`, throttled like login. `AuthService.socialSignIn` calls
  `upsertFromIdentity` (which already creates `users`, `profiles` and `privacy_settings`) and
  writes an `auth.social_sign_in` audit entry recording `{provider,isNewUser}`.
- Supabase links identities that share a verified email to the same user id, so an existing
  email account keeps its data. Test this case.
- ADR-008 is kept: the client holds no Supabase credential.

**Mobile**:
- Add `@react-native-google-signin/google-signin`, the free "original" API, with its config
  plugin in `app.config.ts`.
- Code goes in `apps/mobile/src/integrations/auth/google.ts` (rule 4). A new conformance rule
  pins the import there, with a test file in `scripts/ci`.
- The Web client ID goes in `app.config.ts` `extra`. It is public, not a secret (rule 5).
- Wire `onGooglePress` in `login.tsx` and `signup.tsx`. New users go to "Your Profile" (8D);
  existing users go home.
- In Expo Go the native module is missing, so the button toasts "Google sign-in needs the FORJD
  app build" instead of crashing.

**Tests**: provider spec, service spec, controller spec, e2e with a stubbed provider, and RTL
tests with the Google module mocked.

**Live test**: an EAS Android development build on the `forjd_pixel7_api34` emulator (Play
Store image, signed-in Google account), against staging. This needs the user's manual setup
below first. If that isn't done yet, merge with mocked tests and record the live round-trip as
owed, the same way WHOOP was handled.

### 8G — Apple sign-in code, "Coming soon" (mobile + api path from 8F)
- Add `expo-apple-authentication`. The nonce is generated with `expo-crypto` (installed): the
  SHA-256 hash goes to Apple, the raw value to `/auth/social`.
- The code lives in `integrations/auth/apple.ts`.
- The Apple button renders disabled with a "Coming soon" note on both platforms, gated by
  `extra.appleSignInEnabled = false`.
- The server path is already covered by 8F's endpoint; add Apple-specific tests (nonce required).

### 8H — Readable grey text (mobile)
- Publish a private sample page (an artifact) showing the current and candidate greys on real
  FORJD surfaces, with contrast ratios. The user picks, and this step blocks until they do.
- The measured minimum is about `#85857C` to clear 4.5:1 on every background. The candidates
  keep the label / dimmer / tabInactive hierarchy by targeting the backgrounds each token
  actually sits on.
- Apply the chosen values in `apps/mobile/src/theme/tokens.ts` and `tailwind.config.ts`.
  Replace the ~58 hard-coded `#77776F` / `#6E6E66` / `#6B6B64` inline hexes (about 20 files,
  e.g. `workout-done.tsx`, `train.tsx`, `live-exercise-card.tsx`) with the tokens.
- Add assertions to `theme/__tests__/tokens.test.ts`, plus a test that no raw grey hex remains
  in `src`.

### 8I — Close out (docs)
- **ADR-041**: social sign-in via native ID token through the API.
- **ADR-042**: age gate at 16, including the delete-on-underage choice.
- **ADR-043**: health-data consent semantics.
- Update the `security.md` checklist ticks, `system.md`/`integrations.md` auth notes,
  `phase-8-plan.md` status, and the roadmap session-close entry.

## Manual steps only the user can do (listed for them, not blocking the code)

1. **Google Cloud** (existing GCP project):
   - OAuth consent screen.
   - Web client ID and secret. The secret goes into the **Supabase dashboard** Google provider,
     never the repo.
   - Android client ID using the EAS signing SHA-1 (from `eas credentials`).
   - Later, an iOS client ID.
2. **Supabase (forjd-dev / staging)**: enable Google, and add the Android/Web client IDs to its
   authorized client IDs.
3. The owed items that remain as they were: the Apple Developer account (turns Apple on), the
   token lifetime to 900 s, the 6F Android device test, the live WHOOP round-trip, the lawyer,
   and the Play Console.

## Verification

For each slice:
- `pnpm --filter @forjd/domain test`
- `pnpm --filter @forjd/contracts test`
- `pnpm --filter @forjd/api test:cov` (the per-file 100% list gets the new service files)
- `pnpm --filter @forjd/api test:e2e` against local Postgres
- `pnpm --filter @forjd/mobile test`, `typecheck` and `lint`
- `pnpm conformance`
- `pnpm -r build`
- `code-reviewer` agent: fix CRITICAL and HIGH findings before merge
- merge, then confirm the CI run on `main` is green
- UI slices also get a web or emulator screenshot compared against `signuppage2.png`,
  `allow location question.png` and `privacy settings 1/2.png`

End to end (auth):
- Register by email, then "Your Profile" with an under-16 DOB. The account is removed (Supabase
  user gone), the welcome message shows, and logging in again fails.
- With a 16+ DOB, sign-up completes normally.
- Calling a workout route with a null-DOB token returns 403 `date_of_birth_required`.
- Google sign-in on the emulator dev build creates a user, lands on "Your Profile", and a second
  sign-in goes straight home.
