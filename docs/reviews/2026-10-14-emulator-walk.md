# Emulator device walk, 2026-10-14

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
| 3 | Medium | The exercise catalogue downloads only when the Library (or an exercise screen) is opened. Until then a workout shows its exercises as "Exercise" | Open. Needs a decision: download at sign-in/launch (the server answers 304 when nothing changed) |
| 4 | Medium | Rest-over alerts are probably silent on Android. The `rest-timer` channel sets `sound: 'default'`, which expo-notifications treats as a file name ("Custom sound 'default' not found"); the platform default applies only when `sound` is left out. Android cannot change an existing channel's sound, so the fix needs a new channel id | Open, fix next (test first) |
| 5 | Low | The live workout's set table header wraps "SET" to "SE / T" | Open |
| 6 | Low | Bench Day's preset shows "3×—": its exercises have a set count but no reps, time or distance target | Open, check the preset seed |
| 7 | Low | Workout summary says "logged offline, will sync when you are back online" while online (it uploaded 15 s later) | Open, copy |
| 8 | Low | The welcome screen says "AI Insights"; check whether FORJD Insight is rules-based before keeping the word "AI" | Open, check |
| 9 | **Critical** | No run recorded by the app could ever upload. `syncPendingSessions` handed the Outdoor Run lookup the **workout log** connection, but the lookup searches `exercises_fts` in the **catalogue** database; the search threw, the run read as "not synced yet" and stayed queued forever (queue row: "Outdoor Run exercise has not synced to this device yet"). Staging had never received a run; production has no sessions at all. `sync-sessions-run.test.ts` asserted the wrong connection | Fixed: the lookup opens the catalogue. Re-walked: the queued run uploaded to staging (11:34 UTC) |
| 10 | Watch | One native crash (SIGSEGV in React Native's `MountingCoordinator::pullTransaction`) while the dev client reloaded a new bundle. Not FORJD code, and in a dev-mode reload; watch for it on a real phone | Watch |
| 11 | Closed | After a dev reload, backgrounding did not trigger the queued upload; retested without a reload, returning to the app from the launcher uploaded the offline workout at once. It was the dev reload | Closed |
| 12 | Low | After the app was force-stopped mid-run, its run notification stayed in the status bar beside the next run's | Open |
| 13 | Low | Workout summary "Muscles worked" showed Chest 2 sets and Triceps 1 set after a single completed set of bench press. Check whether a muscle listed twice for an exercise is counted twice | Open, check |
| 14 | Low | No "back online" trigger: after a workout finished offline, staying in the app once the network returned uploaded nothing (the triggers are launch, return to the app, the finish itself and the OS background task). Returning to the app uploaded it | Open, decide |
| 15 | **High** | Profile shows invented numbers as the person's own data: "InBody History: Last scan 8 days ago" and "Workout History: 147 sessions logged" are hard-coded (`app/(tabs)/profile.tsx:176-177`), and both rows do nothing when tapped. Staging has 0 scans and 3 sessions in total. Phase J ruled out invented numbers shown as a user's data | Open: needs the owner's decision (real counts, or hide the rows) and a replica |

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

## Not yet walked

local reminders firing (12E), quiet
hours, push token and a test push (12F), Health Connect permissions and the refusal note, large system text.
