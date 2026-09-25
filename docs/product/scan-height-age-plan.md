# Height and age on InBody scans: plan

Status: **approved by the user on 2026-09-25** (the plan and the references in §4). The §3
screen replica, the §4.5 answers and the §4.5 page designs were approved the same day.

## 1. Decisions made with the user

| Question | Answer |
|---|---|
| Where a scan's height and age come from | **Saved with each scan.** An uploaded scan reads them from the sheet. A manual entry starts filled in from the profile (height, and age on the scan date from date of birth), and the user can edit both. |
| Required? | Yes, like weight: labelled "Required", with a red box and a reason if missing at save. (Body fat % was required too until 2026-09-25, when the user made it optional.) |
| Scan height differs from profile height | **Ask before updating:** after saving, "Update your profile height to 178 cm?" |
| Scans saved before this change | **Left blank.** Only new scans need height and age. |
| Where to use them | BMI check on scans, filling in a missing BMR, fat-free mass index, and "anywhere in the app these data can improve accuracy": insights, calories, macros (§4). |
| What the Body tab tracks | **Every metric is tracked in the Body tab except age and height** (the user's rule). That includes the new fat-free mass index and any calculated BMI or BMR. |

## 2. Data and API

1. **Migration** (drizzle-kit generate): `body_scans` gains `height_cm numeric NULL` and
   `age_years smallint NULL`. Nullable so old scans stay valid; the contracts, not the column,
   make them required for new scans. These are columns on the scan, not `BODY_METRICS` rows,
   so they never become Body-tab trend lines, which is what the user asked for.
2. **Contracts** (`packages/contracts/src/body.ts`): `heightCm` (100–250) and `ageYears` (16,
   the account minimum from `age.ts`, to 110) are **required** on the confirm and
   manual-create requests and **nullable** on responses. Out-of-range values get the same
   per-field "Must be between X and Y" message as the other values.

   **When "required" lands (decided with the user, 2026-09-25):** slice A accepts both as
   *optional* and stores null when a request leaves one out; slice C makes them required in the
   same PR as the screens that send them. Every green `main` deploys the API to staging, so a
   required field in slice A would have made every InBody save from the current app fail until
   slice C shipped (and broken a shipped v1 endpoint, rule 7).
3. **Extraction** (`apps/api/src/ai/providers/`): the schema and prompt ask for the printed
   height (cm, or ft/in converted in code as lb→kg is today) and age, each with a confidence.
   Golden fixtures are updated from the user's sample sheets, and the eval is re-run so it
   still scores at least 88%.

   **Built in slice B:** height (`cm`, `in` or `ft_in`, converted to cm in the parser) and age
   (whole years) are read from the header with a confidence; a reading outside the request
   contract's bounds, a fractional age or an unknown unit is kept but held below the pre-fill
   threshold. The ADR-053 evaluation was a one-off, so it is now committed as
   `pnpm --filter @forjd/api inbody:eval`. The sample sheets are gitignored and the run needs an
   OpenAI key, so **the re-run is owed on the user's machine**, after adding `heightCm` and
   `ageYears` to each `truth/<name>.json` from its sheet.
4. **Profile prompt:** `PATCH /users/me` already accepts `heightCm`; the app asks, then calls
   it. Nothing on the server changes the profile by itself.

## 3. Screens (replica first, per the approval rule)

- **Confirm scan** and **manual entry:** two required rows, *Height (cm)* and *Age (years)*,
  at the top of the Values list, using the existing `ScanValueRow`. On Confirm scan a value read
  from the sheet carries its confidence bar like the other extracted values. A value the sheet
  does not print starts filled from the profile and shows amber, "Not on the sheet: from your
  profile. Please check.", until the user touches it. A doubtful sheet reading starts empty
  (ADR-032); the profile never stands in for a misread. On manual entry both rows start from the
  profile ("From your profile"), marked Required. A missing value gets a red box and "Enter your
  height" / "Enter your age". An age taken from the date of birth follows the scan's date until
  the user edits it.
- **Profile-height prompt:** a bottom sheet on the InBody screen after a successful save when the
  heights differ by 0.5 cm or more (or the profile has none): "Update your profile height to
  177.8 cm?", with "Update to 177.8 cm" and "Keep 175 cm" (or "Not now").
- **Body tab:** fat-free mass index gets its own tracked metric alongside the existing ones.
  Calculated BMI and BMR values join their metric's trend with a "calculated" marker. Height
  and age are not shown as trends.

The Confirm scan, manual entry and prompt replica was approved on 2026-09-25 (slice C). The
Body tab part is slice E, with its own replica.

## 4. Where height and age improve accuracy

Each item cites the published source it relies on. **Nothing here ships until the user has
approved the reference**, and none of it is labelled "AI" (it is arithmetic).

### 4.1 BMI check on scans: *recommended*
- BMI = weight kg ÷ (height m)². WHO, *Obesity: preventing and managing the global epidemic*,
  Technical Report Series 894 (2000).
- If the sheet's BMI differs from the computed one by more than 0.5, lower that value's
  confidence so the row shows amber for review. This would have caught the known misread
  (29.3 read where the sheet says 25.3). On manual entry, a blank BMI is computed and marked
  as calculated.

### 4.2 Fill in a missing BMR: *recommended*
- InBody itself prints BMR from fat-free mass: **BMR = 370 + 21.6 × FFM** (Katch–McArdle;
  McArdle, Katch & Katch, *Exercise Physiology*). FFM = weight − body fat mass (or weight ×
  (1 − body fat % ÷ 100) when only the percentage is known). Only weight is required, so a scan
  with neither body fat value gets no FFM-based fill-in; that is the most accurate one available
  when it can be computed.
- The same formula also checks an extracted BMR: a mismatch above 5% turns it amber.
- **Mifflin–St Jeor** (Mifflin et al., *Am J Clin Nutr* 1990;51:241–247), which needs height,
  age and sex, is the fallback only where fat-free mass is unknown (for example the calorie
  targets in §4.5 before a first scan).
- A calculated BMR is stored with a "calculated" marker, never passed off as a scan value
  (rule 10: preserve source).

**Built in slice D:** the arithmetic lives in `@forjd/domain` (`body-calculations.ts`). The
parser holds a sheet BMI or BMR that breaks its formula below the pre-fill threshold, using only
confidently read inputs (a BMR is not checked against fat values the body fat check already
doubted). Both save paths fill in a missing BMI and, when a body fat value gives fat-free mass, a
missing BMR, stored with `body_measurements.calculated = true` and returned as `calculated` on
every scan response. Showing the marker in the app is slice E.

### 4.3 Fat-free mass index: *new metric, tracked in the Body tab*
- FFMI = FFM ÷ (height m)², plus the height-normalised form FFMI + 6.1 × (1.8 − height m).
  Kouri et al., *Clin J Sport Med* 1995;5(4):223–228. A fairer size-for-height measure than BMI
  for people who lift. Computed from each scan's own weight, body fat (mass or %) and height, and
  derived at read time rather than stored as an aggregate (rule 9). A scan with no body fat value
  has no FFMI point.

**Built in slice E** (replica approved 2026-09-25): the user chose that a sheet which prints FFMI
(InBody 570, 770) wins, as with BMI and BMR, so `fat_free_mass_index` joined `BODY_METRICS`, the
extraction schema and the prompt, with a parser check against FFM ÷ height². Otherwise the API
works FFMI out on every read of a scan (never stored), marked calculated. The Body tab gains FFMI
and BMI cards; a card whose latest value was calculated carries a "Calculated" tag and what it
came from, and FFMI shows the height-adjusted value. Scan detail tags each calculated value
("Not on the sheet" / "Not entered: from …"). Confirm scan and manual entry gain an optional FFMI
row, since a read value is never saved unconfirmed.

### 4.4 Run calories: *improves the estimate when the watch gives heart rate but no energy*
- Today: ACSM running equations, which use weight only (height and age do not appear in them),
  or the watch's own figure when there is one.
- Add: when heart-rate samples exist without a watch energy figure, use **Keytel et al.,
  *J Sports Sci* 2005;23(3):289–297**, which estimates energy from heart rate, weight, age and
  sex and is more personal than a pace-only equation.
- Consistency fix: the watch reports *active* energy but the ACSM figure is *gross* (it
  includes resting). Subtract resting energy, using the latest scan's BMR where there is one,
  so the two are comparable.

**Built in slice F:** `estimateRunActiveCaloriesKcal` in `@forjd/domain` (Keytel with heart rate,
age and sex, else ACSM; minus resting from BMR, else 1 MET). A finished run loads weight, BMR, age
on the run's date and sex together, bounded like the old weight lookup (rule 6). Heart rate only
feeds it with health-data consent. The in-app FAQ and `faq-copy.md` explain both; formulas are in
`live-run-plan.md`.

### 4.5 Calories and macros: *answered and designed, 2026-09-25*
Today the daily targets are numbers the user types in (`PUT /nutrition/macro-goals`). The basis
for suggested targets:
- Energy: BMR (§4.2) × a physical-activity level from FAO/WHO/UNU, *Human energy requirements*
  (2004).
- Protein: about 1.6 g per kg per day for resistance-trained adults (Morton et al., *Br J Sports
  Med* 2018;52:376–384), better as per kg of fat-free mass when a scan exists.
- Body recomposition (losing fat and gaining muscle together): documented in trained people as
  well as beginners, given progressive resistance training, energy at or slightly under
  maintenance, and high protein (Barakat et al., *Strength Cond J* 2020;42(5):7–21). Protein
  toward the top of Morton's range, where its benefit plateaus (about 2.2 g/kg); higher intakes
  of 2.3–3.1 g/kg help keep lean mass in a deficit (Jäger et al., ISSN position stand, *J Int Soc
  Sports Nutr* 2017;14:20; Helms et al., *IJSNEM* 2014;24:127–138).
- **Answers (the user, 2026-09-25):**
  1. **Suggest, the user accepts.** The app suggests targets; nothing changes until the user
     taps Use. The user's own typed targets stay possible.
  2. **Activity level is asked at sign-up**, on a new page in the goals page's layout. A
     suggestion from logged training can come later.
  3. **Goal: lose / recomposition / maintain / gain, percent-based**, also asked at sign-up:
     lose is about 15% under maintenance, gain about 10% over. Body recomposition was added by
     the user later the same day: 5% under maintenance with protein at 2.2 g/kg (the research
     above).
  4. **Fat is 25% of calories; carbs are the rest** after protein and fat.
  5. **A daily minimum** (added after the whole-app review, L6-1, approved 2026-09-25): never
     suggest below 1,200 kcal for women or 1,500 kcal for men (Harvard Health Publishing,
     "Calorie counting made easy", 2024), 1,350 kcal when sex is not given. Macros are worked
     out from the raised target, and the breakdown says "Raised to the 1,200 kcal daily minimum
     (Harvard Health)." when it applies.
- **Approved designs (2026-09-25):**
  - Sign-up page "How active are you?": Mostly sitting (1.4), Lightly active (1.55), Active
    (1.7), Very active (1.85), Athlete (2.0); Continue.
  - Sign-up page "What's your goal?": Lose fat (−15%), Body recomposition (−5%, more protein),
    Maintain, Build muscle (+10%), pre-selected from the training goals; Finish.
  - Nutrition, "Set daily goals": the Auto-calculate card becomes live. Closed, it shows
    "Suggested: 2,750 kcal · Protein 139 g · Carbs 377 g · Fat 76 g", a plain circled (i)
    icon (no box around it; grey closed, accent open), the Use button, and "Based on your InBody
    scan, activity level and goal." Tapping (i) opens the details inside the card, kept compact
    (the user asked for it summarised a little so the sheet fits a phone):
    - One line per step, name, short working and result: Maintenance (BMR × activity factor,
      named), the goal's calories (e.g. "Recomp −5%": 3,240 − 5%), Protein (g/kg × weight),
      Fat (25% of calories), Carbs (the rest). The inputs live in these rows; there is no
      separate inputs section.
    - One footer line: where the BMR came from and its date, the protein sources, and "Edit in
      Profile ›".
  - The sheet stops at 85% of the screen height; its title and Save/Cancel stay fixed and only
    the middle scrolls. With the details open it fits a 390×844 phone without scrolling; an
    iPhone SE scrolls a little to reach the last goal field.
  - Protein is 1.6 g per kg of body weight (2.2 g/kg for body recomposition). Energy uses the
    latest scan's BMR, or Mifflin–St Jeor from profile height, weight and age when there is no
    scan; the inputs then name "Estimated BMR" instead of the scan.
  - Profile, Training group: "Activity level" and "Body goal" rows under Goals & Activities,
    each opening its sign-up page with Save. Saving changes the suggestion only; the daily
    targets change when the user taps Use.

**Built in slice G:** `@forjd/domain` `nutrition-targets.ts` holds the vocabularies, factors,
Mifflin–St Jeor and `suggestDailyTargets`, reproducing the approved numbers (2,750 kcal to lose
fat, 3,080 for recomposition). `profiles.activity_level` and `profiles.body_goal` (migration 0027)
go through `PATCH /users/me/profile`. `GET /nutrition/macro-goals/suggestion` returns the
suggestion in the macro-goals shape plus every input the (i) details show, or what is `missing`.
Weight is the newest of the scans' and the health data's; BMR the newest scan's (measured or
calculated), else Mifflin–St Jeor (the midpoint constant when sex is not given). In the app, Use
saves the suggestion as the daily targets; the Goals page on a new account continues to
"How active are you?" and "What's your goal?", which ends on home. The approved sign-up footnote
"Once you log a few weeks of training, FORJD suggests a level from it" was left out, because that
suggestion is not built.

