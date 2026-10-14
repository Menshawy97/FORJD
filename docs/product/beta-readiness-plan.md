# Beta readiness: production build wiring and an emulator device walk

Started 2026-10-14. The two things the assistant can do toward the limited Android beta without
the owner's hardware or accounts. The beta's other blockers (Play Console, a real Android 7+ phone,
custom SMTP, the production deploy of #390) stay in `remaining-checklist.md`.

## Findings (2026-10-14, `main` at `71efee1`)

- `apps/mobile/eas.json`: the `production` profile's `API_BASE_URL` is still the placeholder
  `REPLACE_WITH_PRODUCTION_CLOUD_RUN_URL...`. `app.config.ts:161` passes whatever it gets into
  `extra.apiBaseUrl`, and `apiClient.ts:97` uses it unchecked. A production build today would
  ship with a broken server address, and nothing stops one pointing at staging or `localhost`.
- The production API is `https://forjd-api-production-772363715082.europe-west1.run.app`
  (named in the docs; `/api/v1/health` answered `{"status":"ok","database":"up"}` on 2026-10-14).
- The `production` profile has no `GOOGLE_WEB_CLIENT_ID`. Without it the app reports Google sign-in
  as unavailable (`integrations/auth/google.ts`); nothing crashes.
- EAS environment variables: `GOOGLE_SERVICES_JSON` and `GOOGLE_MAPS_ANDROID_API_KEY` are set in
  development, preview **and production** (checked with `eas env:list`).
- No `expo-updates`, so no over-the-air update can carry a different address. A build-time check
  covers every route.
- Emulator: the SDK is at `C:\Android\Sdk`, and AVD `forjd_pixel7_api34` exists (Android 14,
  `google_apis_playstore`, x86_64).
- The newest Android dev-client build is EAS `cd2102a5` (8 Oct, commit `6eebbcf`, 289 MB APK).
  Nothing native has changed since: `git diff 6eebbcf..main` is empty for the mobile
  `package.json`, `app.config.ts` and the lockfile. It is still valid, and the JavaScript comes
  from Metro on this machine.

## Part 1: production build wiring

1. RED: `src/config/__tests__/api-base-url.test.ts` tests a pure
   `checkApiBaseUrl(profile, url)`. For `production` it must refuse a placeholder,
   `localhost`/`10.0.2.2`/`127.0.0.1`, anything with `staging`, and anything not `https://`. For
   other profiles it accepts anything. A second test reads `eas.json` and checks that the production
   URL passes, and that it differs from staging's.
2. GREEN: `src/config/api-base-url.ts` (pure, no Expo imports), called from `app.config.ts` with
   `process.env.EAS_BUILD_PROFILE`. A bad production address fails the build with a message saying
   which rule it broke.
3. `eas.json` production `API_BASE_URL` set to the production URL. Whether `GOOGLE_WEB_CLIENT_ID`
   goes in too depends on owner question Q1.
4. Check: `EAS_BUILD_PROFILE=production npx expo config --type public` succeeds with the real URL
   and fails with the staging URL swapped in. No EAS build is started (it costs a build credit and
   the beta needs a Play Console first).

## Part 2: emulator device walk

Run against **staging** (the dev client loads the JavaScript from Metro started with
`API_BASE_URL` set to staging). The emulator window is visible on the desktop, so the owner can watch
or take over.

| Walk item | On the emulator | Left for the real phone |
|---|---|---|
| Sign in, Home, tabs | Yes, once the owner signs in (see Q3) | |
| Live workout, sets, rest, Finish double-tap (#391) | Yes | |
| Workout lock-screen notice (12B) | Yes (lock with `adb shell input keyevent 26`) | |
| A run with GPS and the map | Yes (route played through the emulator's location) | Real GPS accuracy, outdoor |
| Background run, locked phone (12A) | Yes, shortened to a few minutes | The full 30 min, battery |
| Offline finish, then upload (12C) | Yes (airplane mode with `adb shell cmd connectivity airplane-mode`) | |
| Local notifications (12E) and the permission prompt | Yes (Android 14 asks) | |
| Quiet-hours editor | Yes | |
| Push token registers (12F) | Yes (Play image, FCM) | |
| A push arriving | Only if a push is sent to the staging token (Q4) | |
| Health Connect permissions, refusal note, "Open Health Connect" link | Yes | Real watch readings |
| Rank tab location (coarse, asked once) | Yes | |
| Large system text on Rank | Yes (`adb shell settings put system font_scale 1.3`) | |
| Google sign-in | No (needs the Google setup) | Yes |
| Weekly Forge share capture | Yes (dev client has view-shot) | |

Each item gets a screenshot and a pass or fail in `docs/reviews/2026-10-14-emulator-walk.md`.
Failures get fixed test-first, each in its own PR, and UI changes get a replica first.

## Owner questions

- **Q1:** Put `GOOGLE_WEB_CLIENT_ID` in the production profile now, or leave it empty until
  Google sign-in is set up for production?
- **Q2:** May I download the dev-client APK (289 MB, from expo.dev, the project's own build
  `cd2102a5`) to install it on the emulator?
- **Q3:** Sign-in: the assistant may not type a password into a real (non-local) server, so the
  owner signs in on the emulator once, with a staging test account.
- **Q4:** May I send a test push to the emulator's own staging token, so a push actually arrives?

## Owner answers (2026-10-14)

- **Q1:** include `GOOGLE_WEB_CLIENT_ID` in the production profile now (the same web client as
  staging). The Google button shows on production but fails until Google sign-in is set up there.
  That setup stays on the owner's list.
- **Q2:** yes, download the APK. **Q3:** yes, the owner signs in on the emulator. **Q4:** yes, one
  test push.

## Progress

- [x] Part 1 (2026-10-14). `eas.json` production has the real address and the Google web client.
  `apps/mobile/config/api-base-url.js` is plain CommonJS, because Expo's config loader compiles
  `app.config.ts` but not the TypeScript files it imports (the first try, a `.ts` file under `src/`,
  failed with "Cannot find module"). It is called from `app.config.ts`. Checked through the real
  loader with `npx expo config --type public`: production with the real URL loads; production with
  staging, localhost or nothing is refused; development with localhost loads.
- [ ] Part 2, the emulator walk
- [x] Part 2, emulator walk, first pass (2026-10-14): see
  [2026-10-14-emulator-walk.md](../reviews/2026-10-14-emulator-walk.md). It found a critical bug:
  runs and workouts could not be saved once a dropped SQLite handle was garbage collected. Fixed in
  the shared-connection PR, and re-walked. The rest of the walk list continues after that merges.
- [x] Part 2, second pass (2026-10-14 afternoon). Three critical bugs found and fixed, each re-walked:
  saving (#393, one SQLite connection per database), run upload (#393, the Outdoor Run lookup searched
  the wrong database), and push registration (#394, the account came from a `userId` no sign-in saves).
  Passed: real Google map, run save and upload, offline finish then upload, lock-screen workout notice,
  Weekly Forge share, push token and a test push, Rank opt-in card, large system text (1.3).

## Next (for whoever resumes)

1. Walk the rest on the emulator: Health Connect permissions (grant and refuse heart rate and calories
   alone; the refusal note and "Open Health Connect" link), local reminders firing (12E), and the
   quiet-hours editor. The report's "How to repeat it" section has the setup.
2. Fix the open walk findings test-first, in this order: 4 (rest alerts silent: the channel's
   `sound: 'default'` needs to go, with a new channel id), 13 (muscles counted twice), 5, 6, 7, 12.
3. Owner decisions needed first: 15 (invented Profile numbers: real counts or hide the rows, with a
   replica), 3 (download the exercise catalogue at sign-in/launch, not only from the Library),
   14 (upload on "back online"), 17 (what the Home bell opens), 8 (the word "AI").
4. Owner: run the production deploy for #390 (`gh workflow run deploy-api.yml --ref main -f
   target=production`), and a new dev-client build is not needed for any of these fixes (JS only).
- [x] Part 2 complete (2026-10-14 evening). Health Connect, the quiet-hours editor and reminder
  scheduling walked; findings 4 and 13 fixed (#396). The emulator list is done. The open findings
  (3, 5, 6, 7, 8, 12, 14, 15, 17, 18, 19, 22) need either an owner decision or a replica first;
  see the report.
