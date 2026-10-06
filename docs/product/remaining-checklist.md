# Remaining work checklist

Compiled 2026-10-05 from a read of `docs/` (roadmap, plans, reviews, architecture, ADR statuses), then
brought up to date with `main` at `ab49fa5` (engineering gaps G1-G7 and Phase 12A-12C merged).
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
- [ ] Delete old `us-central1` Cloud Run services `forjd-api-production` and `forjd-api-staging`
- [ ] Supabase access-token lifetime to 900 s (both projects)
- [ ] Custom SMTP on the production Supabase project
- [ ] Fix exercise-media mirroring on production (wrong key in the service-role secret, or a Storage RLS difference)
- [ ] Real `API_BASE_URL` for the production profile in `apps/mobile/eas.json`
- [ ] Google Maps key restricted to `com.forjd.app` + signing SHA-1, as EAS variable `GOOGLE_MAPS_ANDROID_API_KEY`

### Accounts and legal
- [ ] Apple Developer account (Apple sign-in, Phase 11, iPhone widgets)
- [ ] Play Console (beta, RevenueCat)
- [ ] Google OAuth consent screen and Supabase Google provider; live Google round trip
- [ ] Live WHOOP OAuth round trip (ADR-037)
- [ ] Lawyer: privacy policy, terms, consent wording, wger CC-BY-SA question
- [ ] Play Data safety form (precise location during runs; heart rate and calories from Health Connect)
- [ ] Support address and privacy-policy URL for store listings and the placeholder "Contact Us" / "Privacy Policy" rows
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
- [ ] Define data retention periods (privacy policy needs them)
- [x] `security.md` encryption claim corrected: only WHOOP tokens are app-level encrypted; the rest relies on the host (not verified here)
- [ ] Revoked Health Connect permission reads as "no watch"; show an honest hint
- [ ] Watch calories summed across all Health Connect origins (possible double count, rule 10); filter by origin
- [ ] *(unconfirmed)* `AuthenticatedGate` date-of-birth `getMe` may misroute a new account after a quick account switch

### Website
- [ ] Privacy page "Waitlist" section (W4 step 3)
- [ ] Terms of use text
- [ ] Decide Free vs Pro; fix the app's "Save 40%" label (about 50%)
- [ ] Choose the launch-email service

### Runs
- [x] Leftover snapshot of an uploaded run: finish is now atomic (G6, #314)
- [x] Route array rebuilt every second (G6, #314)
- [x] Unused `run_points` table removed (G6, #314)
- [ ] Miles option
- [ ] Run share card ("Route & Splits", currently "coming soon")
- [ ] Discarding a run whose snapshot clear fails is silent

### Speed and CI (low)
- [x] Leaderboard 15 s cache eviction (G3, #313)
- [x] Batch `GET /nutrition/foods?ids=` (G5, #315)
- [x] R28 wall-clock timing tests deleted (G4, #311)
- [x] `ci.yml` least-privilege token (G2, #311)
- [ ] Re-measure cold start in europe-west1
- [ ] *(unconfirmed)* `pg` pool settings and pooler port on `DATABASE_URL`

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
- [ ] 12F push: **planned** ([phase-12f-plan.md](phase-12f-plan.md)), waiting for the owner answers to its four questions (Android first? what counts as a PR? leaderboard push both ways? hold or drop in quiet hours?). Owner steps when we reach them: a free Firebase project and an FCM key uploaded with `eas credentials`, a new dev-client build, the device walk, the Play Data safety and privacy-policy wording
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