### 4.6 Checked and left unchanged
- **Readiness:** scores against the person's own baseline by design (`readiness.ts`
  explains that no wearable scores against "normal for your age"). Age would make it less
  accurate.
- **FORJD Insight** (training), **Epley 1RM**, **leaderboard score:** none uses body size or
  age, and the published formulas they follow have no such term.
- **Heart-rate zones:** the app has none today. Age would allow them (Tanaka et al., *JACC*
  2001;37:153–156, HRmax = 208 − 0.7 × age), but that is a new feature, not an accuracy fix.
  Listed here so it is not lost.

## 5. Slices (tests first in each)

1. **A: Contracts, migration, API.** Optional on create for now (see §2.2), nullable on read,
   bounds and messages. Repository and service tests.
2. **B: Extraction.** Schema, prompt, ft/in conversion, fixtures, eval re-run.
3. **C: Screens.** After replica approval: the two rows, pre-fill from profile, profile prompt,
   and the two fields become required on both create requests.
4. **D: BMI and BMR checks and fill-ins** (§4.1, §4.2), in the parser and the manual path.
5. **E: FFMI in the Body tab** (§4.3). Replica first.
6. **F: Run calories** (§4.4).
7. **G: Calories and macros** (§4.5): the two sign-up pages, the suggestion, and the Profile
   rows.

Each slice is its own PR, merged with `main` green, followed by a device check on Expo Go.
