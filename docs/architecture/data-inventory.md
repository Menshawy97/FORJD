# Data inventory

What personal data FORJD collects, where it lives, who else receives it, and whether account
export and deletion cover it. This is the source for the Google Play **Data safety** form and
the privacy policy. It was compiled from the code on 2026-09-19 (Phase 8, slice 8A). When a
feature changes what is collected, update this file in the same PR.

## Third parties

| Party | What it receives | Condition |
|---|---|---|
| Supabase | Email, password hash, auth ID, avatar and InBody image files, and the whole Postgres database | Always. Supabase is the auth, storage and database host. |
| Google / Apple (sign-in) | The user's own Google or Apple account identity, only when they choose that sign-in | Added by Phase 8 slices 8F/8G. FORJD receives an ID token with email and a stable subject ID, never a password. |
| OpenAI (`gpt-5.4-mini`, ADR-053) | The InBody scan photo | Only after the user grants AI consent (`privacy_settings.ai_features_consent`). Enforced in `BodyService.requireAiConsent`. |
| WHOOP | OAuth exchange; FORJD reads recovery, sleep and workout data from WHOOP | Only after the user connects WHOOP. |
| Sentry (server only) | Error type and stack frames only, no text; not sent at all for a user with crash diagnostics off; user ID kept only when it is on | The mobile app has no Sentry SDK. |
| NVIDIA | Nothing. A provider class exists but is not wired up. | Development only. |
| Analytics, ad, push services | Nothing. None are integrated. | `expo-notifications` and the small local Android notice module (ADR-063) post local notices only: the rest-complete alert, the run notice, the workout notice and, from 12E, the workout reminders and weekly recap the phone schedules for itself (planned on the phone from its own history, cleared on sign-out). Nothing is sent. |

Health data is never sent to analytics or advertising services (CLAUDE.md rule 15).

## Inventory

| Data | Collected at | Stored in | Encrypted at rest | In export | Removed by deletion |
|---|---|---|---|---|---|
| Email, auth ID | Sign-up, sign-in | `users`; Supabase Auth; device SecureStore | Platform default | Yes | `users` row yes; Supabase Auth user removed from 8B onward |
| Session tokens | Sign-in | Device SecureStore (Keychain/Keystore) | Yes (OS) | n/a | Cleared on device |
| Name, username, date of birth (required, age 16+), sex, height, units, goals | Onboarding, edit profile | `profiles` | No | Yes | Yes (cascade) |
| City (coarse text only, no coordinates) | Location screen | `profiles.city`, `workout_sessions.city`, `workout_sessions.city_slug` | No | Yes | Yes |
| Approximate start position of a workout (about 110 m), only if location for leaderboards is on | Workout start (coarse, foreground) | **Not stored on the server.** Sent to our API, resolved to a city, discarded. On the device only, in the recovery snapshot and upload queue until the workout uploads | n/a | No | Cleared on device with local data |
| Run route (precise GPS points), only while a run is open (ADR-049, ADR-059) | Run screen, through a location foreground service that keeps reading with the screen off; never background location (ADR-059) | **Device only**, in the local SQLite database until the run is discarded or the app data is cleared. Never uploaded | n/a | No | Cleared on device with local data |
| Run summary: distance, moving time, elevation gain, splits (ADR-050) | Run screen | `workout_run_summaries`, `workout_run_splits` | No | Yes (added with R2) | Yes (cascade) |
| Run heart rate and calories, from a watch or estimated (ADR-050) | Run screen, Health Connect | Same tables, **only with health-data consent**; dropped by the server otherwise | No | Yes (added with R2) | Yes (cascade) |
| Weekly city rank (rank, score, cohort size) | Weekly snapshot job | `leaderboard_rank_snapshots` (derived, replaced never patched) | No | No | Yes (cascade) |
| Weekly Forge position per ladder (level, best level, streaks, enrolment week), ADR-057 | Weekly evaluation job, from logged workouts and meal days | `forge_user_ladders` (derived; rebuilt by a refold, never patched) | No | Yes (`weeklyForge.ladders`) | Yes (cascade) |
| Weekly Forge locked weekly totals and results (workouts, kg lifted, km run, active minutes, days with meals logged; time zone) | Weekly evaluation job | `forge_weeks` (written once per week, never updated) | No | Yes (`weeklyForge.weeks`) | Yes (cascade) |
| Weekly Forge rewards ledger (Forge marks, band badges, Forged weeks) | Weekly evaluation job | `forge_rewards` (append-only) | No | Yes (`weeklyForge.rewards`) | Yes (cascade) |
| Weekly Forge summaries seen | Week-close summary screen | `forge_week_acks` | No | Yes (`weeklyForge.acknowledgedWeeks`) | Yes (cascade) |
| Avatar image | Profile photo | Storage bucket `avatars` (public URL) | Storage default | URL only | Yes (explicit delete) |
| InBody photo and body composition, plus the height and age on each scan | InBody scan, manual entry | Bucket `inbody` (private), `body_scans` (with `height_cm`, `age_years`), `body_measurements` | Storage default | Measurements, height and age yes; photo file no | Yes |
| Health metrics (heart rate, HRV, sleep, steps, active energy, weight, VO2 max, respiratory rate and others), only after health-data consent | Health Connect, WHOOP | `health_observations`, `health_connections` | No | Observations yes; connection rows added in 8C | Yes |
| WHOOP tokens | WHOOP connect | `external_connections` | Yes, AES-256-GCM (ADR-036) | Status only | Revoked at WHOOP, then deleted |
| Workouts (templates, sessions, sets) | Train, live session | `workout_*` tables | No | Yes | Yes |
| Offline workout log and queue | Live session | Device SQLite `forjd-workout-sessions.db` | No | n/a | Cleared on device from 8B onward |
| Nutrition log, custom foods, servings, macro goals, saved meals | Nutrition | `nutrition_log_entries`, `foods`, `food_servings`, `macro_goals`, `saved_meals`, `saved_meal_items` | No | Log yes; the rest added in 8C | Yes |
| Custom exercises, favourites | Library | `exercises`, `exercise_favourites` | No | Added in 8C | Yes |
| Programs and enrollments | Programs | `programs`, `program_enrollments` | No | Owned programs and active enrollment; past enrollments added in 8C | Yes |
| Goals, preferences | Settings | `goals`, `preferences` | No | Added in 8C | Yes |
| Notification switches and quiet hours (workout reminders, recovery alerts, PR celebrations, leaderboard moves, weekly summary, and from 12E log your meals, no workout this week, Weekly Forge closing, monthly weigh-in or scan; the last four start off; and the quiet-hours window, two minutes-since-midnight values, 22:00 to 07:00 until changed), Phases 12D and 12E and the quiet-hours editor | Notifications screen | `notification_preferences` (one row per user; no row means never saved; `quiet_start_minute` and `quiet_end_minute`, checked to be on the clock and different), plus a device copy and any unsent change in AsyncStorage `forjd.notificationPreferences.*` and `forjd.quietHours.*` (the quiet-hours window and an unsent change, both forgotten on sign-out), and the day the monthly weigh-in reminder started counting from (`forjd.weighInReminder.since.v1`, a date only, forgotten when the switch is turned off and on sign-out) | No | Yes (`notificationPreferences`) | Yes (cascade); the device copy is cleared on sign-out |
| Device time zone (IANA name, e.g. `Africa/Cairo`), sent by the phone for Weekly Forge week closes (ADR-057) | App launch, `PUT /users/me/timezone` | `preferences.timezone` | No | Yes (`preferences.timezone`) | Yes (cascade) |
| Consent flags | Privacy screen | `privacy_settings` | No | Yes | Yes |
| Audit trail | Auth and consent events | `audit_logs` | No | No | Rows kept with the user ID nulled; reset-request rows holding an email are scrubbed from 8B onward |
| On-device preferences and catalogue cache | Settings, library | AsyncStorage `forjd.*`, SQLite `forjd-exercise-catalogue.db` | No | n/a | Cleared on device from 8B onward |

