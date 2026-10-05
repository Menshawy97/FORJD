# Remaining work checklist

Compiled 2026-10-05 from a read of `docs/` (roadmap, plans, reviews, architecture, ADR statuses).
`roadmap.md` stays the source of truth; tick items here as they close and update the roadmap in
the same PR. Items marked *(unconfirmed)* were reported by a review but not reproduced.

## 1. Only the user can do these

### Device tests (most urgent first)
- [ ] **Health Connect test on a physical Android phone** (ADR-035, R8, 8.5 S10). Grant and refuse heart rate and calories each alone; the run must keep whichever was granted.
- [ ] Dev-client build, then walk: a real run (GPS, map, keep-awake, pause on lock)
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
- [ ] L3-3: Sentry does not scrub health values from exception messages; `crash_diagnostics` only strips the user id
- [ ] Define data retention periods (privacy policy needs them)
- [ ] Fix the `security.md` "encrypted DB fields" claim or encrypt more (only WHOOP tokens are encrypted)
- [ ] Revoked Health Connect permission reads as "no watch"; show an honest hint
- [ ] Watch calories summed across all Health Connect origins (possible double count, rule 10); filter by origin
- [ ] *(unconfirmed)* `AuthenticatedGate` date-of-birth `getMe` may misroute a new account after a quick account switch

### Website
- [ ] Privacy page "Waitlist" section (W4 step 3)
- [ ] Terms of use text
- [ ] Decide Free vs Pro; fix the app's "Save 40%" label (about 50%)
- [ ] Choose the launch-email service

### Runs
- [ ] Leftover snapshot of an already-uploaded run can be offered for recovery
- [ ] Route array rebuilt every second; memoise
- [ ] Remove or use the unused `run_points` table
- [ ] Miles option
- [ ] Run share card ("Route & Splits", currently "coming soon")
- [ ] Discarding a run whose snapshot clear fails is silent

### Speed and CI (low)
- [ ] Leaderboard 15 s cache never evicts old month keys
- [ ] Batch `GET /nutrition/foods?ids=` (first Nutrition visit is one request per food)
- [ ] Two R28 timing tests keep 2 s wall-clock bounds
- [ ] *(unconfirmed)* `ci.yml` has no top-level `permissions:` block
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
- [ ] Write `ADR-017` or fix the 10 references to it
- [ ] InBody `confirm` uploads the photo before the DB transaction (orphan on failure)
- [ ] *(unconfirmed)* `live.tsx` Finish has no disabled state
- [ ] Contrast checks never computed: small chip/segment text at `dim` and `segmentedInactive`
- [ ] Onboarding brief (including showing Weekly Forge "How it works" once); needs owner approval

## 3. Planned phases not started
- [ ] Phase 12 decisions (4 ADRs): background tracking, push transport, notification content, widgets
- [ ] 12A background run (Android foreground service)
- [ ] 12B strength session in the background
- [ ] 12C background upload
- [ ] Limited Android beta (needs 8.5 closed, 12A-C, Play Console, device tests)
- [ ] Phase 9 post-beta iteration
- [ ] 12D server-side notification preferences
- [ ] 12E local scheduled notifications
- [ ] 12F push
- [ ] 12G recovery alerts
- [ ] 12H Android widgets
- [ ] 12I iPhone widgets
- [ ] Phase 10 subscriptions (RevenueCat); Strength/Running/HYROX leaderboard scores
- [ ] Phase 11 iOS track
- [ ] Dual-platform public launch

## 4. Stale doc statements to correct
- [ ] `slice-2-plan.md` lists "Is RLS configured?" as open; ADR-038 and `security.md` resolved it
- [ ] Roadmap's old "Manual steps only the user can do" section lists steps already done
- [ ] `phase-3-plan.md` open questions 2-3 are probably settled
