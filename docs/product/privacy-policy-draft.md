# Privacy policy: full draft for the owner's approval

Status: **draft, not approved, not published** (2026-10-08). Replaces the outline on `apps/web/src/pages/privacy.astro` once
approved. Every statement below was checked against `docs/architecture/data-inventory.md` and the code. Items in
**[square brackets]** are things only the owner can fill in or confirm. A qualified person should review the final text before launch
(sections 1, 9, 10, 11 and 16 are legal questions). Plain language on purpose.

---

## Your body's data. Your call.

The short version: we use your health data to show you your own training and recovery, and for nothing else. It never goes to an
analytics or advertising service.

*Last updated: [date of publication].*

## 1. Who we are

FORJD is run by **[legal name of the person or company, and country]**. Questions about your data: **support@getforjd.com**.
That is also where you send any request in section 11.

## 2. What we collect

- **Your account:** email address, a password (stored only as a one-way hash, never readable), username, and the profile details you add:
  name, date of birth (you must be at least 16), sex, height, units, goals, city, and a profile photo.
- **Training:** the workouts, sets, runs, programs and templates you log, and the exercises you create or favourite.
- **Runs:** distance, moving time, elevation gain and kilometre splits. Heart rate and calories for a run are stored only if you
  gave health-data consent.
- **Health readings you connect:** sleep, heart rate variability, resting heart rate, steps, active energy, weight and similar, from
  Apple Health, Health Connect or WHOOP, only after you give permission on your phone and in FORJD.
- **Body composition:** the InBody results you add, and the scan photo if you add one.
- **Nutrition:** the foods, meals, saved meals and macro goals you log.
- **Location:** your city (as text). If you turn on "location for leaderboards", the phone reads your approximate position (about
  110 metres) once when a workout starts; we turn it into a city and **do not store the position**.
- **Notifications:** if you leave PR or leaderboard notifications on, a push token (a code that identifies FORJD on your phone),
  your phone's platform (Android or iPhone), and the short text of each notification we queue for you.
- **Your settings and consents:** privacy choices, notification switches and quiet hours, your time zone, and a record of sign-ins
  and consent changes.
- **Crash reports:** if you leave "crash diagnostics" on, our server sends an error report when it fails. It contains the type of
  error and where in the code it happened, never your content.

On the website, if you join the waitlist we collect your email address. The form is protected by Cloudflare Turnstile, which checks
that you are not a bot.

## 3. How we use it

To run the features you see: your history and charts, your readiness score, FORJD Insights, Weekly Forge, notifications you chose,
and, if you opt in, your place on your city's leaderboard. Each health reading is stored with the app or device it came from, so you
can always see where a number originated. We do not use your data to build profiles for advertising, and we do not sell it.

## 4. Location and your run route

- **Run route:** while a run is open, the app reads your precise position, including with the screen off (Android shows an ongoing
  notification while it does). **The route stays on your phone.** It is never uploaded. FORJD never reads your location in the
  background when no run is open.
- **Leaderboard city:** see section 2. Only the city is kept.
- **Public by design:** if you join leaderboards, other athletes in your city can see your rank and score, and your name, username
  and photo only if you made your profile public.

## 5. Who else receives your data

We use a small number of companies to run FORJD. Each gets only what it needs.

| Company | What it receives | When |
|---|---|---|
| Supabase (database, sign-in and file hosting) | Your account, all data above, your photos | Always |
| Google Cloud (our server) | The requests the app makes to our server | Always |
| OpenAI | Your InBody scan photo, to read the numbers off it | Only after you give AI consent; you can withdraw it |
| WHOOP | Sign-in details for the connection; we read your WHOOP recovery, sleep and workouts | Only if you connect WHOOP |
| Google or Apple (sign-in) | Your Google or Apple account identity | Only if you choose that sign-in; we never receive your password |
| Expo, then Google (Android) or Apple (iPhone) | Your push token, platform and the notification text | Only if PR or leaderboard notifications are on |
| Sentry (crash reports) | Error type and location in code, no text | Not sent at all if you turned crash diagnostics off |
| Cloudflare (website) | The waitlist form check | Only on the website |

