# Play Data safety form: answers to copy

Checked against the code on 2026-10-15 (`main` at 180bb66). It follows the order Play Console asks in,
under **Policy and programs, App content, Data safety**. The definitions below are summarised from
Play's help page "Provide information for Google Play's Data safety section".

The facts behind each answer are in [data-inventory.md](../architecture/data-inventory.md). If a
feature changes what leaves the phone, update both files in the same PR. Two answers need a decision
first (marked **Decision**), and the lawyer review should see this sheet with the privacy policy.

## Words Play uses

- **Collected:** sent off the phone, by our code or by an SDK inside the app. Anything that stays on
  the phone is not collected.
- **Shared:** sent to another company. These do **not** count as sharing: a *service provider* that
  processes data for us and on our instructions, a transfer the user starts or expects, and a transfer
  required by law.
- **Processed ephemerally:** kept only in memory, only for the request that needed it. It is still
  declared, but not shown on the store listing.
- **Required or optional:** optional if the person can use the app without giving it.

Our service providers (processing for FORJD only): Supabase (database, files, sign-in), Google Cloud
(the API server and its logs), Sentry (server error reports), OpenAI (reading an InBody photo), Expo and
Google/Firebase (delivering push notifications). So, subject to Decision 2 below, FORJD **shares
nothing**.

## Section 1: Data collection and security

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Account, profile, workouts, health data and more are sent to our API |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | The API is HTTPS only (a production build refuses a non-https address, `apps/mobile/config/api-base-url.js`); Supabase, Expo push, Firebase and the Maps SDK all use HTTPS |
| Account creation methods | **Username and password** (email and password) and **OAuth** (Google sign-in) | Apple sign-in is built but off until the Apple account exists |
| Delete account URL | `https://getforjd.com/privacy#control` | The "Ask us" line offers deletion by email without the app. The app also deletes the account itself (Profile, Account, Delete account: `delete-account.tsx`, `DELETE /api/v1/users/me`). See the checklist note about a clearer "Delete your account" line |
| Can users ask to delete some of their data without deleting their account? | **Yes** | In the app: nutrition log entries, saved meals, custom exercises, favourites, leaving a program, and disconnecting WHOOP. Anything else by the email on the privacy page: body scans and logged workouts (no delete route), custom foods and workout templates (the API can delete them but no screen offers it yet) |
| Play Families policy / independent security review | **No** / **No** | FORJD is for ages 16+; no MASA review |

## Section 2: Data types

Answer **No** for every type not listed here: financial info, messages, audio, files and docs, calendar,
contacts, web browsing, installed apps, phone number, address, race and ethnicity, political or
religious beliefs, sexual orientation, app interactions (there is no analytics SDK), diagnostics, and
other app performance data.

For each type below, Play asks: collected, shared, processed ephemerally, required or optional, and
the purposes. "Shared" is **No** for every row (see above).

### Location

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| Approximate location | Yes | No | Optional | App functionality | The city on the profile and on each workout, for city leaderboards. Only if the person turns on location for leaderboards |
| Precise location | **Decision 1** | Yes | Optional | App functionality | The workout start position the phone sends to find the city (rounded to about 110 m, `COARSE_DECIMALS` in `integrations/location/location-provider.ts`; the server resolves it to a city and never stores it) |

Not collected: the run route. GPS points stay on the phone (ADR-049) and are never uploaded, even with
the screen off (ADR-059). Play still needs the separate foreground-service declaration (checklist).

**Decision 1.** Play's line between approximate and precise is an area of 3 square kilometres. A gym
workout's start position is read at low accuracy (`location-provider.ts`); a run's is its first GPS fix
(`live-run.ts`). Both are sent rounded to 3 decimal places, a square of about 110 m, which is on the
precise side. The rounding happens on the phone only. Either:
- **declare Precise location** as above (collected, ephemeral, optional). True today, no code change,
  but the store listing's data section will mention precise location; or
