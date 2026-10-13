# Remaining work checklist

Compiled 2026-10-05 from a read of `docs/` (roadmap, plans, reviews, architecture, ADR statuses), then
brought up to date with `main` at `ab49fa5` (engineering gaps G1-G7 and Phase 12A-12C merged).
Re-checked against the code, GitHub and the `forjd-prod` advisor on 2026-10-13 (`main` at `5f26c4d`).
`roadmap.md` stays the source of truth; tick items here as they close and update the roadmap in
the same PR. Items marked *(unconfirmed)* were reported by a review but not reproduced.

## 1. Only the user can do these

### Device tests (most urgent first)
- [ ] **Health Connect test on a physical Android phone** (ADR-035, R8, 8.5 S10). Grant and refuse heart rate and calories each alone; the run must keep whichever was granted.
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
- [ ] `docker build` check that the city snapshot is in the image
- [ ] Decide whether owed device tests are carried into the beta (this keeps Phase 8.5 open)

### Cloud and production
- [x] Delete old `us-central1` Cloud Run services `forjd-api-production` and `forjd-api-staging` (done by the owner; confirmed 2026-10-09: only the two `europe-west1` services remain)
- [ ] Supabase access-token lifetime to 900 s (both projects)
- [x] Merge RLS-everywhere PR (ADR-066): merged as #386 (migration `0037`) and deployed to production 2026-10-08. The `forjd-prod` security advisor re-run on 2026-10-13 no longer reports `rls_disabled_in_public`; it lists 43 "RLS enabled, no policy" notices, which is the intended deny-all
- [ ] Smoke-test the app on production after the RLS change (owner): sign in, log a workout
- [ ] Supabase: enable leaked-password protection (dashboard) and move `pg_trgm` out of `public` (advisor warnings, separate from RLS; `pg_trgm` still flagged on 2026-10-13)
- [ ] Custom SMTP on the production Supabase project
- [ ] Fix exercise-media mirroring on production (wrong key in the service-role secret, or a Storage RLS difference)
- [ ] Real `API_BASE_URL` for the production profile in `apps/mobile/eas.json`
- [x] Google Maps key restricted to `com.forjd.app` + signing SHA-1, as EAS variable `GOOGLE_MAPS_ANDROID_API_KEY`

### Accounts and legal
- [ ] Apple Developer account (Apple sign-in, Phase 11, iPhone widgets)
- [ ] Play Console (beta, RevenueCat)
- [ ] Google OAuth consent screen and Supabase Google provider; live Google round trip
- [ ] Live WHOOP OAuth round trip (ADR-037)
- [ ] Lawyer: privacy policy, terms, consent wording, wger CC-BY-SA question
- [ ] Play Data safety form (precise location during runs; heart rate and calories from Health Connect)
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
- [ ] *(unconfirmed)* `AuthenticatedGate` date-of-birth `getMe` may misroute a new account after a quick account switch

### Website
- [x] Privacy page "Waitlist" section (W4 step 3): published 2026-10-13 with the owner's approved wording. The email is used only to announce the launch, is deleted once the launch email has been sent, and is removed sooner on request to support@getforjd.com. See [checklist-cleanup-oct-plan.md](checklist-cleanup-oct-plan.md)
- [x] Terms of use text: published 2026-10-08 at https://getforjd.com/terms (#378); the sign-up "Terms of Service" words open it (#379). A qualified review is still owed under Accounts and legal
- [ ] Decide Free vs Pro. The "Save 40%" yearly label (it should be about 50%: $59.99 a year against $9.99 a month) is in the ADR-021 design only; the app has no pricing screen yet (the Profile "Go Pro" banner shows no prices). Use 50% when that screen is built in Phase 10
- [ ] Choose the launch-email service

