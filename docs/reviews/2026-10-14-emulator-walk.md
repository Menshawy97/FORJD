Fixed: "Heart rate and calories for your runs" / "Used by runs" 

Part 2 of `docs/product/beta-readiness-plan.md`. Android 14 emulator (`forjd_pixel7_api34`, Google
Play image) with the EAS dev-client build `cd2102a5` and the JavaScript from `main` served by Metro,
pointed at **staging**. The owner signed in once with a staging test account.

How to repeat it: `C:\Android\Sdk\emulator\emulator.exe -avd forjd_pixel7_api34`, install the
dev-client APK, then start Metro with `REACT_NATIVE_PACKAGER_HOSTNAME=localhost` and
`API_BASE_URL=<staging>` (the repo's `.env.local` points the packager at the LAN address
`192.168.1.5` for a real phone, which the emulator cannot reach), `adb reverse tcp:8081 tcp:8081`,
and open `exp+forjd-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`. Start
Metro with `GOOGLE_MAPS_ANDROID_API_KEY` set, or the run screen shows its fallback drawing instead
of the map (`extra.hasMapsKey` is read when Metro starts; the key itself is in the build).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | A workout could not be opened on a fresh install: "Could not load this workout." Cause: `no such table: exercises_cache`. Only the Library and exercise screens created the catalogue tables; the Train tab, workout detail, workout done and workout share read them without creating them | Fixed in the shared-connection PR: the catalogue creates its tables as it opens |
| 2 | **Critical** | Runs and workouts could not be saved ("Run not saved — try Finish again"), and the Library stayed empty. Cause: expo-sqlite gives every open of the same file one native connection and closes it for everyone when any JavaScript handle is garbage collected (`NativeDatabase.sharedObjectDidRelease` calls `close()` without checking its reference count). The stores opened a fresh handle per call and dropped it, so every later call failed with `NativeDatabase.prepareAsync ... NullPointerException`. This is not emulator-specific | Fixed: `store/shared-connection.ts`, one handle per database for the life of the app. Re-walked: Bench Day opens, names load, a workout finishes and reached staging once, 15 s later |
| 3 | Medium | The exercise catalogue downloads only when the Library (or an exercise screen) is opened. Until then a workout shows its exercises as "Exercise" | Fixed (owner decision 2026-10-14): the catalogue downloads at app start and at sign-in (`features/exercises/refresh-catalogue.ts`, from the root layout); the server answers 304 when nothing changed (#398) |
| 4 | Low (corrected) | First read as "rest-over alerts silent". Checked on the emulator: the `workout-rest` channel has the default notification sound, high importance and vibration, so the alert does sound. The real problem was the error "Custom sound 'default' not found" (a red development banner): `sound: 'default'` is read as a file name, and leaving `sound` out gives the same default sound | Fixed: `sound` removed (test `rest-channel.test.ts`). No new channel id needed, the sound is unchanged |
| 5 | Low | The live workout's set table header wraps "SET" to "SE / T" | Fixed: the set column is 24 px, so "SET" fits ([plan](../product/walk-small-fixes-plan.md)) |
| 6 | Low | Bench Day's preset shows "3×—": its exercises have a set count but no reps, time or distance target | Fixed: the workout page shows what the workout lays out, "3×10 reps" (presets have no target) |
| 7 | Low | Workout summary says "logged offline, will sync when you are back online" while online (it uploaded 15 s later) | Left as it is (owner decision 2026-10-14) |
| 8 | Low | The welcome screen says "AI Insights"; check whether FORJD Insight is rules-based before keeping the word "AI" | Fixed: insights are rules-based, so the welcome line says "FORJD Insight" and the Privacy switch is "AI scan reading", the one AI feature |
| 9 | **Critical** | No run recorded by the app could ever upload. `syncPendingSessions` handed the Outdoor Run lookup the **workout log** connection, but the lookup searches `exercises_fts` in the **catalogue** database; the search threw, the run read as "not synced yet" and stayed queued forever (queue row: "Outdoor Run exercise has not synced to this device yet"). Staging had never received a run; production has no sessions at all. `sync-sessions-run.test.ts` asserted the wrong connection | Fixed: the lookup opens the catalogue. Re-walked: the queued run uploaded to staging (11:34 UTC) |
| 10 | Watch | One native crash (SIGSEGV in React Native's `MountingCoordinator::pullTransaction`) while the dev client reloaded a new bundle. Not FORJD code, and in a dev-mode reload; watch for it on a real phone | Watch |
| 11 | Closed | After a dev reload, backgrounding did not trigger the queued upload; retested without a reload, returning to the app from the launcher uploaded the offline workout at once. It was the dev reload | Closed |
| 12 | Low | After the app was force-stopped mid-run, its run notification stayed in the status bar beside the next run's | Fixed: a leftover run notice is taken down at app start (`dismissStaleRunNotice`); a run picked back up posts its own |
| 13 | Low | Workout summary "Muscles worked" added 1 per exercise in the workout, done or not, under a "sets" label (one bench set read "Chest 2 sets, Triceps 1 set") | Fixed: History summaries count real sets too (Train hands over the sets it already has), and every summary lists its exercises (replica approved 2026-10-14) |
| 14 | Low | No "back online" trigger: after a workout finished offline, staying in the app once the network returned uploaded nothing (the triggers are launch, return to the app, the finish itself and the OS background task). Returning to the app uploaded it | Open, decide |
| 15 | **High** | Profile shows invented numbers as the person's own data: "InBody History: Last scan 8 days ago" and "Workout History: 147 sessions logged" are hard-coded (`app/(tabs)/profile.tsx:176-177`), and both rows do nothing when tapped. Staging has 0 scans and 3 sessions in total. Phase J ruled out invented numbers shown as a user's data | Fixed (slice A): real counts from the stats and scan list, a neutral line while loading or offline (owner chose real counts; replica approved 2026-10-14) |
| 16 | **Critical** | No phone could ever register for push. `defaultPushDeps.getUserId` read the stored `userId`, which no sign-in path ever saves (`saveSession` is called without an identity in login, sign-up, token refresh and social sign-in), so it was always null and registration returned "unavailable". Staging had never had a push token. The tests injected their own `getUserId`, so they could not see it | Fixed: the account comes from the access token (`getAccountId`). Re-walked: a token registered, and a test push arrived with the FORJD icon |
| 17 | Low | The Home bell (`features/home/home-header.tsx:39`) has no action: tapping it does nothing. Notification settings are reached only from Profile | Fixed (slice B): the bell opens a Notifications list of the server's pushes from the last 30 days, `GET /api/v1/users/me/notifications/feed` (replica approved 2026-10-14) |
| 18 | Low | The Train tab's "Previous workout" chip shows a run as "Outdoor Run 193.56m" (raw metres with two decimals) where the rest of the app says "0.19 km" | Fixed: the chip reads "0.19 km", like the card |
| 19 | Low | The run summary note "Watch calories are turned off for FORJD in Health Connect, so this run uses an estimate" shows while Calories reads "—": with no weight on the account there is no estimate | Fixed: with no estimate the note no longer claims one |
| 20 | Watch | "FORJD isn't responding" appeared once behind Health Connect's permission screen on a run's first ask. The emulator was slow at the time; watch for it on a real phone | Watch |
| 21 | Watch | Reminders are scheduled with a 1-hour window (inexact alarms), so a reminder can arrive up to an hour after its time | Watch |
| 22 | Low | The Connect screen shows Health Connect as "Coming soon", although runs already read heart rate and calories from it once health data is allowed in Privacy Settings | Fixed: "Heart rate and calories for your runs" / "Used by runs" |

## Walked and passed

- Sign-in (by the owner), Home with Weekly Forge, empty readiness, nutrition and stats.
- Start a run: precise location asked when the run opens, GPS strong, route drawn, distance right
  for the route fed (0.35 km for ~360 m), timer kept running with the screen locked, the run notice
  showed "2:02 · 0.14 km, Avg pace 14:55 /km".
- Notifications permission asked on Android 14.
- Live workout: timer, sets, rest screen with countdown and ±15/30 s, the lock-screen workout notice
  (`forjd-workout-live`, Done action).
- Finish double tap (#391): the saving state shows, one summary opens, one upload.

## Walked after the fixes (2026-10-14 afternoon)

- The real Google map on the run screen (Metro started with the Maps flag), with the route drawn through downtown Cairo.
- A run finished and saved: "Run complete", 0.35 km, 4:22, route map. Calories show "—" because the account has no weight.
- That run uploaded to staging once finding 9 was fixed.

- Offline finish (airplane mode): "Session complete" offline; the workout uploaded when the app came back to the front (12C).

- Weekly Forge share (Profile): the card is captured as an image and the Android share sheet opens with its preview.
- Rank tab: the opt-in card shows ("approximate location ... exact location is never stored"). Not opted in, to leave the staging account's privacy settings as they were; "coarse only, asked once" stays for the real phone, since this emulator had already granted precise location for the run.

- Notifications screen: the nine switches and quiet hours 22:00 to 07:00 show.
- Push (12F), after finding 16 was fixed: the token registered on staging and one test push arrived.

- Health Connect: allowing Health data in Privacy Settings, then the first run asks Health Connect for exactly two read permissions (active calories, heart rate). Heart rate allowed, calories refused: no note on that first run (by design: a refused metric is never read); on the next run (not asked again) the summary shows "Watch calories are turned off ... Open Health Connect", and the link opens Health Connect.
- Quiet-hours editor: the sheet opens, the time picker sets From, equal times are refused ("Pick two different times."), tapping outside closes without saving.
- Reminders (12E): two Weekly summary alarms are scheduled with Android (Sat 17 and Sat 24 Oct, 09:00). Watching one fire, and the workout reminder (needs a training pattern), stay for the real phone.

## Not yet walked

Nothing on the emulator list. For a real phone: a reminder actually firing, a full 30-minute locked run, real GPS, Google sign-in, Rank "coarse location, asked once".
