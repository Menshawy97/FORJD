# Checklist cleanup, October 2026: Finish double-tap, two unconfirmed findings, waitlist wording

Started 2026-10-13. Covers three `remaining-checklist.md` items the owner asked to close:
#2 the live-workout Finish button, #3 the two *(unconfirmed)* findings, #4 the privacy page's
waitlist section. Each is its own PR. `roadmap.md` and `remaining-checklist.md` are updated in
the same PR as each item closes.

## Findings (read from the code on `main` at `ed819dd`)

### F1. Finish has no in-flight guard (`apps/mobile/src/app/live.tsx:359`)
`handleFinish` marks the store finishing, finishes the session, then queues it in an async block
that ends in `router.replace('/workout-done')`. Nothing stops a second tap while that block runs.

- **No duplicate workout.** The phone's queue is `INSERT OR REPLACE` keyed by `session_id`
  (`apps/mobile/src/store/workout-session.ts:431`) and the server insert is
  `onConflictDoNothing` on the session id (`apps/api/src/workouts/workout-sessions.repository.ts:238`).
- **What a second tap does:** a second queue write (which replaces the first, resetting its retry
  state), a second summary, a second `router.replace`, and a second `activeWorkout.clear()`.
- Retrying after the "Workout not saved" toast must keep working, so the guard is released on
  failure.

### F2. Date-of-birth `getMe` after an account switch: not reproducible
`AuthenticatedGate` is mounted only while `authenticated` is true (`_layout.tsx:229`), which is
read from the session store. Signing out unmounts it, the effect cleanup sets `cancelled`, and
`AuthGate`'s mount calls `resetDateOfBirthGate()`. The app has no in-place account switch, so
signing in to another account always passes through a signed-out render first. A late `getMe`
from the old account therefore cannot redirect the new one.
Close as not a bug, pinned by a regression test.

### F3. `pg` pool settings
- API: `new Pool({ connectionString })` (`apps/api/src/database/database.module.ts:18`), so the
  defaults apply: up to 10 connections per Cloud Run instance, idle connections kept for 10 s,
  no connect timeout.
- `DATABASE_URL` is the Supabase **session** pooler (`production-setup.md` step 2). In session
  mode each client connection holds one database connection for as long as it is open.
- Cloud Run: no `--max-instances` in `deploy-api.yml`, so the platform default applies.
- `forjd-prod` (read 2026-10-13): `max_connections` 60, `statement_timeout` 2 min, 13 open.
- Risk: real but latent. Several instances at 10 connections each, plus a scheduled job, can
  exhaust the pooler, and new requests then fail to connect instead of waiting. Today's traffic
  is far below that.

### F4. Waitlist privacy wording
The table (`waitlist_signups`) holds an email address, a `source` (always `website`) and the
sign-up time. There is no removal endpoint, so removal is by emailing support. The policy names
the email and Cloudflare's bot check, but not the purpose, how long the list is kept, or how to
be removed.

## Slices

1. **F2 test (no behaviour change).** A routing test: signed in with `getMe` held pending, sign
   out, sign in as a second account, then resolve the first `getMe` with `dateOfBirth: null`. The
   new account must not land on `/pick-username`. It is expected to pass at once, because it
   pins existing behaviour. If it fails, that is the bug, fixed test-first in the same PR.
2. **F1 guard.** RED: a test where two quick Finish presses queue once and navigate once, plus
   one where a failed save still allows a retry. GREEN: a ref guard in `handleFinish`, released in
   the `catch`. Whether it is also *visible* depends on owner question Q1. If visible, a replica
   comes first.
3. **F3 pool.** Depends on owner question Q2. RED: a unit test on the pool options built from
   config. GREEN: set them. Deploy to staging, then production, and confirm the API still answers.
4. **F4 wording.** Draft below, then the owner approves it before anything is published (Q3 also
   decides how long the list is kept). Published to `apps/web/src/pages/privacy.astro` with the
   page's "last updated" date.

### Waitlist text (approved by the owner 2026-10-13)

In **What we collect**, the existing line stays. In **How we use it**, add:

> If you join the waitlist on our website, we use your email address only to tell you when FORJD
> launches. We do not add it to any other list or sell it.


In **How long we keep it**, add (its timing depends on Q3):

> Waitlist email addresses are deleted once the launch email has been sent. To be removed sooner,
> email support@getforjd.com and we will delete yours.

## Owner answers (2026-10-13)

- **Q1, Finish:** ignore extra taps **and** show that it is saving. A replica goes to the owner
  first, and no mobile code is written until it is approved.
- **Q2, pool:** set safe limits. Smaller pool, short idle timeout, a connect timeout, and a cap
  on Cloud Run instances. The connection type stays the session pooler.
- **Q3, waitlist:** emails are deleted after the launch email is sent. The final wording still
  goes to the owner for approval before it is published.
- **Replica (Q1):** approved as shown 2026-10-13. While saving, Finish dims to 60% with a white
  `ActivityIndicator` (the InBody confirm pattern) and keeps its width; Cancel and Pause dim to 40%;
  all three ignore taps. A failed save restores all three at once.
- **Wording (Q3):** approved 2026-10-13 without the launch-email-service sentence.

## Progress

- [x] Slice 1, F2 regression test (2026-10-13; passes, and fails with the `cancelled` check removed)
- [x] Slice 2, F1 replica approved, then guard plus saving state (2026-10-13; four new tests in `live.test.tsx`)
- [x] Slice 3, F3 pool limits (2026-10-13): `pool-options.ts` and `--max-instances 3`, merged (#390). Staging deployed and healthy (revision `forjd-api-staging-00070-zm6`, `/health` reports the database up). **Production deploy owed (owner):** run the Deploy API workflow with target production, then check `/health`
- [x] Slice 4, F4 wording approved, then published (2026-10-13)
