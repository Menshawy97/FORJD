# Phase 12E — local scheduled notifications

**Status (2026-10-05): approved by the owner. Slice 0 (this plan and ADR-064) merged (#334); slice 1 (the planner) merged (#335); slice 2 (the reconciler, hook and kinds 1 and 2 live) built, in review.** Every slice is its
own PR, test-first, reviewed, merged with `main` green. Decision record:
[ADR-064](../decisions/ADR-064-local-notifications-planned-and-rescheduled.md). Builds on 12D
([phase-12d-plan.md](phase-12d-plan.md)), which put the five switches on the server.

## Context

Phase 12D stored the notification switches on the server, but **nothing reads them yet**. 12E is the first thing
that does: notifications the phone schedules for itself (no server, no push, works offline, rule 6).

**Owner decisions (2026-10-05):**
1. Workout reminders **learn from the person's own training history** (days and usual start time); a custom
   program's weekdays win for the days. Not enough history: stay quiet, never guess.
2. The weekly recap arrives **Saturday morning, about 09:00 local**, right after the Saturday-to-Friday week closes
   (ADR-056), not Sunday evening as the design says.
3. The recap text is **fixed, with no numbers**. A scheduled local notification cannot look up fresh numbers when
   it fires; numbers come with server push (12F).
4. **All four extra reminders are wanted:** log your meals, no workout yet this week, Weekly Forge week closing,
   and a monthly weigh-in / InBody scan.

**Not in 12E:** push (12F), recovery alerts (12G), PR celebrations and leaderboard moves (server-side, 12F), the
quiet-hours editor (needs an approved design). The rest timer (ADR-026) and the 12A/12B ongoing run and workout
notices already exist and are untouched.

## The notifications

| # | Notification | Switch | When | Text (local, so values are allowed, ADR-061) | Tap opens |
|---|---|---|---|---|---|
| 1 | **Workout reminder** | `workout` (exists, on) | 30 min before the person's usual start on days they usually train; max one a day; skipped if they already trained today | "Workout in 30 minutes" plus the custom program's workout name for that weekday, else "You usually start around 18:00" | Train |
| 2 | **Weekly recap** | `weekly` (exists, on) | Saturday about 09:00 local | "Your week is ready. See how it went." (fixed) | Progress |
| 3 | **Log your meals** | new `meals` | About 19:30 daily; cancelled for today once a meal is logged | "Haven't logged food today? Add a meal." | Nutrition |
| 4 | **No workout yet this week** | new `noWorkout` | Thursday about 18:00, only if this week (Saturday to Friday) has no completed session; cancelled when one is finished | "No workout yet this week." plus "Keep your N-week streak" when the streak is above 0 | Train |
| 5 | **Forge week closing** | new `forgeClosing` | Friday about 18:00, only with the `weekly_forge` flag on and some ladder within 25% of its target (threshold to confirm at the mock-up) | "Your Weekly Forge week closes tonight. Check how close you are." (no numbers) | Home (Forge card) |
| 6 | **Weigh-in / scan** | new `weighIn` | Every 30 days after the latest scan or weigh-in, about 10:00; if none ever, 30 days after the switch is turned on | "Time for a monthly weigh-in or InBody scan." | Body / InBody |

Rules for every kind: **nothing between 22:00 and 07:00** (the screen's own "Two rules: nothing at night, nothing
you cannot act on"; a fixed window until a quiet-hours editor exists), nothing for an action already done, at most
one per kind per day. The new switches (3 to 6) default **off**: nudges should not surprise anyone.

**Still to confirm with the owner at the mock-up (slice 3):** the exact times above; where the permission prompt
lives (recommended: the first time the person turns a reminder switch on, plus a one-line note on the
Notifications screen when the phone's own setting is off, with an Open Settings link); the Forge 25% threshold.

## Design

**A pure planner, then a reconciler** (recompute, don't patch, in the spirit of rule 9).

- `packages/domain/src/local-notification-plan.ts` (pure, fully unit-tested; no UI, no SDK, rules 1-2) takes the
  switches, "now" as local calendar parts, the person's recent sessions (local weekday and start minute), the
  followed program's weekday map, this week's stats and the extra inputs per kind, and returns the notifications
  for the **next 14 days** as `{ id, kind, localDate, localMinute, title, body, route }`. Habit rule: a weekday
  qualifies when the person trained on it in at least 2 of the last 4 weeks; the reminder is 30 minutes before
  the median start minute on that weekday, dropped (not moved) if it would fall in quiet hours.
- `apps/mobile/src/features/notifications/local-notifications.ts` (the seam) cancels every FORJD-planned
  notification (deterministic ids `forjd-local:<kind>:<date>`) then schedules the plan. Idempotent. The scheduler
  is injected like `NotificationScheduler` in `apps/mobile/src/workouts/rest-notifications.ts`: reuse that interface
  and `defaultScheduler`, extend it with list and cancel-by-prefix, typed against the library's own types and never
  `as unknown as` (that cast hid ADR-026's silent-failure bug).
- A hook mounted in `apps/mobile/src/app/_layout.tsx`, beside `registerBackgroundUpload`, runs the reconciler on
  launch, on returning to the foreground, when a switch changes, and after a workout is finished, a meal logged,
  a program followed or edited, or a scan saved. Signed out: cancel everything.
- A 14-day rolling horizon keeps the pending count (about 35 in the worst case) well under iOS's 64-notification
  limit; a guard drops the furthest if it nears 60. If the app is not opened for 14 days the reminders stop. The
  12C background task could also run it; optional, later.
- Android: a new low-key "Reminders" channel (default importance, not the rest timer's HIGH). The shared
  foreground handler (`foregroundPresentation` in `apps/mobile/src/features/run/run-notification.ts`) lets reminders
  show as banners.
- Data it reads, all already available: `getWorkoutStats` (`thisWeek.trainedWeekdays`, `weekStreak`),
  `listWorkoutSessions` (start times), `getProgramEnrollment` and `getProgram` (`dayOfWeek`), today's nutrition
  log, `GET /forge` (flag-gated), the body scans list. A failure means "schedule nothing for that kind".
- Privacy: everything is composed and kept on the phone. `data-inventory.md` gets a row (scheduled local
  notifications: device only, contain program and workout names and habit-derived times, cleared on sign-out) and
  the FAQ an entry (wording needs the owner's approval, per the `faq-copy.md` process; ADR-061 requires the FAQ and
  the privacy policy to say what notifications contain).

**New switches (3 to 6)** extend `NOTIFICATION_PREFERENCE_KEYS` in
`packages/domain/src/notification-vocabulary.ts`; the 12D contracts and defaults derive from it. The server needs an
additive migration (four boolean columns, default false, drizzle-kit) on
`apps/api/src/database/schema/notification-preferences.schema.ts`, plus the export field and a data-inventory
update. Older app builds ignore the new fields (rule 7).

## Slices

0. **Docs:** this plan and ADR-064. (Merged, #334.)
1. **Planner (domain):** habit inference, quiet hours, the 14-day plan for kinds 1 and 2. Pure tests first. (Built: `packages/domain/src/local-notification-plan.ts`. The review added a guard that ignores malformed dates and minutes, and tests for the window and quiet-hour edges. Not done, by choice: de-duplicating two sessions on one day, which only skews the median slightly.)
2. **Reconciler, hook, kinds 1 and 2 live:** the seam, the channel, the triggers, sign-out cancel, tap routing.
   Fake-scheduler tests and a root-layout hook test (pattern: `root-layout-background-upload.test.tsx`).
   (Built: `apps/mobile/src/features/notifications/`. The seam is its own small interface rather than an extension of
   `NotificationScheduler`, like the run notice's. Review fixes: the plan is read inside the one-at-a-time queue and a
   newer ask supersedes older ones, so a slow older read can never overwrite a newer plan or re-schedule after a
   sign-out; the new plan is scheduled before stale reminders are cancelled, so a failure never leaves the person with
   nothing. It never asks for the permission: the prompt belongs to the switch rows, slice 3.)
3. **Mock-up for the owner's approval (no code):** the four new rows and the permission-off note on the
   Notifications screen, as a replica approved first (standing rule: no new UI without an approved replica).
   (Approved 2026-10-06: the screen, the permission-off note, the notification texts, titles and times, and the Forge 25% threshold. Because a switch that does nothing would mislead, each new row ships in the slice of the notification behind it, 5 to 8; the permission prompt and the note were built first, in `4b`.)
4. **New switches end to end:** domain keys, migration `0033`, contracts, export, deletion check, and the four rows
   on `notifs.tsx` (after approval).
   (Built, rows excluded: the four keys in `@forjd/domain` with defaults off, migration `0033_notification-reminder-switches`,
   contracts and fixtures, export, and the phone's store, whose loader now keeps an older build's five choices and fills
   the new keys from the defaults. The four rows wait for the approved mock-up.)
5. to 8. **One slice per extra kind:** meals, no workout this week, Forge closing, monthly weigh-in. Each adds its
   planner rules and its input.
9. **Docs close:** data inventory, FAQ (approved wording), roadmap, this plan's status.

## Verification

- Planner and habit rules: unit tests (empty history, one week only, two of four weeks, a custom weekday override,
  a usual time inside quiet hours, already trained today, the Saturday week boundary, a daylight-saving change day).
- Reconciler: fake scheduler asserts cancel-then-schedule, idempotence, the 60 cap and the signed-out cancel; a hook
  test.
- Server (slice 4): repository spec against real Postgres, e2e, export and deletion e2e, the coverage gate.
- Before every push, run every CI step locally, including the contracts and domain **lint** (a missed lint failed
  CI on #332): `pnpm --filter @forjd/domain` and `@forjd/contracts` `test:cov` and `lint`; `@forjd/api` `lint`,
  `test:cov` and `test:e2e` (Docker up, migrated); `@forjd/mobile` `typecheck`, `lint` and `test`;
  `pnpm conformance`.
- **Mandatory device walk** (ADR-026: Jest cannot prove the OS delivers anything): on the owner's iPhone with Expo
  Go, for each kind, confirm it is scheduled (list the pending ones), move the phone's clock to just before its time
  and confirm it fires, confirm it does not fire when its condition is already met (trained today, meal logged),
  and confirm sign-out clears them. Android is owed with the 12A to 12C walk (it needs an Android 7+ phone).

## Risks

- **Accepted limits of slice 2.** A workout finished offline is not on the server yet, so until it uploads the plan can
  still remind for a workout already done (the planner reads the server's sessions; a re-plan follows the upload).
  The habit read takes the last 100 sessions of any status, so someone who logs far more than a dozen a week could lose
  the older weeks. A tap that cold-starts the app calls the router right away, which may be too early on a slow
  start: check it in the device walk and add a navigator-ready wait if it drops.
- **The permission prompt, and a change from the approved design.** The switches start on, so on a new phone reminders are
  on before anything was asked. Asking only "the first time a reminder is switched on" would therefore never ask, and the
  reminders would silently never arrive. The Notifications screen also asks once, when it opens, if a reminder the phone
  schedules is on and the phone has not been asked. Android 13 and later need the Reminders channel to exist before the
  dialog can appear, so the ask creates it first. Android reports a first refusal as "can ask again", so a refusal seen
  on the screen shows the note straight away. Check all three in the device walk, on an Android 13+ phone as well.
- **Deploy order for the four new switches.** The phone's check of the server's answer requires all nine switches, and an
  old server's strict PATCH refuses a new key. So the API with migration `0033` must be live before a phone build that
  shows the four rows ships; an old server would otherwise stop the phone adopting the server's choices and hold a
  pending change for a new switch forever. The API deploys on merge to `main`, ahead of any app build, so this holds
  in the normal order; it is a release-checklist item, not code.
- **Habit inference guesses wrong early.** Mitigated by staying quiet with too little history and by one per day.
- **iOS's pending limit and Android battery killers.** Reminders are best effort, not guaranteed.
- **Stale conditions** (a nudge scheduled before the person trains). Mitigated by recomputing on every foreground
  and after every relevant action; a notification already handed to the OS cannot be recalled while the app is
  closed.
