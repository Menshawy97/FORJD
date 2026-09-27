/**
 * The words of Profile → FAQ (F1), transcribed from `docs/product/faq-copy.md`, which the user
 * approved on 2026-09-22. Every number in it is taken from the code or an ADR that already exists, so
 * each answer says what the app actually does.
 *
 * Two rules the tests pin: no unfinished note (the draft's "verify" flags) reaches a screen, and no
 * rules-based number is called AI (ADR-030). Changing an answer means the code changed, or the
 * copy was re-approved; the open citation checks are listed in the plan's follow-ups.
 */
export type FaqBlock = { p: string } | { list: readonly string[] };

export interface FaqEntry {
  id: string;
  question: string;
  answer: readonly FaqBlock[];
  /** A published reference, shown under the answer. */
  source?: string;
}

export interface FaqSection {
  title: string;
  entries: readonly FaqEntry[];
}

export const FAQ_SECTIONS: readonly FaqSection[] = [
  {
    title: `Your rank and the leaderboard`,
    entries: [
      {
        id: 'activity-score',
        question: `How is my Activity score worked out?`,
        answer: [
          {
            p: `Your Activity score is out of 100. It compares what you did with public health targets, then with the other athletes in your city.`,
          },
          {
            p: `Up to 70 points come from meeting the World Health Organization's activity guidelines, and they mean the same in every city:`,
          },
          {
            list: [
              `Up to 40 for time active. The guideline is 150 to 300 minutes a week; you earn the full 40 at 150 minutes a week. The target is scaled to the length of the period: the weeks so far this month (at least one), or, for all time, the weeks since your first workout.`,
              `Up to 10 more for going from 150 towards 300 minutes a week.`,
              `Up to 20 for strength training. The guideline is at least 2 days a week; a "strength day" is a day with a lifted set that has weight on it.`,
            ],
          },
          {
            p: `Up to 30 points come from how much work you did compared with others in your city: kilograms lifted, kilometres covered, or hours trained. You take whichever of the three you rank best in. A type of activity that fewer than 5 athletes did counts for nothing, so a token effort in a rare one can't win points.`,
          },
          {
            p: `FORJD records time, not how hard it felt, so any workout time stands in for the guideline's "moderate activity" minutes, and time spent lifting counts towards both the active-time and strength parts. That is an approximation. The points split is FORJD's own choice, anchored to the guideline; it isn't a scientific claim, and the score is a comparison of activity, not a measure of health or fitness.`,
          },
        ],
        source: `Bull FC, et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med 2020;54:1451-1462.`,
      },
      {
        id: 'which-workouts-count',
        question: `Which workouts count?`,
        answer: [
          {
            p: `Only workouts you ran through FORJD's workout screen, from the moment you started them, and only if you joined the leaderboard and allowed location. Workouts typed in afterwards never count. Each workout counts for at most two hours of time towards the score (kilograms and kilometres aren't capped). This stops casual gaming; it can't stop someone determined to cheat.`,
          },
        ],
      },
      {
        id: 'no-rank',
        question: `Why don't I see a rank?`,
        answer: [
          {
            p: `A city needs at least 5 athletes with a qualifying workout in the period before anyone is ranked, so the board never shows a score that means nothing. You also need to have joined the leaderboard, allowed location, and finished a live workout in the period. If a screen shows a dash where a rank should be, one of these isn't true yet.`,
          },
        ],
      },
      {
        id: 'up-this-week',
        question: `What does "up 3 this week" mean?`,
        answer: [
          {
            p: `It's your rank at the start of this week minus your rank now, so a positive number means you moved up. The start-of-week rank is saved just after midnight on Saturday (UTC); if that one is missing, FORJD uses the latest earlier one, up to two weeks old. Comparing September's rank with October's isn't movement, so nothing is shown across a month change.`,
          },
        ],
      },
      {
        id: 'top-percent',
        question: `How is "Top 8%" worked out?`,
        answer: [
          {
            p: `It is your rank divided by the number of athletes in your city, rounded up, and never below 1%.`,
          },
        ],
      },
      {
        id: 'who-can-see-me',
        question: `Who can see me on the leaderboard?`,
        answer: [
          {
            p: `Other athletes in your city can see your name, username, photo, score and movement. If your profile is private, your name and username still appear on the board but your profile can't be opened, and your photo is hidden from everyone but you. A public profile can be opened by any signed-in FORJD user. It shows your city, training goals and activities, your four heaviest lifts and your last three sessions, and, only while you are ranked this month, your rank, score and streak. It never shows your email, date of birth, sleep, HRV, body composition or InBody results. You can leave the leaderboard at any time, and it takes effect on the very next request.`,
          },
        ],
      },
      {
        id: 'how-city',
        question: `How does FORJD know my city?`,
        answer: [
          {
            p: `When you start a workout, and only if you allowed it, your phone sends a position rounded to about 110 metres. Our server matches it to the nearest city of about 15,000 people or more, within 120 km, from a public dataset (GeoNames, CC BY 4.0), and throws the position away. Only the city name is kept, on the workout. Nearby suburbs join their main city's board.`,
          },
        ],
      },
    ],
  },
  {
    title: `Your training numbers`,
    entries: [
      {
        id: 'one-rep-max',
        question: `How is my estimated one-rep max worked out?`,
        answer: [
          {
            p: `FORJD uses the Epley formula: the weight lifted × (1 + reps ÷ 30). It only estimates from sets of 10 reps or fewer, because estimates get unreliable above about 10 reps. It is an estimate, not a test.`,
          },
        ],
        source: `Epley B. Poundage Chart. Boyd Epley Workout. Lincoln, NE: Body Enterprises; 1985. Accuracy above about 10 repetitions: DiStasio's validation of the Brzycki and Epley equations against a measured back-squat 1RM.`,
      },
      {
        id: 'training-volume',
        question: `What is training volume?`,
        answer: [{ p: `Sets × reps × weight, added up. It's the standard "volume load".` }],
        source: `Hornsby WG, Gentles JA, Comfort P, Suchomel TJ, Mizuguchi S, Stone MH. Resistance training volume load with and without exercise displacement. Sports 2018;6(4):137. doi:10.3390/sports6040137`,
      },
      {
        id: 'muscle-split',
        question: `How is my muscle split worked out?`,
        answer: [
          {
            p: `Each completed set that has a weight on it has its volume shared equally between the muscle groups the exercise mainly works, grouped into six buckets, so bodyweight-only sets aren't counted. "Full body" and "neck" are left out, and the percentages are for the current calendar month. This is FORJD's own grouping.`,
          },
        ],
      },
      {
        id: 'personal-record',
        question: `What counts as a personal record?`,
        answer: [
          {
            p: `The heaviest weight you've lifted for an exercise, dated the first time you reached it. The change shown compares with your best before this month.`,
          },
        ],
      },
      {
        id: 'week-streak',
        question: `What is a week streak?`,
        answer: [
          {
            p: `The number of weeks in a row, starting each Saturday, with at least one finished workout. A week that has just started with no workout yet doesn't break your streak.`,
          },
        ],
      },
      {
        id: 'insight',
        question: `What is FORJD Insight, and is it AI?`,
        answer: [
          {
            p: `It is not AI. It is a set of fixed rules applied to your own numbers: whether your top reps beat the target on two sessions in a row of the same template, how this week's volume compares with last week's (mentioned when it changes by 5% or more), your estimated one-rep-max trend, and a note when you've trained fewer than twice this week. It starts after two weeks of history. The one instruction it gives is to add a small amount of weight, once you've passed your target reps on two sessions in a row. It never tells you to rest or warns of injury, because the research doesn't support that.`,
          },
        ],
        source: `American College of Sports Medicine. Progression models in resistance training for healthy adults. Med Sci Sports Exerc 2009;41(3):687-708 (the 2–10% increase). American College of Sports Medicine Position Stand, Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews, Med Sci Sports Exerc, April 2026 (the advice to train each muscle group at least twice a week). The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains. Sports Med 2025. doi:10.1007/s40279-025-02344-w`,
      },
    ],
  },
  {
    title: `Recovery and health data`,
    entries: [
      {
        id: 'readiness',
        question: `How is my readiness score worked out?`,
        answer: [
          {
            p: `Readiness looks at four things measured during sleep — heart rate variability (HRV), resting heart rate, sleep length and breathing rate — and compares the last 7 days with your own previous 60 days. It needs at least 30 days of history for each, and shows why when it can't give a score.`,
          },
          {
            p: `For each one, FORJD works out how far you are from your own normal. HRV is put on a log scale first. Resting heart rate and breathing rate count in reverse, since lower is better. Each becomes a score from 0 to 100, where 50 is your normal. The four are averaged equally. Red is 33 or below, yellow is up to 66, and green is above. A change smaller than half your usual day-to-day variation counts as "normal".`,
          },
          {
            p: `Readiness is a trend, not a verdict. The way the four are combined is FORJD's own choice and has no published source, and the overall number isn't validated like the measurements behind it.`,
          },
        ],
        source: `Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M. Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring. Sports Med 2013;43(9):773-781. doi:10.1007/s40279-013-0071-8. The smallest worthwhile change of half the athlete's own between-day standard deviation follows Hopkins WG (2000). Zone cut-offs follow WHOOP's published red/yellow/green ranges (0–33, 34–66, 67–100).`,
      },
      {
        id: 'hrv-devices',
        question: `Why do two devices show different heart rate variability?`,
        answer: [
          {
            p: `Different sensors measure it with different accuracy; chest straps are better than wrist sensors, so FORJD keeps every reading with its source and never mixes them. When several sources report the same thing, a manual entry wins, then WHOOP, then Health Connect or Apple Health.`,
          },
        ],
        source: `Wrist-based photoplethysmography validation of WHOOP, PMC8160717; and an observational device-comparison study, PMC12819663.`,
      },
      {
        id: 'health-data',
        question: `What does FORJD do with my health data?`,
        answer: [
          {
            p: `Sleep, heart-rate, steps and other health readings, and WHOOP data, are only stored with your separate health-data consent. They are never shown on the leaderboard and never sent to any analytics or advertising service. Turning consent off stops FORJD collecting more; it doesn't erase what is already stored. To remove data, use Profile → Account → Delete account, which removes everything, or export it first with Export my data. The consent switches themselves are in Profile → Privacy settings.`,
          },
        ],
      },
      {
        id: 'body-composition',
        question: `Where do my body-composition numbers come from?`,
        answer: [
          {
            p: `From the InBody sheets you scan. The photo is read by a third-party AI service, so scanning needs your separate AI-features consent, and the numbers it reads are only suggestions for you to confirm. Any value the reader is less than 90% sure of is left blank for you to check rather than filled in. The trend is your latest scan minus your first, and comparing two scans is the second minus the first.`,
          },
        ],
      },
    ],
  },
  {
    title: `Runs`,
    entries: [
      {
        id: 'run-measure',
        question: `How does FORJD measure a run?`,
        answer: [
          {
            p: `From your phone's GPS while the run screen is open. Distance is the sum of the short steps between accurate GPS points; points with poor accuracy, or that imply a jump faster than 12 m/s, are ignored. Pace is your moving time divided by distance, and paused time never counts. Each split is the time for one full kilometre. Elevation gain adds up climbs only, counting a rise once it passes 3 metres so GPS wobble isn't counted. That elevation rule is FORJD's own.`,
          },
        ],
      },
      {
        id: 'run-route',
        question: `Where does a run's route go?`,
        answer: [
          {
            p: `Your route stays on your phone. Only the summary — distance, time, splits, elevation and, if you allowed health data, heart rate and calories — is saved to your account. If you joined the leaderboard and allowed location, the run also sends the same rounded start position as any workout, so FORJD can work out your city, and that position is thrown away afterwards. The map behind the route comes from Google Maps, so Google's map software receives the area you are viewing; the route itself is drawn on top by FORJD and isn't sent to Google. Without a connection the map tiles won't load, and the route is drawn on a plain background instead.`,
          },
        ],
      },
      {
        id: 'calories',
        question: `How are calories worked out?`,
        answer: [
          {
            p: `If your watch reports the calories, FORJD uses those. Otherwise it estimates them and marks the number "estimated". With your heart rate from a watch (if you've allowed health data), your age and your sex, it uses Keytel's heart-rate equation; otherwise your pace, your net climb from start to finish and your latest weight, with the American College of Sports Medicine's running and walking equations. With no weight on record it shows a dash instead.`,
          },
          {
            p: `Running (at about 8 km/h and faster): oxygen use = 0.2 × speed + 0.9 × speed × grade + 3.5. Walking (slower): 0.1 × speed + 1.8 × speed × grade + 3.5. Speed is in metres per minute, grade is the slope as a fraction, and oxygen use is in mL per kg per minute. Energy is oxygen use × your weight in kg ÷ 1000 × 5 kcal per minute. Like a watch, FORJD counts only the calories the run added: it takes off what your body burns at rest over the same time, from your latest InBody scan's BMR, or 1 MET without one. It is an estimate for one person's average, and a watch that measures your heart rate will usually be closer.`,
          },
        ],
        source: `American College of Sports Medicine. ACSM's Guidelines for Exercise Testing and Prescription, 11th ed. Wolters Kluwer; 2021. Keytel LR et al. Prediction of energy expenditure from heart rate monitoring during submaximal exercise. J Sports Sci 2005;23(3):289–297.`,
      },
      {
        id: 'run-heart-rate',
        question: `Why does heart rate show a dash?`,
        answer: [
          {
            p: `FORJD reads heart rate from a watch that shares it through Health Connect, and only if you've allowed health data. With no watch connected, or health data switched off, it shows a dash rather than a number that isn't yours.`,
          },
        ],
      },
    ],
  },
  {
    title: `Your account and data`,
    entries: [
      {
        id: 'sixteen',
        question: `Why do I have to be 16?`,
        answer: [
          {
            p: `FORJD asks your date of birth and only accepts people aged 16 or over. If a date of birth shows you are under 16, the account is deleted.`,
          },
        ],
      },
      {
        id: 'city-names',
        question: `Where do the city names come from?`,
        answer: [
          {
            p: `GeoNames (geonames.org), under the Creative Commons Attribution 4.0 licence. The full credit is on the Data sources page.`,
          },
        ],
      },
      {
        id: 'delete-account',
        question: `Can I delete my account and my data?`,
        answer: [
          {
            p: `Yes. Deleting your account removes your login and your data, and you can export everything first. Both are in Profile → Account (Export my data, Delete account).`,
          },
        ],
      },
    ],
  },
];