### Runs
- [x] Leftover snapshot of an uploaded run: finish is now atomic (G6, #314)
- [x] Route array rebuilt every second (G6, #314)
- [x] Unused `run_points` table removed (G6, #314)
- [ ] Miles option on the run screens (still kilometres only; the Units setting's `mi` covers logged cardio exercises, not live runs)
- [ ] Run share card ("Route & Splits", currently "coming soon")
- [x] Discarding a run whose snapshot clear fails was silent: fixed 2026-10-09. Discard tries the clear twice; if both fail the person still leaves the run but sees "Run not fully deleted ... may be offered back the next time you open Run". No design change beyond a system alert

### Speed and CI (low)
- [x] Leaderboard 15 s cache eviction (G3, #313)
- [x] Batch `GET /nutrition/foods?ids=` (G5, #315)
- [x] R28 wall-clock timing tests deleted (G4, #311)
- [x] `ci.yml` least-privilege token (G2, #311)
- [ ] Re-measure cold start in europe-west1
- [x] `pg` pool settings and pooler port on `DATABASE_URL` (2026-10-13): confirmed the session pooler (port 5432), and the API used pg's defaults (10 connections per instance, no connect timeout) with no Cloud Run instance cap. Now 5 per instance, 10 s idle and connect timeouts (`apps/api/src/database/pool-options.ts`), and `--max-instances 3` in `deploy-api.yml`; a spec keeps pool times instances within 15 connections

### Product and architecture
- [ ] Phase 7 decision E: readiness baseline crossover when WHOOP connects mid-baseline
- [ ] Analytics rebuild tool for rule changes (deferred until rules first change)
- [ ] Barcode scanning decision
- [ ] kcal vs kJ default for kJ-majority markets
- [ ] "Analyse" vs "Analyze" spelling consistency
- [ ] Heart-rate zones (Tanaka) as a possible feature
- [ ] Expo web cannot bundle (expo-sqlite worker); previews rely on HTML mirrors
- [x] `ADR-017` written (canonical exercise model) and the "reserved/unwritten" notes updated
- [x] InBody `confirm` orphaned photo on a failed save: now deleted (#329)
- [ ] *(unconfirmed)* `live.tsx` Finish has no disabled state
- [x] Contrast of chip and segment text measured and pinned in `tokens.test.ts`: `dim` and `metadata` pass everywhere; `segmentedInactive` passes on its track by a hair (4.501:1)
- [ ] Onboarding brief (including showing Weekly Forge "How it works" once); needs owner approval
- [ ] Quiet-hours editor (12D follow-up): mock-up approved 2026-10-06. Slice 1 planner done (#346); slice 2 server storage built (migration `0034`, `quietHours` on `GET/PATCH /users/me/notifications` and the export); slice 3 the screen built (sheet, device copy, sync, planner input, sign-out clearing). **Device walk owed**, see the next lines

## 3. Planned phases not started
- [ ] Phase 12 decisions: ADR-059, 060, 061 and 063 accepted; **ADR-062 (widgets) still Proposed**, needs your decision
- [x] 12A background run built (#318-#321); **device test owed**
- [x] 12B workout lock-screen notice built (#323-#325); **device walk owed**
- [x] 12C background upload built (#327); **device walk owed**
- [ ] Limited Android beta (needs 8.5 closed, 12A-C, Play Console, device tests)
- [ ] Phase 9 post-beta iteration
- [x] 12D the five notification switches on the server (#332); the quiet-hours editor is split out below
- [x] 12E local scheduled notifications: all six notifications, the permission ask and note, the four new switches, the FAQ section (approved 2026-10-06) and the rest-week rule are built (#335 to #344). Still owed, see the device-walk line below
- [ ] 12E device walk (owner): an iPhone and an Android 13+ phone. The permission prompt on a fresh install, a refusal shows the note, each reminder fires at its time and is skipped once done (food logged, workout finished), the FORJD logo shows, a tap opens the right screen including from a closed app
- [ ] Quiet-hours editor device walk (owner): an iPhone and an Android phone. Change opens the sheet; the real time picker sets From and Until; equal times are refused; Save updates the row and a reminder inside the window does not fire; tapping outside closes without saving; the choice survives a reinstall (it comes from the server)
- [ ] CI: stop `cancel-in-progress` cancelling runs on `main` (`.github/workflows/ci.yml`): make it apply to pull requests only, so every merge gets a full run (owner decision pending)
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
- [ ] GitHub Actions minutes (2026-10-08): about 1,880 of the 2,000 free minutes were used in 8 days (API deploys 655, CI on pull requests 636, CI after merges 515, Weekly Forge evaluation 50). Done to stop it: the push drain workflow is **disabled** in GitHub (re-enable with `gh workflow enable push-drain.yml` when phones register; it was once a day on both environments, about 150 minutes a month), CI runs the API, mobile and website jobs only for changes to that part, the API deploys only when API or shared-package files change, and Weekly Forge evaluation runs once a week instead of hourly on Fridays and Saturdays. Owner: check the exact balance at github.com/settings/billing, and decide whether to pay for more minutes, make the repository public (unlimited minutes for public repositories), or keep working inside the cap. Cloud Scheduler stays the free way to run the push drain more often
- [x] Housekeeping: 128 merged local branches deleted 2026-10-07 (each was an ancestor of main or matched a merged PR's final commit). Kept: main, `worktree-agent-acf680f476a74c000`, the one stash and the 8 worktrees (7 branches, 1 detached), which are still checked out
- [ ] 12G recovery alerts
- [ ] 12H Android widgets
- [ ] 12I iPhone widgets
- [ ] Phase 10 subscriptions (RevenueCat); Strength/Running/HYROX leaderboard scores
- [ ] Phase 11 iOS track
- [ ] Dual-platform public launch

## 4. Stale doc statements to correct
- [x] `slice-2-plan.md` RLS question marked resolved (ADR-038)
- [x] Roadmap old "Manual steps" list annotated with what is obsolete, done or still owed
- [x] `phase-3-plan.md` open questions 2-4 marked settled
