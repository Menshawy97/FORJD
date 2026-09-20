# ADR-042: Minimum age of 16, asked once, enforced on the server

**Status:** Accepted
**Date:** 2026-09-19

## Context

`docs/architecture/security.md` listed "age gating -- minimum age decided and enforced" as a store
requirement. Health data is collected, so the conservative bar for the EU and US applies. Nothing
collected a date of birth at signup and nothing checked one.

## Decision

1. **The minimum is 16**, defined once as `MINIMUM_AGE_YEARS` in `@forjd/domain` (with
   `ageInYears` / `isOldEnough`, counted on calendar parts so a timezone cannot shift a day). The
   user chose 16 on 2026-09-19; the lawyer may move it, and it is a one-line change.
2. **Asked once, on the "Your Profile" step** that every new account passes through -- email
   sign-ups and Google/Apple sign-ups alike (design screenshot `signuppage2.png`). With email confirmation on (staging, and the
   intended production setting) an email sign-up gets no session, so the app shows a "Check your
   email" screen first and the "Your Profile" step comes right after the first login, via the
   signed-in gate. That sign-up also clears any login left on the phone from an earlier account,
   so it cannot be mistaken for the new one. That screen has a "Resend email" button:
   `POST /api/v1/auth/resend-confirmation` answers `202` for any well-formed address (a
   registered and an unknown one read the same, like forgot-password), is limited to three calls
   per fifteen minutes because each sends real mail, and writes no audit row (there is no user
   to attach it to without a lookup, and the raw address would need the account-deletion
   scrub). The app adds a 60-second countdown after each send.
3. **Enforced on the server, not only in the app** (rule 12). `JwtAuthGuard` refuses every route
   for an account with no date of birth (`403 date_of_birth_required`) except those marked
   `@AllowWithoutDateOfBirth()`: read your own account, give the date, upload the avatar that
   same screen offers, sign out, export your data, delete the account. A positive answer is
   remembered per identity; a negative one never is.
4. **Under 16 removes the account.** `PUT /users/me/date-of-birth` deletes the whole account
   through `AccountDeletionService` (including the Supabase login, ADR-008 path) and answers
   `403 underage`; the app signs out, wipes on-device data and says why on the welcome screen.
   An account that already has a date is never changed or deleted by this route: the same date
   again is a no-op, a different one is a `409`.
5. **The profile contract cannot walk around it.** Editing a profile must keep the holder 16 or
   older and can no longer clear the date.

## Consequences

- Accounts created before this slice have no date of birth and are asked for one on next launch.
- The gate is self-declared. A person who is turned away can sign up again with an adult date;
  their old token may also keep working until it expires, which recreates an empty account that
  is asked again. No document check exists and none is planned. Accepted.
- Legacy rows could in principle hold an under-16 date entered before the rule existed; none are
  known (pre-launch, developer accounts only). Re-check before opening a beta.
- Every e2e suite that registers a throwaway user calls `markAdult` from `test/support/adult.ts`.
