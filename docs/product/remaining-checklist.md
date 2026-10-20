# Remaining work checklist

Compiled 2026-10-05 from a read of `docs/` (roadmap, plans, reviews, architecture, ADR statuses), then
brought up to date with `main` at `ab49fa5` (engineering gaps G1-G7 and Phase 12A-12C merged).
Re-checked against the code, GitHub and the `forjd-prod` advisor on 2026-10-13 (`main` at `5f26c4d`).
`roadmap.md` stays the source of truth; tick items here as they close and update the roadmap in
the same PR. Items marked *(unconfirmed)* were reported by a review but not reproduced.

## 1. Only the user can do these

### Device tests (most urgent first)
- [x] Emulator walk, first pass (2026-10-14, [walk report](../reviews/2026-10-14-emulator-walk.md)): found and fixed the critical "Run not saved" database bug (runs and workouts could not be saved once a dropped SQLite handle was garbage collected), and found 6 smaller issues (listed in the report). The physical-phone items below still stand, but most of the app flow is now proven on Android 14
- [x] Emulator walk complete (2026-10-14): map, run, lock-screen notice, offline finish then upload, Weekly Forge share, Rank opt-in, large text, Health Connect ask and refusal note, quiet-hours editor, reminder scheduling. Fixed from it: workouts and runs not saving, runs never uploading, push never registering (#393, #394), rest alerts silent and muscles counted twice (#396), exercise names downloading only from the Library and no upload when back online (#398), invented Profile numbers (#400), the Home bell doing nothing (now a Notifications list, #401). Still open in the report: 5, 6, 7, 8, 12, 13, 18, 19, 22 (replicas or decisions first), and re-walking #398 and #401 on the emulator
- [x] Re-walked on the emulator (2026-10-14): #398 upload when back online (finished offline, stayed in the app, uploaded within 50 s), #400 Profile counts ("5 sessions logged", "No scans yet") and #401 the Notifications list (empty state, back to Home)
- [x] Live workout PREV column (2026-10-14, #402, [plan](live-prev-column-plan.md)): PREV shows last time's same set and today's sets start filled with it, offline from a phone memory; it was always "—" before. Walked on the emulator
- [x] Emulator walk findings closed (2026-10-14): 12 leftover run notice (#403); 5, 6, 8, 18, 19, 22 small fixes and the AI wording (#404); 13 workout summary counts and Exercises list (this PR). 7 left as it is (owner). See [walk-small-fixes-plan.md](walk-small-fixes-plan.md)
- [ ] **Health Connect test on a physical Android phone** (ADR-035, R8, 8.5 S10). Grant and refuse heart rate and calories each alone; the run must keep whichever was granted. Also (ADR-067): on the permission screen tap **privacy policy** and see getforjd.com/privacy in the browser.
- [ ] Dev-client build, then walk: a real run (GPS, map, keep-awake, pause on lock)
- [ ] 12A locked-phone 30-minute run, 12B workout-notice walk, 12C offline-finish-then-upload walk (needs an Android 7+ phone; your OPPO A37f is Android 5.1.1, so an EAS build plus a borrowed phone or an emulator)
- [ ] Location on the Rank tab (`aapt dump permissions` shows coarse only, asked once)
- [ ] Google sign-in
- [ ] New icon and splash
- [ ] Height/age screens (slices C-G)
- [ ] Large system text on Rank (8.5 S8 font-scale cap)
- [ ] Weekly Forge share capture (Expo Go cannot do it)
- [ ] Leaderboard snapshot on a Monday on production (re-run replaces, not duplicates)
- [ ] Pixel check of Rank tab and athlete profile against their screenshots
- [x] `docker build` check that the city snapshot is in the image (2026-10-15): `docker build -f apps/api/Dockerfile .` finished (about 90 minutes on this machine), and inside the image `dist/cities/ingest/data/normalized-cities.json` is present, 2,559,357 bytes (same as the local `nest build`, 34,124 rows), owned by `node`, the user the server runs as
- [x] Decide whether owed device tests are carried into the beta: **yes** (owner, 2026-10-20). Phase 8.5 is closed; the device tests above stay owed and are done during the beta

### Cloud and production
- [x] Delete old `us-central1` Cloud Run services `forjd-api-production` and `forjd-api-staging` (done by the owner; confirmed 2026-10-09: only the two `europe-west1` services remain)
- [ ] Supabase access-token lifetime to 900 s (both projects)
- [x] Merge RLS-everywhere PR (ADR-066): merged as #386 (migration `0037`) and deployed to production 2026-10-08. The `forjd-prod` security advisor re-run on 2026-10-13 no longer reports `rls_disabled_in_public`; it lists 43 "RLS enabled, no policy" notices, which is the intended deny-all
- [x] Smoke-test the app on production (2026-10-20/21, on the emulator with a production APK from the new `production-apk` profile, #432): sign-up, Home and the bell list, a workout, a run, food logging, an avatar upload and account deletion all work on production. It found five bugs, all fixed test-first and re-checked on the emulator: a new account's workouts showed "Exercise" instead of names, summaries always said "logged offline", the avatar camera badge was a bare icon, a stale first GPS position stayed in a run's route and start position (#433), and **a deleted account's leftover token recreated its users row, deleted email included** (#434; the one orphan row it made was removed by hand with the owner's approval). Production redeployed with both: revision `forjd-api-production-00008-28x` at `7d68824` (2026-10-21)
- [ ] Supabase: enable leaked-password protection (dashboard) and move `pg_trgm` out of `public` (advisor warnings, separate from RLS; `pg_trgm` still flagged on 2026-10-13)
- [ ] Custom SMTP on the production Supabase project
- [x] Production deploy (2026-10-20): run 39412865660, revision `forjd-api-production-00006-w4g` at `d7df223`, health `{"status":"ok","database":"up"}`. Brings #390 (connection limits) and #401 (the Home bell's list) to production; migrations and seeds ran clean
- [x] **Fix the production service-role secret. Fixed and verified 2026-10-20:** the owner added a new version holding the service-role key; production redeployed (run 39455050905, revision `forjd-api-production-00007-49h` at `99bee4b`, health green). The media mirror copied 1,746 images with no failures; forjd-prod now has `exercise-media` (1,746 objects, a sample image serves publicly with HTTP 200) and `avatars`; the edge log shows both bucket calls as `role: service_role` with HTTP 200. Avatar upload and account deletion still to be tried by hand in the production smoke test. Original finding: GCP secret `forjd-production-supabase-service-role-key` held the **anon** key. GCP secret `forjd-production-supabase-service-role-key` holds the **anon** key. Supabase's edge log for the failed `POST /storage/v1/bucket` calls (11:14 from the media mirror, 11:15 from the new revision's avatar-bucket setup) shows `role: anon` on both the apikey and the authorization token. Storage settings are not the cause: both projects have RLS on and no storage policies; staging works because its secret is the real service-role key. Production therefore has no `exercise-media` or `avatars` bucket, and every service-role call from the production API fails: exercise images, avatar uploads, InBody photo uploads, **account deletion** (`auth.admin.deleteUser`) and server sign-out (`auth.admin.signOut`). Fix: add a new version of that secret holding the `service_role` (or `sb_secret_...`) key from the forjd-prod dashboard (Project Settings, API keys), then redeploy production so the media mirror runs and a new revision reads the key; afterwards `storage.buckets` on forjd-prod should list `exercise-media` and `avatars`
- [x] Real `API_BASE_URL` for the production profile in `apps/mobile/eas.json` (2026-10-14): the production Cloud Run URL, plus the Google web client (owner decision). `app.config.ts` now refuses a production build whose address is missing, a placeholder, this computer, staging, or not https (`apps/mobile/config/api-base-url.js`). See [beta-readiness-plan.md](beta-readiness-plan.md). The Google button shows on production builds but works only once the production Supabase Google provider is set up (the Google OAuth item below)
- [x] Google Maps key restricted to `com.forjd.app` + signing SHA-1, as EAS variable `GOOGLE_MAPS_ANDROID_API_KEY`

### Accounts and legal
- [ ] Apple Developer account (Apple sign-in, Phase 11, iPhone widgets)
- [ ] Play Console (beta, RevenueCat)
- [ ] Google OAuth consent screen and Supabase Google provider; live Google round trip
- [ ] Live WHOOP OAuth round trip (ADR-037)
- [ ] Lawyer: privacy policy, terms, consent wording, wger CC-BY-SA question
- [ ] Play Data safety form: copy the answers from [play-data-safety-answers.md](play-data-safety-answers.md) (2026-10-15, checked against the code, Google Maps SDK included). Settled 2026-10-15: the workout start position (sent rounded to about 110 m) is declared as **precise location, processed ephemerally, optional**, and the code stays as it is. Still open: whether the lawyer treats OpenAI reading scan photos as sharing
- [ ] Play Console **App content** forms, found missing 2026-10-15 (checked against Google's Play help pages that day):
  - [ ] **Foreground service: location.** The run keeps tracking with the screen off (ADR-059), so Play asks for a description, what breaks if Android stops it, and a link to a video of a user starting a run. Google's preset reasons are location sharing, navigation and geofencing, none of them fitness, so type your own (for example "GPS tracking of a run the user starts and stops; stopping it loses the route"). The video can be an emulator screen recording; the OPPO A37f cannot run the app
  - [ ] **Health Connect permissions.** A clear, specific reason for each one requested: heart rate and active calories, read during a run (R8, ADR-034). Google refuses vague reasons like "needed for app functionality". Needs the privacy-link fix below first
  - [ ] **Account deletion web link** (Data safety section). It must let people ask for deletion without the app. Use https://getforjd.com/privacy#control (the "Ask us" email line covers deletion); a clearer "Delete your account" line there would lower the risk
- [x] **Unused Android permissions** (2026-10-16): `RECORD_AUDIO` and `READ_MEDIA_IMAGES/VIDEO/AUDIO/VISUAL_USER_SELECTED` are now blocked (Play's Photo and Video Permissions policy), and Save Image asks write-only. Checked on the emulator with EAS dev build `0ec75b78`: none of the five in `dumpsys package`; Change photo opens the system photo picker with no permission prompt and the picked photo comes back; Save Image wrote the nutrition card to the gallery with no prompt. Details in [ios-settings-gaps.md](ios-settings-gaps.md)
- [x] **Save Image was broken on every share card** (found 2026-10-16 on that walk): from Expo SDK 57, `saveToLibraryAsync` from `expo-media-library`'s main entry is a stub that throws; `share-capture.ts` now uses `expo-media-library/legacy`. Fixed in the same PR, with a test that fails if the main entry is used again. The owed "real Save Image of a run card" on a phone still stands
- [x] Nutrition goals sheet covered by the keyboard on Android (seen 2026-10-16, fixed the same day): the three sheets with text inputs (goals, save meal, custom food) padded for the keyboard only on iPhone, relying on Android resizing the window, which it no longer does for these overlays with edge-to-edge. All three now share `SHEET_KEYBOARD_BEHAVIOR` (`'padding'` on both platforms, `src/components/sheet-keyboard.ts`), and `sheet-keyboard.test.ts` fails if a sheet goes back to iPhone-only. Checked on the emulator: the goals sheet keeps all four fields and Save above the keyboard; the custom-food sheet, whose title had gone under the status bar, is now capped at 85% with its fields scrolling between a fixed title and buttons (the goals sheet's approved pattern), and scrolls to Fat with the keyboard open. The short save-meal sheet uses the same setting but was not walked
- [x] Health Connect **privacy policy** link opens FORJD's policy (2026-10-15, [plan](health-connect-privacy-link-plan.md)): it used to open the app's last screen. Now a small activity opens getforjd.com/privacy in the browser. Checked on the emulator for Android 13 and 14, and merged under ADR-067 (one-time exception to rule 16). **Owed on a phone:** see the Health Connect item under Device tests
- [x] Profile Support group (2026-10-08, from the approved design): **Privacy Policy** opens https://getforjd.com/privacy in the phone browser and **Contact Us** opens an email to support@getforjd.com; the sign-up line's "Privacy Policy" opens the same page. **About App** (in the design) is not built: it needs its content decided. The same URL and address go on the store listings (still to enter)
- [ ] Business entity and D-U-N-S number

### Data and judgement
- [ ] `pnpm --filter @forjd/api inbody:eval` with an OpenAI key, must score >= 88% (add `heightCm`/`ageYears` to each truth file first)
- [ ] Hand-label Spike B ground truth
- [ ] Verify FAQ citations: Hopkins (2000), DiStasio Epley/Brzycki, 2026 ACSM position stand, ACSM Guidelines edition
- [ ] Dogfood gate (real training with the app)
- [ ] One real waitlist sign-up checked end to end
- [ ] Spike C (iOS pipeline)

## 2. Engineering still open (not scheduled)

### Privacy and honesty
- [x] L3-3: Sentry text and consent (G1, #312): reports keep only error type and stack frames; none sent when crash diagnostics is off
- [x] Define data retention periods: the published privacy policy ("How long we keep it") says data is kept until the account is deleted, finished notifications are deleted after 30 days, the run route never reaches the servers, and backups expire in the ordinary course. A qualified person still reviews it with the rest of the policy
- [x] `security.md` encryption claim corrected: only WHOOP tokens are app-level encrypted; the rest relies on the host (not verified here)
- [x] Revoked Health Connect permission reads as "no watch": built 2026-10-09. The run reader reports which of heart rate and calories Health Connect refused; the live heart-rate card and the run-complete screen show a note with an "Open Health Connect" link (replica approved 2026-10-09). **Device walk owed:** turn heart rate off in Health Connect, start a run, and check the note appears; turn it back on and check it goes. The FAQ line for "Why does heart rate show a dash?" was approved 2026-10-09 and is in the app: "If you turned heart rate off for FORJD in Health Connect, the run says so and links you there."
- [x] Watch calories summed across all Health Connect origins (rule 10): built 2026-10-09. `dataOrigin` is kept on every Health Connect reading; a run counts one app's calories (the app that gave the heart rate, else the app with the most). The other apps' records are untouched. **Device walk owed:** a phone where two apps write calories
- [x] ~~*(unconfirmed)* `AuthenticatedGate` date-of-birth `getMe` may misroute a new account after a quick account switch~~ not a bug (2026-10-13): signing out unmounts the gate, which cancels the old read, and `AuthGate` resets the date-of-birth store. Pinned by `date-of-birth-gate-account-switch.test.tsx`, which fails if the cancel check is removed

### Website
- [x] Privacy page "Waitlist" section (W4 step 3): published 2026-10-13 with the owner's approved wording. The email is used only to announce the launch, is deleted once the launch email has been sent, and is removed sooner on request to support@getforjd.com. See [checklist-cleanup-oct-plan.md](checklist-cleanup-oct-plan.md)
- [x] Terms of use text: published 2026-10-08 at https://getforjd.com/terms (#378); the sign-up "Terms of Service" words open it (#379). A qualified review is still owed under Accounts and legal
- [ ] Decide Free vs Pro. The "Save 40%" yearly label (it should be about 50%: $59.99 a year against $9.99 a month) is in the ADR-021 design only; the app has no pricing screen yet (the Profile "Go Pro" banner shows no prices). Use 50% when that screen is built in Phase 10
- [ ] Choose the launch-email service

### Runs
- [x] Leftover snapshot of an uploaded run: finish is now atomic (G6, #314)
- [x] Route array rebuilt every second (G6, #314)
- [x] Unused `run_points` table removed (G6, #314)
- [x] Miles option on the run screens (2026-10-14, [plan](run-miles-plan.md)): runs follow the Units setting (miles, /mi, mph, feet, mile splits, the notice and the Train card); runs are still saved in kilometres
- [x] Run share card (2026-10-15, [plan](run-share-card-plan.md)): Share on the run summary opens Share Run, with Route & Splits (route line, no map) and Stats Card; never heart rate or calories
- [x] Discarding a run whose snapshot clear fails was silent: fixed 2026-10-09. Discard tries the clear twice; if both fail the person still leaves the run but sees "Run not fully deleted ... may be offered back the next time you open Run". No design change beyond a system alert

### Speed and CI (low)
- [x] Leaderboard 15 s cache eviction (G3, #313)
- [x] Batch `GET /nutrition/foods?ids=` (G5, #315)
- [x] R28 wall-clock timing tests deleted (G4, #311)
- [x] `ci.yml` least-privilege token (G2, #311)
- [x] Re-measure cold start in europe-west1 (2026-10-15, staging, from Egypt): the first request after 20+ minutes idle took 6.3 s, 5.7 s and 5.7 s (was 14.6 s in `us-central1`, ADR-055); warm requests 0.3-1.0 s. Recorded in ADR-055. No change made: an always-on instance is billed
- [x] `pg` pool settings and pooler port on `DATABASE_URL` (2026-10-13): confirmed the session pooler (port 5432), and the API used pg's defaults (10 connections per instance, no connect timeout) with no Cloud Run instance cap. Now 5 per instance, 10 s idle and connect timeouts (`apps/api/src/database/pool-options.ts`), and `--max-instances 3` in `deploy-api.yml`; a spec keeps pool times instances within 15 connections. Live on staging 2026-10-13 and on production 2026-10-20

### Product and architecture
- [ ] **Press feedback probably never shows on a phone** (found 2026-10-20, production smoke test): a `Pressable`'s style function is not applied on device (the avatar badge proved it, #433), and buttons get their press scale or highlight from `pressScale`/`pressGhost` style functions. They look right because their look comes from `className`, but likely never react to a touch. Check on the emulator, then move the pressed state somewhere that applies
- [ ] Food search ranking (found 2026-10-20): searching "banana" lists baby foods first, alphabetically, before plain bananas. How results should rank is a product decision
- [ ] Home shows real-looking zeros (0 workouts, 0 kcal) for a few seconds while it loads, instead of placeholders (found 2026-10-20)
- [ ] `eas build` warns that the production profiles set the `production` update channel but `expo-updates` is not installed, so the channel does nothing. Decide whether over-the-air updates are wanted
- [ ] Phase 7 decision E: readiness baseline crossover when WHOOP connects mid-baseline
- [ ] Analytics rebuild tool for rule changes (deferred until rules first change)
- [ ] Barcode scanning decision
- [ ] kcal vs kJ default for kJ-majority markets
- [x] "Analyse" vs "Analyze" spelling consistency: resolved 2026-10-14, the one "Analyse" (the old Privacy AI subtitle) went with #404
- [ ] Heart-rate zones (Tanaka) as a possible feature
- [ ] Expo web cannot bundle (expo-sqlite worker); previews rely on HTML mirrors
- [x] `ADR-017` written (canonical exercise model) and the "reserved/unwritten" notes updated
- [x] InBody `confirm` orphaned photo on a failed save: now deleted (#329)
- [x] `live.tsx` Finish had no disabled state (confirmed, then fixed 2026-10-13): a second tap re-ran the save and the navigation (no duplicate workout: the queue and the server both key on the session id). Now extra taps are ignored, Finish shows a spinner and Cancel and Pause dim while it saves, and a failed save gives all three back for a retry (replica approved 2026-10-13). **Device walk owed:** finish a workout and tap Finish twice quickly; one summary opens
- [x] (fixed 2026-10-14: once queued, a failed navigation lets the workout go instead) `live.tsx` Finish: if navigation itself fails after the workout was queued, the screen says "Workout not saved" and a retry queues it again (harmless: the queue replaces by session id and the server ignores repeats, but the message is wrong). Older than the 2026-10-13 change; found by its review. Low
- [x] Contrast of chip and segment text measured and pinned in `tokens.test.ts`: `dim` and `metadata` pass everywhere; `segmentedInactive` passes on its track by a hair (4.501:1)
- [x] Onboarding brief (2026-10-15): the owner chose only Weekly Forge "How it works" opening by itself once, built before the beta ([plan](forge-how-it-works-once-plan.md)). A Units step at the end of sign-up and a "Get started" card on Home were offered and not chosen; permissions stay asked when first needed. **Device check owed** with the beta: a fresh account sees How it works once on its first Home visit
- [ ] Quiet-hours editor (12D follow-up): mock-up approved 2026-10-06. Slice 1 planner done (#346); slice 2 server storage built (migration `0034`, `quietHours` on `GET/PATCH /users/me/notifications` and the export); slice 3 the screen built (sheet, device copy, sync, planner input, sign-out clearing). **Device walk owed**, see the next lines

## 3. Planned phases not started
- [ ] Phase 12 decisions: ADR-059, 060, 061 and 063 accepted; **ADR-062 (widgets) still Proposed**, needs your decision
- [x] 12A background run built (#318-#321); **device test owed**
- [x] 12B workout lock-screen notice built (#323-#325); **device walk owed**
- [x] 12C background upload built (#327); **device walk owed**
- [ ] Limited Android beta (needs Play Console; 8.5 closed 2026-10-20 with the device tests carried into the beta)
- [ ] Phase 9 post-beta iteration
- [x] 12D the five notification switches on the server (#332); the quiet-hours editor is split out below
- [x] 12E local scheduled notifications: all six notifications, the permission ask and note, the four new switches, the FAQ section (approved 2026-10-06) and the rest-week rule are built (#335 to #344). Still owed, see the device-walk line below
- [ ] 12E device walk (owner): an iPhone and an Android 13+ phone. The permission prompt on a fresh install, a refusal shows the note, each reminder fires at its time and is skipped once done (food logged, workout finished), the FORJD logo shows, a tap opens the right screen including from a closed app
- [ ] Quiet-hours editor device walk (owner): an iPhone and an Android phone. Change opens the sheet; the real time picker sets From and Until; equal times are refused; Save updates the row and a reminder inside the window does not fire; tapping outside closes without saving; the choice survives a reinstall (it comes from the server)
- [x] (owner decision 2026-10-14: keep as is, to save Actions minutes) CI: stop `cancel-in-progress` cancelling runs on `main` (`.github/workflows/ci.yml`): make it apply to pull requests only, so every merge gets a full run (owner decision pending)
- [x] 12F server push built, all seven slices (#350 to #358), see [phase-12f-plan.md](phase-12f-plan.md): device tokens, the Expo provider behind `NotificationProvider`, the send policy and message builders, the outbox and dispatcher, the phone side, PR pushes for lifts and runs, rank pushes from the weekly snapshot, and the `push-drain.yml` workflow. **Nothing registers on a phone until the owner steps below are done.**
- [ ] 12F owner steps. **Done 2026-10-08:** Firebase project `forjd-8e910` with the Android app `com.forjd.app`; `google-services.json` is at `apps/mobile/` (gitignored) and `app.config.ts` reads it from the `GOOGLE_SERVICES_JSON` variable. `GOOGLE_SERVICES_JSON` and `GOOGLE_MAPS_ANDROID_API_KEY` are saved in EAS (checked in the development environment). **Also done (confirmed 2026-10-09):** the FCM V1 service-account key is uploaded to EAS (owner), and a dev-client build finished 2026-10-08 (EAS build `cd2102a5`, commit `6eebbcf`, after all of 12F). **Still to do:** install that build on an Android 7+ phone and walk it (see the 12F device walk below); the OPPO A37f (Android 5.1.1) cannot run it
- [ ] 12F device walk (owner, Android first): the permission ask when PR celebrations or leaderboard moves is turned on; the token registers (a row appears for the phone); a PR push after a heavier lift and after a longest or fastest run, tap opens the workout; a rank push after the Saturday snapshot, tap opens Rank; a push due in quiet hours arrives after them; logging out removes the token (no push afterwards); turning both switches off stops pushes
- [x] 12F production deploy: done 2026-10-08 (Deploy API to Cloud Run, target production); the push tables now exist there, a production drain run passed, and the scheduled drain covers staging and production
- [x] 12F FAQ: the two entries ("What are PR and leaderboard notifications?", "What does FORJD share to send these?") approved 2026-10-08 and in the app (44 questions in all)
$&
- [x] Website search (2026-10-08): home title and description now say "FORJD app", structured data (organization, website with the alternate names "FORJD app" and "Get FORJD", software application; no ratings, prices or download links) on the home page, a fuller Support description, the 404 page set to noindex, and a test that keeps every page title and description unique and the right length
- [ ] Google Search Console: **done 2026-10-08:** the getforjd.com Domain property is added and the sitemap (https://getforjd.com/sitemap-index.xml) is submitted. **Still to do (owner):** request indexing for /terms/ and /privacy/ (URL inspection), check back in a few days that the sitemap shows Success and the pages are indexed, and later add the website to the Google Play listing
- [x] Privacy policy page: the full policy (approved wording, 16 sections) replaced the outline and was published 2026-10-08 at https://getforjd.com/privacy, naming Mostafa Ashraf, an individual based in Egypt. Still open: a qualified person reviews the legal sections (basis, rights, transfers, Egypt's data protection law); the Play Data safety form; the hosting-region and backup wording stays generic on purpose
- [x] 12F privacy policy: already in the published policy (push token, platform and notification text; Expo then Google or Apple named as processors; 30-day deletion; token removed on sign-out). **Still owed (owner):** enter the Play Data safety form in Play Console using the wording at the end of [phase-12f-plan.md](phase-12f-plan.md)
- [x] **Settled 2026-10-20: the owner made the repository public, so Actions minutes are no longer capped; the push drain stays disabled until phones register.** GitHub Actions minutes (2026-10-08): about 1,880 of the 2,000 free minutes were used in 8 days (API deploys 655, CI on pull requests 636, CI after merges 515, Weekly Forge evaluation 50). Done to stop it: the push drain workflow is **disabled** in GitHub (re-enable with `gh workflow enable push-drain.yml` when phones register; it was once a day on both environments, about 150 minutes a month), CI runs the API, mobile and website jobs only for changes to that part, the API deploys only when API or shared-package files change, and Weekly Forge evaluation runs once a week instead of hourly on Fridays and Saturdays. Owner: check the exact balance at github.com/settings/billing, and decide whether to pay for more minutes, make the repository public (unlimited minutes for public repositories), or keep working inside the cap. Cloud Scheduler stays the free way to run the push drain more often
- [x] Housekeeping: 128 merged local branches deleted 2026-10-07 (each was an ancestor of main or matched a merged PR's final commit). Kept: main, `worktree-agent-acf680f476a74c000`, the one stash and the 8 worktrees (7 branches, 1 detached), which are still checked out
- [ ] 12G recovery alerts
- [ ] 12H Android widgets
- [ ] 12I iPhone widgets
- [ ] Phase 10 subscriptions (RevenueCat); Strength/Running/HYROX leaderboard scores
- [ ] Phase 11 iOS track. The parts that need no Apple account: [ios-no-account-plan.md](ios-no-account-plan.md)
  - [x] Slice 1 (2026-10-16): iPhone purpose strings name every camera and photo use, no Face ID prompt, background-task plugin (`processing` mode), `usesNonExemptEncryption: false`; `ios-settings.test.ts` also proves the Android manifest is unchanged
  - [x] Slice 2 (2026-10-16): EAS iOS simulator build passes (f3a08ef2). It found and fixed three build breaks: xmldom 0.9 broke iPhone prebuild, workspace packages were never compiled on EAS, `babel-preset-expo` was not the app's own dependency. The last two would likely also have stopped the first Android staging or production build
  - [x] Slice 3 (2026-10-16): App Store privacy labels written, ready to copy once App Store Connect exists: [app-store-privacy-labels.md](app-store-privacy-labels.md). Not used for tracking anywhere, so no App Tracking Transparency prompt; precise location is not "collected" under Apple's definition
  - [x] Slice 4 (2026-10-16): Apple Maps under a run on iPhone (mock-up approved, ADR-050 amended). Still to see on a real iPhone once the Apple account exists
  - [x] Slice 5 (2026-10-17): Apple Health merged switched off (ADR-069): `AppleHealthProvider`, library pinned, Android linking unchanged, conformance rule
  - [x] Apple Health permission text approved by the owner (2026-10-17), as written in `app.config.ts`
  - [ ] Turn Apple Health on (owner + Apple account): TestFlight on a physical iPhone reads heart rate and active energy during a run, refuses each alone, keeps whichever was granted (ADR-068 check 3); check a second run still reads both; confirm the readiness read side picks one sleep source per night; then set `APPLE_HEALTH_ENABLED` and confirm the App Store Health label
- [ ] Dual-platform public launch

## 4. Stale doc statements to correct
- [x] `slice-2-plan.md` RLS question marked resolved (ADR-038)
- [x] Roadmap old "Manual steps" list annotated with what is obsolete, done or still owed
- [x] `phase-3-plan.md` open questions 2-4 marked settled
