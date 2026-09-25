# Height and age on InBody scans: plan

Status: **approved by the user on 2026-09-25** (the plan and the references in §4). Still owed
before building: the screen replica in §3, and answers to the §4.5 questions.

## 1. Decisions made with the user

| Question | Answer |
|---|---|
| Where a scan's height and age come from | **Saved with each scan.** An uploaded scan reads them from the sheet. A manual entry starts filled in from the profile (height, and age on the scan date from date of birth), and the user can edit both. |
| Required? | Yes, like weight and body fat %: labelled "Required", with a red box and a reason if missing at save. |
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
4. **Profile prompt:** `PATCH /users/me` already accepts `heightCm`; the app asks, then calls
   it. Nothing on the server changes the profile by itself.

## 3. Screens (replica first, per the approval rule)

- **Confirm scan** and **manual entry:** two required rows, *Height (cm)* and *Age (years)*,
  at the top of the Values list, using the existing `ScanValueRow`. On Confirm scan they carry
  confidence bars like the other extracted values; when the AI could not read one, the row
  starts filled from the profile and shows amber so it is checked.
- **Profile-height prompt:** a small sheet after a successful save when the heights differ.
- **Body tab:** fat-free mass index gets its own tracked metric alongside the existing ones.
  Calculated BMI and BMR values join their metric's trend with a "calculated" marker. Height
  and age are not shown as trends.

I will show a replica of these before building them.

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
  McArdle, Katch & Katch, *Exercise Physiology*). FFM = weight − body fat mass, and both of
  those are already required, so this is the most accurate fill-in available.
- The same formula also checks an extracted BMR: a mismatch above 5% turns it amber.
- **Mifflin–St Jeor** (Mifflin et al., *Am J Clin Nutr* 1990;51:241–247), which needs height,
  age and sex, is the fallback only where fat-free mass is unknown (for example the calorie
  targets in §4.5 before a first scan).
- A calculated BMR is stored with a "calculated" marker, never passed off as a scan value
  (rule 10: preserve source).

### 4.3 Fat-free mass index: *new metric, tracked in the Body tab*
- FFMI = FFM ÷ (height m)², plus the height-normalised form FFMI + 6.1 × (1.8 − height m).
  Kouri et al., *Clin J Sport Med* 1995;5(4):223–228. A fairer size-for-height measure than BMI
  for people who lift. Computed from each scan's own weight, body fat mass and height, and
  derived at read time rather than stored as an aggregate (rule 9).

### 4.4 Run calories: *improves the estimate when the watch gives heart rate but no energy*
- Today: ACSM running equations, which use weight only (height and age do not appear in them),
  or the watch's own figure when there is one.
- Add: when heart-rate samples exist without a watch energy figure, use **Keytel et al.,
  *J Sports Sci* 2005;23(3):289–297**, which estimates energy from heart rate, weight, age and
  sex and is more personal than a pace-only equation.
- Consistency fix: the watch reports *active* energy but the ACSM figure is *gross* (it
  includes resting). Subtract resting energy, using the latest scan's BMR where there is one,
  so the two are comparable.

### 4.5 Calories and macros: *needs product decisions first*
Today the daily targets are numbers the user types in (`PUT /nutrition/macro-goals`). Suggested
targets would be health guidance, so this part is **proposal only**:
- Energy: BMR (§4.2) × a physical-activity level from FAO/WHO/UNU, *Human energy requirements*
  (2004).
- Protein: about 1.6 g per kg per day for resistance-trained adults (Morton et al., *Br J Sports
  Med* 2018;52:376–384), better as per kg of fat-free mass when a scan exists.
- **Open questions before this can be planned:** Is a suggested target wanted at all, or only
  shown next to the user's own? How is activity level chosen (asked, or from logged training)?
  Is there a goal (lose / maintain / gain) and how big a deficit or surplus? What about carbs
  and fat?

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
7. **G: Calories and macros** (§4.5). Only after the open questions are answered.

Each slice is its own PR, merged with `main` green, followed by a device check on Expo Go.