- **coarsen the position in code first** (round to about 0.03 degrees, a square of 3 km or more, in both
  `location-provider.ts` and `live-run.ts`, ideally checked by the server too), then declare only
  Approximate location. The cost: a workout started near a city border may count for the
  neighbouring city. A small mobile slice with tests.

### Personal info

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| Name | Yes | No | Required | App functionality, Account management | Display name on the profile, shown on leaderboards and the athlete profile |
| Email address | Yes | No | Required | Account management, App functionality | Sign-in and password reset |
| User IDs | Yes | No | Required | Account management, App functionality | Account ID and username |
| Other info | Yes | No | Required | App functionality, Account management | Date of birth (required, age 16+), and sex, which is optional (it can be left empty or set to "Rather not say"). Play takes one answer per type, and date of birth makes it required |

### Health and fitness

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| Health info | Yes | No | Optional | App functionality, Personalization | Heart rate, HRV, sleep, weight, body composition from scans, height, VO2 max and the other Health Connect and WHOOP readings (only after the health-data consent); nutrition logs and macro goals |
| Fitness info | Yes | No | Required | App functionality, Personalization | Workouts, sets, runs (distance, time, splits, elevation; no route), calories burned, steps, programs, Weekly Forge results and leaderboard scores |

Fitness info is required because logging training is the app. Health info is optional: nothing is read
from Health Connect or WHOOP without the separate health-data consent (ADR-043), and nutrition and
scans are features a person can skip.

### Photos and videos

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| Photos | Yes | No | Optional | App functionality | The profile photo, and InBody scan photos (read by OpenAI only after the AI consent) |

**Decision 2 (lawyer).** OpenAI reads the InBody photo through its API, under its business terms (no
training on API data). That fits Play's service-provider exemption, so "Shared" stays **No**. If the
lawyer prefers to treat it as sharing, answer Photos and Health info **Shared: Yes**, purpose App
functionality. The in-app AI consent already tells the person the photo goes to OpenAI.

### App activity

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| In-app search history | Yes | No | Optional | App functionality | Food searches. The words travel in the request address (`GET /api/v1/nutrition/foods`), which the API's request log (pino, `app.module.ts`) writes to the server logs, so it is not ephemeral |
| Other user-generated content | Yes | No | Optional | App functionality | Notes on workouts and sets, names of custom foods, exercises, templates, saved meals and programs |
| Other actions | Yes | No | Optional | App functionality, Developer communications | Notification switches and quiet hours, which Weekly Forge summaries were seen, the notifications listed in the Home bell |

### App info and performance

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| Crash logs | Yes | No | Optional | Analytics | Server error reports to Sentry: error type and stack only, no text; none for a person with crash diagnostics off. The Google Maps SDK also sends its own crash data while a map is shown |

### Device or other IDs

| Type | Collected | Ephemeral | Required | Purposes | What it is |
|---|---|---|---|---|---|
| Device or other IDs | Yes | No | Required | App functionality, Developer communications | The push token and the Firebase installation ID behind it (only with PR or leaderboard notifications on), and the Google Maps SDK's own identifier, which it sends whenever a map is shown |

Marked required because the Maps SDK sends its identifier by itself whenever the run map opens, and
there is no switch for it.

## What the Google Maps SDK sends

The run screen's map is Google's Maps SDK for Android (`react-native-maps`, ADR-050). Google's page
"Prepare for Google Play's data disclosure requirements" (Maps SDK for Android) lists what it sends by
default: request metadata (device model, OS, SDK version), stack traces and crash metrics, the IP
address, and a pseudonymous Maps SDK identifier; plus map interaction such as panning and zooming,
depending on how the map is used. Those are covered above under Crash logs and Device or other IDs.
Google also receives the map tile requests for the area on screen, as any map does; the route itself
is drawn on the phone and not sent.

## Before you submit

- Settle Decision 1 and Decision 2.
- The Health Connect permission reasons and the foreground-service (location) declaration are separate
  App content forms; see [remaining-checklist.md](remaining-checklist.md).
- Phase 10 (RevenueCat subscriptions) will add **Financial info: purchase history** and a new SDK.
  Update this sheet then.
