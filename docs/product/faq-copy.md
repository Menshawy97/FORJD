# Profile → FAQ: draft copy for sign-off

Status: **approved by the user on 2026-09-22 and built (F1)**. Draft note kept below for the record. The FAQ screen (slice F1) is not built
until this is approved, because it carries health and training claims and their citations into the
product (see the standing rule: cite published sources, get them approved, never call a rules-based
number "AI").

Where this comes from: every number below is taken from the code or an ADR that already exists, so
each answer says what the app actually does. The citation strings are copied from those files; the
ones marked **verify** are cited in code without a full reference, and need checking before launch.

Voice: plain, second person, no jargon, no claim that the app gives medical advice. Each entry is
one question the user can tap open. Grouped as they will appear.

---

## Your rank and the leaderboard

### How is my Activity score worked out?
Your Activity score is out of 100. It compares what you did with public health targets, then with the
other athletes in your city.

Up to **70 points** come from meeting the World Health Organization's activity guidelines, and they
mean the same in every city:
- Up to 40 for time active. The guideline is 150 to 300 minutes a week; you earn the full 40 at 150
  minutes a week. The target is scaled to the length of the period: the weeks so far this month (at
  least one), or, for all time, the weeks since your first workout.
- Up to 10 more for going from 150 towards 300 minutes a week.
- Up to 20 for strength training. The guideline is at least 2 days a week; a "strength day" is a day
  with a lifted set that has weight on it.

Up to **30 points** come from how much work you did compared with others in your city: kilograms
lifted, kilometres covered, or hours trained. You take whichever of the three you rank best in. A type
of activity that fewer than 5 athletes did counts for nothing, so a token effort in a rare one can't
win points.

FORJD records time, not how hard it felt, so any workout time stands in for the guideline's "moderate
activity" minutes, and time spent lifting counts towards both the active-time and strength parts. That
is an approximation. The points split is FORJD's own choice, anchored to the guideline; it isn't a
scientific claim, and the score is a comparison of activity, not a measure of health or fitness.

*Source:* Bull FC, et al. World Health Organization 2020 guidelines on physical activity and
sedentary behaviour. *Br J Sports Med* 2020;54:1451-1462.