These companies act on our behalf. **Health data never reaches an analytics or advertising service.** Not in the app, not on our
servers, not while we fix a bug.

## 6. Notifications

Reminders (workout reminder, weekly summary and similar) are made on your phone and never leave it. PR and leaderboard
notifications come from our servers; they are on by default and you can switch each off in Profile, then Notifications. A
notification names an exercise or a city and never contains a weight, a time or any health reading. It travels through Expo's push
service and then Google's or Apple's service to reach your phone. Finished notifications are deleted from our servers after 30 days.
Your push token is removed when you sign out, when you turn both notifications off, and when you delete your account. If your phone is
offline when you sign out, the removal can be delayed.

## 7. What we never do

**Health data never reaches an analytics or advertising service.** We don't sell it, rent it or use it to target ads. Data read from
Apple Health and Health Connect is used only to provide FORJD's health and fitness features, as both platforms require.

## 8. How long we keep it, and security

- We keep your data until you delete your account. Notifications are deleted 30 days after they finish. Your run route is never on our
  servers. **[Owner to confirm: how long backups are kept, and any other retention period you want to state.]**
- **Security:** traffic between the app and our server is encrypted; passwords are stored as one-way hashes; WHOOP connection tokens are
  encrypted in our database; your session on the phone is kept in the phone's secure storage. No system is perfectly secure, and we
  will tell you if a breach affects you, as the law requires.

## 9. Where your data is stored

Our server runs on Google Cloud in Belgium. Our database and file storage are with Supabase, in **[region, confirm in the Supabase
project settings]**. Some companies in section 5 process data in other countries, including the United States, under their own
safeguards. **[Owner and reviewer: confirm the transfer wording for the countries you serve.]**

## 10. Our legal basis

Where the law asks for one (for example in the UK and EU): we process your account, training and nutrition data to provide the
service you asked for (contract); we process health data, location for leaderboards, AI scan reading and push notifications only
with your consent, which you can withdraw in the app at any time; and we keep sign-in and consent records to protect the service and
meet our obligations (legitimate interest). **[Reviewer to confirm.]**

## 11. Your rights and controls

- **Export:** download a copy of your account data from the app.
- **Delete:** delete your account and its data from the app. Deletion is real, not hiding. A few records of sign-ins keep no link to
  you afterwards.
- **Correct:** edit your profile and logs in the app.
- **Disconnect:** revoke Apple Health, Health Connect or WHOOP access at any time.
- **Consents and visibility:** health data, AI scan reading, location for leaderboards, leaderboards and your public profile each have
  a switch in privacy settings.
- **Notifications:** switch PR and leaderboard notifications on or off in Profile, then Notifications.
- **Ask us:** email support@getforjd.com to access, correct, delete, restrict or move your data, or to object to a use. We answer
  within **[30 days]**. You can also complain to your data protection authority **[name the regulator that applies]**.

## 12. Children

FORJD is for people aged 16 and over. We ask for your date of birth when you sign up and don't create accounts for younger people.
If you think a younger person has an account, email us and we will delete it.

## 13. Cookies and the website

The FORJD website uses only what it needs to work and to protect the waitlist form. **[Owner to confirm: no analytics or advertising
cookies are used on the website; if that changes, this section changes first.]**

## 14. Changes to this policy

We will update this page when what we do with data changes, and change the "last updated" date. For a change that matters to you,
we will tell you in the app or by email before it starts.

## 15. Data sources

City names and locations come from **GeoNames** (geonames.org), used under the Creative Commons Attribution 4.0 licence.
**[Owner: confirm the credits the exercise and food datasets require, see ADR-005 and the USDA data notes.]**

## 16. Terms of use

**[Still to be written: accounts, subscriptions and renewals, acceptable use, and that FORJD gives training information, not medical
advice.]**

---

### What the owner needs to provide or confirm

1. Legal name of the person or company behind FORJD, and its country (section 1).
2. Backup retention and any other retention period (section 8).
3. The Supabase region (section 9) and the regulator to name (section 11).
4. Response time for requests (section 11), and the cookies statement (section 13).
5. The dataset credits (section 15), and the Terms of use (section 16).
6. A qualified reviewer for the legal sections before launch.
