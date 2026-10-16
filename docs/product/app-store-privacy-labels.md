# App Store privacy labels: answers to copy

Slice 3 of [ios-no-account-plan.md](ios-no-account-plan.md), written 2026-10-16 (`main` at cdfd0c0). Apple's
equivalent of Play's Data safety form: **App Store Connect, the app, App Privacy**. It maps
[play-data-safety-answers.md](play-data-safety-answers.md) onto Apple's categories, for the iPhone app
as it will ship. The facts are in [data-inventory.md](../architecture/data-inventory.md); a change to what
leaves the phone updates all three files in the same PR. Apple's definitions below are summarised from
its App Store Connect help page "App privacy details on the App Store".

## How Apple's form differs from Play's

- **Collect** means sent off the phone and kept longer than needed to answer that request in real time.
  Unlike Play, data held only for the request (Play's "processed ephemerally") is **not collected**.
- Apple has **no "shared" question**. Data our service providers process for us (Supabase, Google Cloud,
  Sentry, OpenAI, Expo) is declared as collected by FORJD; Play's Decision 2 (OpenAI) does not change a
  row here.
- For each type collected, Apple asks: is it **linked to the person's identity**, is it **used for
  tracking**, and for which **purposes** (Third-party advertising, Developer's advertising or marketing,
  Analytics, Product personalization, App functionality, Other). App functionality includes signing in,
  security and keeping the app from crashing.
- **Tracking** means linking data from this app with other companies' data for advertising, or sharing it
  with a data broker. FORJD does neither (CLAUDE.md rule 15: no analytics or advertising SDK), so
  **every row is "not used for tracking"**, and the app needs no App Tracking Transparency prompt.

## What is different on iPhone

- **No Health Connect and no Google Maps SDK.** The iPhone run map will be Apple Maps (owner decision
  2026-10-16, slice 4), an Apple framework, not a third-party SDK, so the Maps SDK's identifier and crash
  data from the Play sheet do not apply.
- **No Firebase.** iPhone push goes through Apple (APNs) via Expo.
- **Apple Health** (slice 5, ADR-068) will be read only, after the same health-data consent (ADR-043);
  it falls under Health below, which already covers WHOOP, scans and nutrition. Apple guideline 5.1.3:
  HealthKit data is never used for advertising and never stored in iCloud.
- **Sign in with Apple** (once the account exists) adds nothing new: name and email are already declared.

## Answers

The first question, "Do you or your third-party partners collect data from this app?": **Yes**.

Every row below: **linked to the person: Yes**, **used for tracking: No**. Data is linked because it is
stored against the account.

| Apple category | Data type | Purposes | What it is |
|---|---|---|---|
| Contact Info | Name | App functionality | Display name on the profile, leaderboards and the athlete profile |
| Contact Info | Email Address | App functionality | Sign-in and password reset |
| Health & Fitness | Health | App functionality, Product personalization | Heart rate, HRV, sleep, weight, body composition from scans, height, VO2 max, WHOOP readings and (slice 5) Apple Health, only after the health-data consent; nutrition logs and macro goals |
| Health & Fitness | Fitness | App functionality, Product personalization | Workouts, sets, runs (distance, time, splits, elevation; never the route), calories burned, steps, programs, Weekly Forge results, leaderboard scores |
| Location | Coarse Location | App functionality | The city on the profile and on each workout, for city leaderboards, only with location for leaderboards on |
| User Content | Photos or Videos | App functionality | The profile photo, and InBody scan photos (read by OpenAI only after the AI consent) |
| User Content | Other User Content | App functionality | Notes on workouts and sets; names of custom foods, exercises, templates, saved meals and programs |
| Search History | Search History | App functionality | Food searches: the words are in the request address, which the API's request log keeps |
| Identifiers | User ID | App functionality | Account ID and username |
| Identifiers | Device ID | App functionality | The push token, only with PR or leaderboard notifications on (see note 2) |
| Usage Data | Product Interaction | App functionality | Notification switches and quiet hours, which Weekly Forge summaries were seen, the notifications in the Home bell |
| Diagnostics | Crash Data | App functionality | Server error reports to Sentry: error type and stack only, no text; none for a person with crash diagnostics off, and the user ID only when it is on. The app itself has no crash SDK |
| Other Data | Other Data Types | App functionality | Date of birth (required, 16+) and sex (optional) |

**Not collected** (answer No): Phone Number, Physical Address, Other User Contact Info, Financial Info,
Precise Location (note 1), Sensitive Info, Contacts, Emails or Text Messages, Audio Data, Gameplay
Content, Customer Support (support is by email, outside the app), Browsing History, Purchases (until
Phase 10, note 3), Advertising Data, Other Usage Data, Performance Data, Other Diagnostic Data,
Surroundings, Body.

## Notes

1. **Precise location is not collected under Apple's definition.** The workout start position (rounded
   on the phone to about 110 m, `COARSE_DECIMALS`) travels in the body of the workout upload, the server
   turns it into a city and does not store it or log it. That is "only to answer the request", so it is
   not collected; the resulting city is (Coarse Location). The run route never leaves the phone
   (ADR-049, ADR-059). Play still declares it (precise, processed ephemerally), because Play has a
   separate "ephemeral" answer. If the position is ever stored or logged, add Precise Location here.
2. **Device ID is declared to be safe.** Apple describes Device ID as an advertising identifier or another
   device-level ID. A push token identifies an app install for delivery, not the device for tracking,
   and many apps leave it out; declaring it costs nothing on the listing and cannot be wrong. Remove it
   only if the lawyer prefers.
3. **Phase 10 (RevenueCat subscriptions)** will add Purchases (purchase history) and a new SDK. Update
   this sheet, the Play sheet and the data inventory then.

## Also asked in App Store Connect

- **Privacy policy URL:** `https://getforjd.com/privacy`.
- **Account deletion** (guideline 5.1.1(v)): in the app, Profile, Account, Delete account.
- **App Review notes:** the background location mode tracks a run the person starts and stops, When In
  Use only ([ios-settings-gaps.md](ios-settings-gaps.md) item 12).

These answers can be entered only once the Apple Developer account and the App Store Connect record exist.