### Which workouts count?
Only workouts you ran through FORJD's workout screen, from the moment you started them, and only if you
joined the leaderboard and allowed location. Workouts typed in afterwards never count. Each workout
counts for at most two hours of time towards the score (kilograms and kilometres aren't capped). This
stops casual gaming; it can't stop someone determined to cheat.

### Why don't I see a rank?
A city needs at least 5 athletes with a qualifying workout in the period before anyone is ranked, so
the board never shows a score that means nothing. You also need to have joined the leaderboard, allowed location, and finished a live workout
in the period. If a screen shows a dash where a rank should be, one of these isn't true yet.

### What does "up 3 this week" mean?
It's your rank at the start of this week minus your rank now, so a positive number means you moved up.
The start-of-week rank is saved just after midnight on Saturday (UTC); if that one is missing, FORJD uses the latest
earlier one, up to two weeks old. Comparing September's rank with October's isn't movement, so nothing
is shown across a month change.

### How is "Top 8%" worked out?
It is your rank divided by the number of athletes in your city, rounded up, and never below 1%.

### Who can see me on the leaderboard?
Other athletes in your city can see your name, username, photo, score and movement. If your profile is
private, your name and username still appear on the board but your profile can't be opened, and your
photo is hidden from everyone but you. A public profile can be opened by any signed-in FORJD user. It
shows your city, training goals and activities, your four heaviest lifts and your last three sessions,
and, only while you are ranked this month, your rank, score and streak. It never shows your email, date
of birth, sleep, HRV, body composition or InBody results. You can leave the leaderboard at any time, and it takes effect on
the very next request.

### How does FORJD know my city?
When you start a workout, and only if you allowed it, your phone sends a position rounded to about
110 metres. Our server matches it to the nearest city of about 15,000 people or more, within 120 km,
from a public dataset (GeoNames, CC BY 4.0), and throws the position away. Only the city name is kept, on the workout. Nearby suburbs join their
main city's board.

---

## Weekly Forge

Approved by the user on 2026-09-27 (mock-up section H of the Weekly Forge explainer, see
[weekly-forge-explainer-plan.md](weekly-forge-explainer-plan.md)). Shown only while the
`weekly_forge` flag is on. The goals' sources are in
[ADR-058](../decisions/ADR-058-weekly-forge-fifteen-levels.md).

### What is Weekly Forge?
Five weekly goals, one for each ladder: Consistency, Volume, Distance, Active minutes and Nourish.
Each ladder has a level, and your level sets that week's goal. Reach it and the goal grows. Miss it
and you stay where you are.

### What counts toward each ladder?
Every completed workout you log counts, whether you used the live timer or added it afterwards.
- Consistency: completed workouts.
- Volume: weight × reps across all sets, warm-ups included.
- Distance: kilometres from running workouts.
- Active minutes: workout time, up to 2 hours per workout.
- Nourish: days you logged at least one meal.

### When does my week start and end?
Weeks run Saturday to Friday and close at midnight on Friday night, in your own time zone. Anything
you log after that counts toward the new week. Editing an old workout later doesn't change a week
that has already closed.

### How do I go up a level?
Reach your goal by the end of the week and you go up one level. If your total also beats the goal of
a higher level, you land on that level instead, up to 3 levels in one week.

### What happens if I miss a week?
Nothing is taken away. You keep your level and the same goal. Only after 3 misses in a row does your
level ease down by one, and level 1 is the lowest it goes.

### What are the bands, and where do the goals come from?
Bands group the levels: Ore, Ember, Anvil, Tempered, then Forged. Volume, Distance and Active
minutes have 3 levels in each band. Consistency has one or two, and Nourish stops at Anvil.

The goals follow published guidance: the World Health Organization's 150–300 active minutes a
week, the American College of Sports Medicine's strength training advice, and studies of how much
recreational and competitive runners train. Tap a ladder on Home to see every level and its goal.

### How do I reach Forged?
Forged is the top band. To get there, stay in Tempered for 4 weeks in a row. While you're Forged, a
missed week moves you back to the top of Tempered, and you can climb back from there. Nourish has no
Forged band: it tops out at Anvil, 6 days a week.

### Can I share my level?
Yes. Open a ladder and tap Share, or tap its badge to replay your band's celebration and share from
there. To share all your ladders on one card, tap Share on the Weekly Forge section of your Profile.
Nourish is never included.

### Who can see my levels?
If your profile is public, other people can see your bands and levels for Consistency, Volume,
Distance and Active minutes. Nourish is only ever shown to you. Weekly Forge has no ranking.

For the full picture, open How it works from the Weekly Forge card on Home.

---

## Your training numbers

### How is my estimated one-rep max worked out?
FORJD uses the Epley formula: the weight lifted × (1 + reps ÷ 30). It only estimates from sets of 10
reps or fewer, because estimates get unreliable above about 10 reps. It is an estimate, not a test.

*Sources:* Epley B. *Poundage Chart.* Boyd Epley Workout. Lincoln, NE: Body Enterprises; 1985. Accuracy
above about 10 repetitions: DiStasio's validation of the Brzycki and Epley equations against a measured
back-squat 1RM (as recorded in ADR-030) — **verify the full reference**.

### What is training volume?
Sets × reps × weight, added up. It's the standard "volume load".

*Source:* Hornsby WG, Gentles JA, Comfort P, Suchomel TJ, Mizuguchi S, Stone MH. Resistance training
volume load with and without exercise displacement. *Sports* 2018;6(4):137. doi:10.3390/sports6040137

### How is my muscle split worked out?
Each completed set that has a weight on it has its volume shared equally between the muscle groups the
exercise mainly works, grouped into six buckets, so bodyweight-only sets aren't counted. "Full body" and
"neck" are left out, and the percentages are for the current calendar month. This is FORJD's own
grouping.

### What counts as a personal record?
The heaviest weight you've lifted for an exercise, dated the first time you reached it. The change
shown compares with your best before this month.

### What is a week streak?
The number of weeks in a row, starting each Saturday, with at least one finished workout. A week that
has just started with no workout yet doesn't break your streak.

### What is FORJD Insight, and is it AI?
It is not AI. It is a set of fixed rules applied to your own numbers: whether your top reps beat the
target on two sessions in a row of the same template, how this week's volume compares with last week's
(mentioned when it changes by 5% or more), your estimated one-rep-max trend, and a note when you've
trained fewer than twice this week. It starts after two weeks of history. The one instruction it gives
is to add a small amount of weight, once you've passed your target reps on two sessions in a row. It
never tells you to rest or warns of injury, because the research doesn't support that.

*Sources:* American College of Sports Medicine. Progression models in resistance training for healthy
adults. *Med Sci Sports Exerc* 2009;41(3):687-708 (the 2–10% increase). American College of Sports
Medicine Position Stand, *Resistance Training Prescription for Muscle Function, Hypertrophy, and
Physical Performance in Healthy Adults: An Overview of Reviews*, *Med Sci Sports Exerc*, April 2026
(the advice to train each muscle group at least twice a week).
*The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and
Frequency on Muscle Hypertrophy and Strength Gains.* *Sports Med* 2025. doi:10.1007/s40279-025-02344-w

---

## Recovery and health data

### How is my readiness score worked out?
Readiness looks at four things measured during sleep — heart rate variability (HRV), resting heart
rate, sleep length and breathing rate — and compares the last 7 days with your own previous 60 days.
It needs at least 30 days of history for each, and shows why when it can't give a score.

For each one, FORJD works out how far you are from your own normal. HRV is put on a log scale first.
Resting heart rate and breathing rate count in reverse, since lower is better. Each becomes a score from
0 to 100, where 50 is your normal. The four are averaged equally. Red is 33 or below, yellow is up to
66, and green is above. A change smaller than half your usual day-to-day variation counts as "normal".

Readiness is a trend, not a verdict. The way the four are combined is FORJD's own choice and has no
published source, and the overall number isn't validated like the measurements behind it.

*Sources:* Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M. Training adaptation and heart rate
variability in elite endurance athletes: opening the door to effective monitoring. *Sports Med*
2013;43(9):773-781. doi:10.1007/s40279-013-0071-8. The smallest worthwhile change of half the athlete's
own between-day standard deviation follows Hopkins WG (2000) — **verify the full reference**. Zone
cut-offs follow WHOOP's published red/yellow/green ranges (0–33, 34–66, 67–100).

### Why do two devices show different heart rate variability?
Different sensors measure it with different accuracy; chest straps are better than wrist sensors, so
FORJD keeps every reading with its source and never mixes them. When several sources report the same
thing, a manual entry wins, then WHOOP, then Health Connect or Apple Health.

*Sources:* wrist-based photoplethysmography validation of WHOOP, PMC8160717; and an observational
device-comparison study, PMC12819663 (both recorded in ADR-031).

### What does FORJD do with my health data?
Sleep, heart-rate, steps and other health readings, and WHOOP data, are only stored with your separate
health-data consent. They are never shown on the leaderboard and never sent to any analytics or
advertising service. Turning consent off stops FORJD collecting more; it doesn't erase what is already
stored. To remove data, use Profile → Account → Delete account, which removes everything, or export it
first with Export my data. The consent switches themselves are in Profile → Privacy settings.

### Where do my body-composition numbers come from?
From the InBody sheets you scan. The photo is read by a third-party AI service, so scanning needs your
separate AI-features consent, and the numbers it reads are only suggestions for you to confirm. Any value
the reader is less than 90% sure of is left blank for you to check rather than filled in. The trend is
your latest scan minus your first, and comparing two scans is the second minus the first.

---

## Runs

### How does FORJD measure a run?
From your phone's GPS while the run screen is open. Distance is the sum of the short steps between
accurate GPS points; points with poor accuracy, or that imply a jump faster than 12 m/s, are ignored.
Pace is your moving time divided by distance, and paused time never counts. Each split is the time for
one full kilometre. Elevation gain adds up climbs only, counting a rise once it passes 3 metres so GPS
wobble isn't counted. That elevation rule is FORJD's own.

### Where does a run's route go?
Your route stays on your phone. Only the summary — distance, time, splits, elevation and, if you allowed
health data, heart rate and calories — is saved to your account. If you joined the leaderboard and
allowed location, the run also sends the same rounded start position as any workout, so FORJD can work
out your city, and that position is thrown away afterwards. The map behind the route comes from Google
Maps, so Google's map software receives the area you are viewing; the route itself is drawn on top by
FORJD and isn't sent to Google. Without a connection the map tiles won't load, and the route is drawn on
a plain background instead.

### How are calories worked out?
If your watch reports the calories, FORJD uses those. Otherwise it estimates them and marks the number "estimated". With your heart rate from a watch (if you've allowed health data), your age and your sex, it uses Keytel's heart-rate equation; otherwise your pace, your net climb from start to finish and your latest weight, with the American College of Sports Medicine's running and walking equations. With no weight on record it shows a dash instead.

Running (at about 8 km/h and faster): oxygen use = 0.2 × speed + 0.9 × speed × grade + 3.5. Walking
(slower): 0.1 × speed + 1.8 × speed × grade + 3.5. Speed is in metres per minute, grade is the slope as
a fraction, and oxygen use is in mL per kg per minute. Energy is oxygen use × your weight in kg ÷ 1000
× 5 kcal per minute. Like a watch, FORJD counts only the calories the run added: it takes off what your body burns at rest over the same time, from your latest InBody scan's BMR, or 1 MET without one. It is an estimate for one person's average, and a watch that measures your heart rate will usually be closer.

*Source:* American College of Sports Medicine. *ACSM's Guidelines for Exercise Testing and
Prescription*, 11th ed. Wolters Kluwer; 2021. Keytel LR et al. Prediction of energy expenditure from heart rate
monitoring during submaximal exercise. *J Sports Sci* 2005;23(3):289–297.

### Why does heart rate show a dash?
FORJD reads heart rate from a watch that shares it through Health Connect, and only if you've allowed
health data. With no watch connected, or health data switched off, it shows a dash rather than a number
that isn't yours.

---

## Your account and data

### Why do I have to be 16?
FORJD asks your date of birth and only accepts people aged 16 or over. If a date of birth shows you are
under 16, the account is deleted.

### Where do the city names come from?
GeoNames (geonames.org), under the Creative Commons Attribution 4.0 licence. The full credit is on the
Data sources page.

### Can I delete my account and my data?
Yes. Deleting your account removes your login and your data, and you can export everything first. Both
are in Profile → Account (Export my data, Delete account).

---

## Citations to verify before this ships

1. Hopkins WG (2000), the "smallest worthwhile change" — the code cites only "Hopkins (2000)".
2. DiStasio's Epley/Brzycki validation — ADR-030 records it without a full reference.
3. The 2026 ACSM Position Stand on resistance training — cited by title and month in ADR-030.
4. Altini's HRV4Training, cited in the readiness code as background for the baseline window; it is not
   quoted in the FAQ above, so it is left out unless you want it.
5. ACSM's Guidelines, 11th ed., for the run equations — the equations are as published in the textbook's
   metabolic calculations chapter; confirm the edition you want to cite.

Every source above was recorded by earlier sessions or is named in this session's plan; none was added
from memory that isn't already in the repository, except item 5, which is new with the run feature.

## Approved for 12A (owner, 2026-10-04), now in `faq-content.ts`

Approved as written below and in the app (Runs section).

### Runs → How does FORJD measure a run? (first sentence changes)

Was: "From your phone's GPS while the run screen is open."
Proposed: "From your phone's GPS while a run is open, including with the screen locked."

### Runs → new entry: Why is there a notification while I run?

"While a run is open, FORJD shows a notification with your time, distance and pace, and Pause and
Finish buttons, so you can control the run without unlocking your phone. Android also shows a small
'Location' notice: it is how Android lets an app keep using GPS with the screen off. FORJD only uses
your location while a run is open, never in the background otherwise, and your route stays on your
phone. When the run is finished or discarded, both notices go. If you swipe FORJD away, tracking
stops and the run is offered back the next time you open the app."

## Approved for 12B (owner, 2026-10-04), now in `faq-content.ts`

Approved and in the app as a new "Workouts" section after "Runs". One word differs from the draft below: the bar's
last entry says "Tap the bin" where the draft said "Tap the x", because the owner chose the bin icon for the discard
button (2026-10-04).

### Workouts → new entry: What is the notification during my workout? (Android)

"While a workout is open, FORJD shows a notification with your current exercise, the set you are on and
its weight and reps, so you can see what is next with your phone locked. Tap Done to log the set, as if
you had ticked it in the app. During rest it shows a countdown and a Skip rest button, and when rest
ends it switches to the next set and FORJD buzzes as usual. Everything stays on your phone: nothing in
it is sent anywhere. It stays until you finish the workout, or until three hours pass with nothing logged
and the workout screen closed. On iPhone this arrives later, as a Live Activity."

### Workouts → new entry: Why does FORJD ask to send notifications when I start a workout?

"FORJD asks once, at the start of your first workout, so it can show the workout notification and buzz
when a rest is over. If you say no, the workout and its on-screen rest timer work exactly the same; you
just won't see the notification or get the buzz. You can change this in your phone's settings."

### Workouts → "Tapped Done on the lock screen but the set isn't ticked"

Not proposed as an entry. Noted for the device walk: a Done tapped while the app was fully stopped is
applied the next time the workout is opened, if that set is still the one you were on.

### Workouts → new entry: What is the bar above my tabs? (changed 2026-10-04, replaces nothing above)

"When you press back from a workout that is still running, FORJD doesn't end it. A bar appears above the
tab bar with your workout's name, the time, and the set you're on (or the rest countdown). Tap it to go
back to your workout. Tap the x to throw the workout away: FORJD asks first, then deletes the sets so far
and saves nothing."

## Approved for 12E (owner, 2026-10-06), now in `faq-content.ts`

Approved as written below and in the app as a new "Notifications" section after "Workouts" (five entries, 42 questions in all). ADR-061 says the FAQ and the privacy policy must say what notifications contain, and these
entries do that for the notifications the phone schedules for itself. Every claim below is what the code does
(`docs/product/phase-12e-plan.md`, ADR-064). A new "Notifications" section is proposed, after "Workouts".

### Notifications → new entry: Which reminders does FORJD send?

"Up to six, and you choose each one in Profile, then Notifications. Workout reminders arrive 30 minutes before you
usually train. Your weekly summary arrives on Saturday morning, when your week closes. Three more are off until you turn
them on: Log your meals (evening, only if you haven't logged food yet), No workout yet this week (Thursday evening, only
if you haven't trained) and Weekly Forge closing (Friday evening, only when you're close to a goal), plus a monthly
check-in to weigh yourself or scan with InBody. Nothing is sent between 22:00 and 07:00."

### Notifications → new entry: How does FORJD know when to remind me to train?

"From your own training. If you usually train on a weekday and have done it in at least two of the last four weeks,
FORJD reminds you 30 minutes before the time you usually start. If you follow a program you built, its days are used
instead. With too little history it stays quiet rather than guess."

### Notifications → new entry: What do these notifications say, and do they leave my phone?

"They are made on your phone from what FORJD already has, and they stay there: nothing in them is sent anywhere, and
they go when you sign out. They can name your workout, your streak or the time you usually train, but never a health
reading such as heart rate, sleep or HRV. The weekly summary is a fixed message with no numbers."

### Notifications → new entry: Why didn't a reminder arrive?

"FORJD schedules your reminders for the next two weeks each time you open it, so if you haven't opened it for two weeks
they stop until you do. Some Android phones also stop apps from running in the background to save battery, which can
delay or drop a reminder. Check that notifications are allowed for FORJD in your phone's settings; if they are off, the
Notifications screen says so and links to them. Reminders are a nudge, not a guarantee."

### Notifications → new entry: Why does FORJD ask to send notifications?

"The first time you turn on a reminder, or when you open the Notifications screen with one on, FORJD asks your phone
for permission. If you say no, nothing else changes: your choices are saved and the rest of FORJD works the same. You
can allow it later in your phone's settings."

## Proposed for 12F (server push), needs the owner's approval before it goes in `faq-content.ts`

Two entries for the "Notifications" section, after "Why didn't a reminder arrive?". Every claim is what the code does
(`docs/product/phase-12f-plan.md`, ADR-060, ADR-061, ADR-065). Not built into the app until approved. Note for the owner:
only PRs on lifts exist so far; run records (5b) wait for the two rules to be confirmed, and this wording says "lift" until then.

### Notifications → new entry: What are PR and leaderboard notifications?

"Two optional notifications come from FORJD's servers instead of your phone. A PR notification arrives soon after you
lift heavier than you ever have on an exercise. A leaderboard notification arrives once a week, when you move up or down
in your city. Both are on by default and you can switch each one in Profile, then Notifications. They name the exercise or
the city and nothing else: never a weight, a time or a health reading. If one is due during your quiet hours, it is sent
just after they end. A PR notification that is more than a day old is not sent at all."

### Notifications → new entry: What does FORJD share to send these?

"Your phone's push address (a code that identifies FORJD on your phone), the short text of the notification, and which
screen to open when you tap it. It travels through the push service FORJD uses (Expo's) and then Google's (or Apple's) to
reach your phone. It contains no health reading. When you sign out, or delete your account, your phone's address is removed
from FORJD's servers."
