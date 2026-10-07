# Phase 12F — server push

**Status (2026-10-06): the owner answered the four questions (see the end). Slice 0 (this plan) merged (#349); slice 1 (device tokens on the server) built; slices 2 to 7 follow.**
Every slice is its own PR, test-first, reviewed, merged with `main` green, and **each PR also updates this plan, the roadmap and
`remaining-checklist.md`** (standing instruction, 2026-10-06). Decisions already made:
[ADR-060](../decisions/ADR-060-push-notification-transport.md) (Expo push service behind a `NotificationProvider`),
[ADR-061](../decisions/ADR-061-what-a-notification-may-say.md) (what a push may say). Builds on 12D
([phase-12d-plan.md](phase-12d-plan.md): the `pr` and `rank` switches already exist on the server and nothing reads them yet)
and 12E ([phase-12e-plan.md](phase-12e-plan.md): local reminders, the permission ask, the Reminders channel, the quiet-hours editor).

## What 12F is, and is not

**In:** the phone registers a push token; the server sends two kinds of push, each behind its existing switch:

| Push | Switch | When | Text (no health value, ADR-061) | Tap opens |
|---|---|---|---|---|
| **PR celebration** | `pr` (default on) | Just after a workout session or run uploads and holds a new personal record (lifts and runs, owner 2026-10-06) | "New PR on Back Squat" (the exercise name is training, allowed by ADR-061 point 2); a run: "New PR: your longest run" or "New PR: your fastest pace", with no figures; several in one session: "3 new PRs in that session" | The session |
| **Leaderboard move** | `rank` (default off) | Once a week, when the Saturday snapshot shows the person's city rank changed | "You moved up in <City>" / "You moved down in <City>" (a rank the person published; the city name is on their public profile) | Rank tab |

**Out:** recovery alerts (12G: health data, own consent and device test), any new switch, any new screen (the two
switches and the permission note already exist, so this slice needs **no new UI** and therefore no replica), iPhone push
(waits for the Apple Developer account, ADR-007), push for the six local reminders (they stay local, ADR-064).

## What the code already gives us (read 2026-10-06)

- `apps/api/src/integrations/` holds `turnstile` and `whoop`; `push/` is new, with the conformance script extended (rules 3-4).
- The leaderboard baseline is taken by a **GitHub Actions workflow**, `leaderboard-snapshot.yml`, Saturday 00:20 UTC (weeks start
  Saturday, ADR-056). The roadmap line that says "Monday snapshot" is stale and is corrected in this PR. There is **no in-API
  scheduler** and there must not be one: Cloud Run scales to zero and runs several instances (the workflow explains why it is not
  `@nestjs/schedule`).
- 00:20 UTC is 02:20 in Cairo, **inside quiet hours**. So a push cannot simply be sent when the snapshot runs. It has to wait.
- Personal records are computed on read (`progress.repository.ts`: best weight per exercise against the prior best). Nothing detects
  "this upload set a PR" today.
- Session upload is idempotent and comes from the offline queue; it must never fail or slow down because of a push (the same rule the
  city lookup follows in `workout-sessions.service.ts`).
- `preferences.timezone` is stored per person (Weekly Forge uses it). Quiet hours are stored since the quiet-hours editor
  (`quiet_start_minute`, `quiet_end_minute`).
- `expo-notifications` 57 is installed, the EAS `projectId` is set, the Android Reminders channel and the permission flow exist.
  The Expo Go app cannot receive push on Android since SDK 53: the **dev-client build is required** (ADR-028), and the app needs a
  Firebase config in the Android build (see owner steps).

## Design

**One outbox, one drain.** Every push is a row in `push_outbox` (user, kind, payload ids, `dedupe_key` unique, `send_after`,
`sent_at`, status). Senders only write rows; a single `PushDispatchService` sends what is due. Reasons: it makes sending idempotent
(a retried upload cannot send twice), it handles quiet hours (a row's `send_after` is the next moment outside the person's quiet
hours in their time zone: **a push that would land inside quiet hours is moved to the first minute after them**, never dropped, owner 2026-10-06), and it works without a scheduler: a small GitHub Actions workflow (`push-drain.yml`, every 15 minutes, same
pattern and the same environment matrix as the snapshot workflow) runs a script that calls the service. Best-effort cron is accepted,
as for the snapshot. A PR push also tries an immediate send for that user after the upload response has gone out, so the usual case
needs no wait.

**Policy lives in one pure function** (`packages/domain`, unit-tested): given the kind, the switches, quiet hours, time zone, "now",
and what was already sent, it answers send now / send at T / drop. Drop reasons are explicit: switch off, no token, a PR from a
session older than 24 hours (an offline backlog uploaded days late is not news), already sent (dedupe key).

**Message builders, one function per kind** (ADR-061 point 5). Each has a unit test that feeds a fixture full of health values
(weight, heart rate, HRV, sleep, calories, readiness) and asserts none appears in title, body or data. The data payload carries only
the kind and ids. The exit check of 12F is this test plus a captured-payload test against the fake provider.

**PR detection** at upload: after the session is stored (never able to fail it), compare each exercise's best weight in this session
with the person's best **before** it (the first time anyone lifts an exercise is not a PR; the record needs something to beat).
Dedupe key `pr:<sessionId>`; one push per session, naming the exercise with the biggest jump, or a count when there are several. A
detection failure is logged and swallowed.

**Run records (owner chose lifts and runs).** Proposed rules, to confirm with the owner when slice 5b starts: a run is a record when it is
the **longest distance** the person has run, or has the **fastest average pace among runs of at least 2 km**, against their best before it
(the first run is not a record). Distance, time and pace are training facts, not health values, but the push **shows no figures**
("New PR: your longest run"), the safe reading of ADR-061; heart rate and calories are never read for this. A run uploads through
the same idempotent path, so the same dedupe key rule applies (`pr:<runId>`).

**Leaderboard move** is computed by the snapshot script itself: before it replaces the week's rows it already has last week's rank
(the "up 3 this week" arrow is exactly this comparison), so a move is the difference between the old baseline and the new standings.
It writes one outbox row per person whose rank changed, only for people in a cohort that qualifies (`MIN_COHORT_SIZE`) and who allow
the leaderboard (consent is already enforced for the board itself). Dedupe key `rank:<weekStart>:<user>`. The drain then delivers it
in the morning, local time.

**Token lifecycle.** `device_push_tokens` (user, token unique, platform, created, last seen), `ON DELETE CASCADE`. Registration
is idempotent and moves a token to the current account if the same phone signs in as someone else. The phone deletes its token
**before** sign-out clears the session (the call needs auth). Tokens the platform rejects (`DeviceNotRegistered` in the Expo
receipts) are deleted by the drain. The export lists the person's registered phones (platform and dates, **not the token value**: a token is a bearer-ish address, so it is never logged and never returned by any endpoint); account deletion removes them by cascade (tested).

## Slices

0. **Docs (this PR):** this plan, the roadmap (12F row, and "Monday" corrected to "Saturday") and the checklist. ADR-065 (the outbox
   and the drain, and why not an in-process scheduler) is written with slice 3, when the decision is built.
1. **Tokens (server), built 2026-10-06 (PR #350):** migration `device_push_tokens` (drizzle-kit), contracts, `POST` and `DELETE /api/v1/users/me/push-tokens`
   (versioned, rule 7), export, deletion check, data inventory. Real-Postgres repository spec, e2e, cascade test.
2. **Provider, built 2026-10-06 (PR #351):** `NotificationProvider` interface (`send`, `receipts`, and a `deadTokens` helper), `ExpoPushProvider` and a fake. **A thin `fetch` client, not `expo-server-sdk`**: it follows the Turnstile and WHOOP clients (injected `fetch`, Zod-checked replies, two attempts, no 4xx retry), has no dependency to keep current, and Expo's API is two small endpoints (send up to 100, receipts up to 1000). A shared contract suite runs against the fake and the real adapter, contract
   tests for the adapter (rule 8) with the network stubbed, conformance rule that only `integrations/push/` may import the SDK. Secret (optional Expo access
   token) read from server config only (rule 5), validated at startup.
3. **Policy, builders and outbox, in two PRs.** **3a, built 2026-10-07 (PR #352):** `packages/domain` `push-policy.ts` (`decidePush`: switch off, no token, too old (PR 24 h, rank 48 h, judged at the time it would go), else send now or **move to the first minute after the person's quiet hours in their own time zone**, DST days tested) and `push-messages.ts` (`buildPrPush`, `buildRankPush`, each with the ADR-061 test that hands it a fixture full of health values and proves none comes out; data carries only a kind and an id). **3b, built 2026-10-07 (PR #353):** migration `0036` (`push_outbox` and `push_tickets`), `PushOutboxRepository` (dedupe key, `FOR UPDATE SKIP LOCKED` claim, stale-claim take-back, tickets, purge), `PushNotificationService` (`enqueue`, `dispatchDue`, `checkReceipts`, `drain`: the policy is taken at queueing and again at sending; every phone of the person; dead phones removed; backoff 5, 10, 20, 40 minutes then failed; receipts read 15 minutes later), the outbox in the account export and the deletion check, and [ADR-065](../decisions/ADR-065-push-outbox-and-drain.md). The original wording: the `push_outbox` table and `PushNotificationService` (send due rows, record receipts, drop invalid tokens, bounded batch and retry),
   ADR-065.
4. **Phone, built 2026-10-07 (PR #354):** `features/notifications/push-registration.ts` (the seam: permission, the Android `updates` channel, the Expo token for the EAS project, `POST /users/me/push-tokens`, remembered in `store/push-token.ts` and not re-sent for a week; `unregisterFromPush` with a 3-second limit; `syncPushRegistration`: registers when PR celebrations or leaderboard moves is on and the phone allows it, removes the token when both are off), `use-push-registration.ts` (launch, foreground, on request, mounted in the root layout), `push-tap.ts` (a push tap opens `/workout/<id>` or `/rank`; the kind must be one we send and the id must look like an id), the Log out button removes the token before the session is cleared, the token is forgotten on sign-out, and turning on PR celebrations or leaderboard moves now asks the phone for permission like the reminders. No new UI. The original wording: permission asked when it first matters (the Notifications screen already asks for reminders; extend it so turning on
   `pr` or `rank`, and opening the screen with either on, also asks), token fetch and registration after sign-in and on launch when
   permitted, token deletion before sign-out, a separate Android channel (default importance, "Updates"), tap routing from the data
   payload (validated, never trusted), seam-injected so Jest covers it. No new UI.
5. **PR celebration sender, in two PRs. 5a built 2026-10-07:** `domain/lift-records.ts` (`sessionLiftBests`, `detectLiftRecords`, biggest jump first), `WorkoutSessionsRepository.priorLiftBestsForUser` (the heaviest completed lift before the session, same set rule as the Home PR card), `PrCelebrationService` (called by the upload after the workout is stored; never throws; queues `pr:<sessionId>`, then tries the outbox without waiting), real-Postgres spec and an e2e (first lift says nothing, a heavier one queues and sends, a retried upload is one push, a workout uploaded days late is dropped). Accepted: the immediate send runs the whole due batch, not only this row (the drain workflow is the safety net); a session with several records gets one push with a count. The original wording: 5a lifts: detection at upload, outbox write, immediate try, tests including the idempotent
   retry and the offline backlog drop. 5b runs: the two run-record rules above (confirmed with the owner first), same sender.
6. **Leaderboard move sender and the drain workflow, built 2026-10-07:** `domain/rank-moves.ts`; the weekly snapshot reads last Saturday's all-time standings **before** it replaces the week, queues one `rank:<weekStart>:<user>` push per mover through `RankPushSender` (only on a run that closes a week, so a mid-week manual run tells no one; a push failure is counted and never fails the snapshot); `push:drain` script and `push-drain.yml` (**every 3 hours, production only on the schedule**, staging by manual run: the repository is private, so Actions minutes are limited, and every 15 minutes on both environments would use the month in a week; the price is that a held or rank push can arrive up to 3 hours after quiet hours end, so **the owner decides** if a tighter cadence is worth the minutes); the drain run turns red when a step fails. The original wording: the snapshot script writes outbox rows; `push-drain.yml` and its script;
   tests for the comparison and the quiet-hours hold.
7. **Docs close:** data inventory (tokens, outbox), FAQ entry (wording needs the owner's approval, `faq-copy.md` process), roadmap,
   checklist, this plan's status, privacy-policy text for the owner (Expo named as a processor).

## Verification

- Policy and builders: unit tests (every drop reason, quiet hours across midnight and a same-day window, the Saturday 02:20 case
  held until morning, a time zone different from the server's, dedupe).
- Provider: contract tests against the interface with the fake; the real adapter's request shape tested without the network.
- Server: repository specs on real Postgres, e2e for the token routes, export and deletion e2e, the coverage gate.
- Before every push, every CI step locally (domain, contracts, API incl. e2e with Docker, mobile typecheck, lint and test, `pnpm
  conformance`).
- **Mandatory device walk** (Jest cannot prove delivery): on the owner's Android phone with the dev-client build, register a token,
  trigger a PR upload and see the push on the lock screen with no health value, tap it from a closed app, confirm the quiet-hours hold
  and that switching `pr` off stops it. iPhone is not part of 12F.

## Risks and accepted limits

- **Delivery is best effort.** GitHub's cron can be late or skipped (accepted for the snapshot already); Android battery managers can
  delay push; Expo's free tier has rate limits we will stay far under at this size.
- **Expo sees the generic text** on its way to Google (owner accepted, ADR-060). The privacy policy and the Play Data safety form must
  name it and the device token (owner tasks).
- **Nothing registers until the owner steps are done.** Without a Firebase project and an FCM key (owner step 1) and a new dev-client build, `getExpoPushTokenAsync` fails and the phone quietly does not register: the app behaves as before, and the server has no token to send to.
- **A forced sign-out (an expired session) cannot take the token off the server**, because it needs the sign-in. The old account keeps a token for that phone until the next person signs in on it (the server moves a token to whoever registers it) or the push service reports it gone. The same holds for a log-out with no connection (the removal gets 3 seconds, then the sign-out goes ahead and the local copy is wiped). Accepted for now; if it matters, the fix is for the server to drop a user's tokens when their refresh token is revoked.
- **Phone side race, closed (slice 4 review):** a registration still on its way when the person logs out removes its own token again, a token registered for another account is registered again at once, and syncs that start together send one request. Every push request gives up after 10 seconds.
- **A PR can be told late** if the person finishes a workout offline and uploads hours later (dropped after 24 hours by policy).
- **Time zone changes** can shift a held push by up to a day (the same class of limit as the Forge Friday date).
- **No scheduler in the API**, by design; if the drain workflow is disabled after 60 idle days (GitHub does this) held pushes wait.
  Mitigated by the immediate try for PRs; rank pushes are weekly and would simply be missed that week.

## Owner steps (I will walk through each one, one at a time, when we reach it)

1. A free **Firebase project** and its Android app (`com.forjd.app`), the `google-services.json` file, and an **FCM service-account
   key** uploaded to the Expo account with `eas credentials`. Needed before the device walk, not before the code.
2. A **new dev-client build** (a native dependency changes), then the device walk.
3. The **Play Data safety** and **privacy policy** wording for push (I draft it, you approve it).
4. (Later, with Phase 11) the Apple Developer account and an APNs key for iPhone push.

## Owner's answers (2026-10-06)

1. **Android first, iPhone later:** yes.
2. **PR celebrations:** lifts **and runs** (heaviest weight on a lift; runs by the rules proposed above, to confirm at 5b). Bigger than lifts alone, so it is two PRs.
3. **Leaderboard push:** up and down, any change, at most once a week.
4. **Quiet hours:** the notification is **moved to a time outside them** (the first minute after quiet hours end), not dropped.

## Questions that were asked

1. **Android first, iPhone later?** Recommended: yes (ADR-007; the Apple account is still missing).
2. **What counts as a PR celebration?** Recommended for 12F: the heaviest weight on a lift only. Runs (best time or distance) would
   need their own rules and can follow.
3. **Leaderboard push: any change, or only moves up?** Recommended: both directions, any change, at most once a week; or only up if
   you would rather never send a bad-news push.
4. **A push that would arrive during quiet hours: hold it until quiet hours end, or drop it?** Recommended: hold (the Saturday
   02:20 rank change reads fine at 07:00; a PR after a late workout reads fine the next morning).