## Draft Play "Data safety" answers

Derived from the table. Confirm against the final build and the lawyer's privacy policy.

- **Data collected:** personal info (name, email, date of birth), health and fitness info (health
  metrics, workouts, nutrition, body composition), photos (InBody scans, avatar), approximate
  location (city text only), app activity (workout and nutrition logs), app info and
  performance (server crash reports).
- **Shared with third parties:** InBody photos with OpenAI (after consent) and WHOOP OAuth
  exchange only. Hosting and processing by Supabase is service-provider processing.
- **Encrypted in transit:** yes. **Deletion available:** yes, in-app (Profile, Delete account).
- **Not collected on the server:** precise location, contacts, advertising ID, financial info. Once
  runs ship (ADR-049), the app *uses* precise location on the device while a run is open, keeps the
  route only on the device, and the Play Data safety form must say so. Since 12A (ADR-059) that use
  continues with the screen off, through a location foreground service with an ongoing notification;
  the form's "precise location" answer must say "while a run is open, including with the screen
  off". No background location permission is declared.
- **On the lock screen, on the device only (12B-2, ADR-061 decision 3):** the workout notice shows the
  current exercise, the set count and its weight and reps, and the elapsed time. They are training
  values, built on the phone and never sent. The Android notice module also keeps, on the phone, up to
  20 button ids (no values) tapped while the app was stopped, until the app next reads them. The
  "hide values on the lock screen" setting (12H) will govern the visibility.

## Known mismatches, tracked as follow-ups

- ~~`crash_diagnostics` only stripped the user field, and nothing scrubbed health values from
  exception messages or request bodies.~~ Fixed 2026-10-01 (G1): a user's "off" means their
  server crashes are not sent, and every server report keeps no text at all
  (`docs/architecture/security.md`).
- ~~`security.md` said "encrypted DB fields where appropriate"~~ Corrected 2026-10-05: it now says
  only WHOOP tokens are encrypted at the application layer, and the rest relies on the host's
  default encryption at rest.
- No data retention periods are defined anywhere yet. The privacy policy needs one.
- Health-data collection is gated by the separate health-data consent (ADR-043); Health Connect's
  on-device connect flow, when built, must use the same check.
- Date of birth is required of every account (minimum age 16, ADR-042) and is collected on the
  "Your Profile" step for email and Google/Apple sign-ups alike.
