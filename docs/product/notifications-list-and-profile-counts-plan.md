# Notifications list and real Profile counts

Owner decisions on emulator walk findings 15 and 17 (2026-10-14). Both replicas were **approved as shown**
on 2026-10-14 (shown in the session; this file is the record). Build each test-first, as its own PR.

## Slice A: Profile counts (finding 15)

**Built.** `features/profile/data-subtitles.ts`. Home's stats already carried `totalSessions`, so no API change. The
neutral lines are "Your logged sessions" and "Your InBody scans". A response missing its field, or a scan date that
cannot be read, reads as unknown.

Approved: in Profile → Data, only two subtitles change, in the normal grey. Tapping the two rows still does
nothing, as today.

- **Workout History:** "N sessions logged" from the real count ("1 session logged", "0 sessions logged").
  Source: the same stats Home already loads for its Workouts tile (check `app/(tabs)/index.tsx`'s stats
  request for a lifetime count; if it only has month and week counts, add `totalSessions` to that response
  in the API under `/api/v1`, additive, with a contract test).
- **InBody History:** "No scans yet", or "Last scan 14 Oct" (day and short month, the app's date style).
  Source: `listBodyScans()` (`auth/apiClient.ts:711`), the newest scan's date.
- While loading or offline: keep a neutral subtitle (not a number). Never show invented values.
- Remove the hard-coded "147 sessions logged" and "Last scan 8 days ago" (`app/(tabs)/profile.tsx:176-177`).
- Tests: `profile.test.tsx` cases for real counts, singular and plural, no scans, and loading/offline.

## Slice B: Notifications list (finding 17)

**Built.** API: `notifications-feed.controller.ts` / `.service.ts`, `PushOutboxRepository.listSentForUser` (at most 100
rows), contract `notifications-feed.ts`. App: `app/notifications.tsx`, `features/notifications/notification-feed.ts`
(groups, times, icons: the `rank` trophy glyph for a lift PR, `runner` for a run PR, `progress` chart for a rank move),
`push-tap.ts`'s `routeForPushData` shared with the push tap. A failure that is not offline reads "Could not load your
notifications. Please try again." The path is `/users/me/notifications/feed`, not the planned `/users/me/notifications`:
that one already serves the notification switches (12D), and CI's e2e test caught the clash.

Approved: the Home bell opens a new **Notifications** screen.

- **Shows:** the server's push notifications for the signed-in person from the last 30 days, PR celebrations
  and leaderboard moves only (owner choice: local reminders are not listed). Same title and body the push
  showed (`packages/domain/src/push-messages.ts`).
- **Layout:** back chevron, "Notifications" title, groups **Today** and **Earlier**, newest first. Each row:
  an icon in the 34px rounded tile (trophy for a lift PR, run for a run PR, chart for a rank move), the title,
  the body in grey, and a relative time on the right ("2h", "Sat", "9 Oct"). Under the list, the grey line
  "PR celebrations and leaderboard moves from the last 30 days." and an orange "Notification settings" link
  that opens the existing `/notifs` screen.
- **Taps:** a PR opens that workout; a rank move opens Rank (the same targets as tapping the push, see
  `features/notifications/push-tap`).
- **Empty:** bell tile, "Nothing yet", "Your PR celebrations and leaderboard moves show here for 30 days.",
  and the settings link. **Offline:** "You're offline. Notifications will show when you're back online."
- **API:** `GET /api/v1/users/me/notifications/feed`. It reads `push_outbox` rows for the user, `status = 'sent'`,
  `sent_at` within 30 days, newest first. It returns `{ items: [{ id, kind, title, body, data, sentAt }] }`.
  The authorization guard scopes it to the caller (rule 12). Add the contract in `@forjd/contracts`, and
  repository and service unit tests. The 30-day deletion already exists, so no new retention rule.
- **Mobile:** `apiClient.listNotifications()`, the screen at `app/notifications.tsx`, and
  `home-header.tsx`'s bell gets `onPress` → `/notifications`. Screen tests for filled, empty, offline and the
  two tap targets.
- Read state / unread dot: **not** in this design. Do not add one without asking.

## Also still open from the walk (`docs/reviews/2026-10-14-emulator-walk.md`)

- Visible fixes needing a replica first: 5 ("SE / T"), 7 ("logged offline" wording), 18 ("193.56m"),
  19 (calorie note when there is no estimate).
- To check: 6 (Bench Day preset "3×—"), 8 (the word "AI"), 12 (leftover run notification), 22 (Connect
  screen says Health Connect "Coming soon").
- Not yet re-walked on the emulator: #398's back-online upload (offline finish, stay in the app, signal
  back, upload within 30 s).
