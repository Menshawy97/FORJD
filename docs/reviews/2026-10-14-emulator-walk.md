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

## Walked and passed

- Sign-in (by the owner), Home with Weekly Forge, empty readiness, nutrition and stats.
- Start a run: precise location asked when the run opens, GPS strong, route drawn, distance right
  for the route fed (0.35 km for ~360 m), timer kept running with the screen locked, the run notice
  showed "2:02 · 0.14 km, Avg pace 14:55 /km".
- Notifications permission asked on Android 14.
- Live workout: timer, sets, rest screen with countdown and ±15/30 s, the lock-screen workout notice
  (`forjd-workout-live`, Done action).
- Finish double tap (#391): the saving state shows, one summary opens, one upload.

## Not yet walked

Run finish with the fix, offline finish then upload (12C), local reminders firing (12E), quiet
hours, push token and a test push (12F), Health Connect permissions and the refusal note, Rank
location, large system text, Weekly Forge share, and the real map.
