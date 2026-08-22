# Screen inventory

Every screen in the design. **Route key** is the value of `state.screen` in the prototype —
use it as the go_router path name so the two stay traceable.

Common patterns referenced below:

- **`hdr(title, onBack, right?)`** — 34px back chevron, then a `700 26/1.15 -.02em` title.
  Flutter: `ForjdHeader`.
- **`scroll(children)`** — `flex:1; overflow-y:auto`, gutter 22, bottom padding 26.
- **`card`** — `#17181A`, 1px `rgba(255,255,255,.07)`, radius 14, padding 15–16.
- **`lbl`** — uppercase section label, `600 9.5/1 .14em`, `#77776F`.
- **`row(icon, title, subtitle, onTap, trailing?)`** — 22px glyph, 14px gap, title
  `600 14.5/1.25`, subtitle `400 12/1.3 #6E6E66`, chevron at 50% opacity, 15px vertical
  padding, `rgba(255,255,255,.05)` bottom divider, hover `rgba(255,255,255,.025)`.
  Flutter: `ForjdListRow`.
- **`btn(label, onTap, variant)`** — 52px, radius 12. Primary: `#E9712F` fill, white
  `700 15.5`, shadow `0 6px 22px rgba(233,113,47,.22)`, hover `brightness(1.07)`, active
  `scale(.985)`. Ghost: transparent, 1px border, `#9A9A92` label. Flutter: `ForjdButton`.
- **`chips` / `seg`** — pill chips (radius 9, `#191A1C` inactive / accent fill active) and a
  segmented control on a `#141416` track (selected segment `#232326` +
  `0 1px 3px rgba(0,0,0,.4)`).
- **`stat(label, value, unit, sub)`** — card with an uppercase label, a `700 25 -.02em`
  tabular numeral, an 11.5px unit suffix and an optional green delta line.
- **`sparkline(points, colour, w, h, fill?)`** — SVG polyline, 2px stroke, optional gradient
  fill to transparent. Charts are 300 x 86 inside a card.
- **toast** — `flash(message)`: pill at `bottom:96`, `left/right:22`,
  `rgba(28,29,32,.97)`, radius 12, `600 13`, fades in 200ms, auto-dismisses after **1900ms**.

---

## Onboarding and auth

### `loading` — splash
**Chrome:** none. **Purpose:** cover cold start.
Centred wordmark (26px bar-chart mark + `800 22 .02em` "FORJD") above a 26px ring spinner
(2.5px, `rgba(233,113,47,.22)` track, `#E9712F` top, `fj-spin` 0.8s linear infinite).
Auto-advances to `welcome` after **1600ms**.
*Flutter already replaces this with a native splash — keep the native one; the roadmap
records the white-flash fix.*

### `welcome` — value proposition (built)
**Chrome:** none. 32px side padding, 40px bottom.
70px spacer -> wordmark (26px mark + `800 23 .02em`) -> `h1` **"Training. / Recovery. /
Progress."** (`700 34/1.14 -.03em`, hard line breaks) -> `400 14/1.5 #9A9A92` **"One place
for everything your body is doing."** (max-width 290) -> three feature rows, each a 19px
accent glyph + `500 12.8/1.3 #D8B79C` text separated by `border-top: 1px
rgba(255,255,255,.07)` with 15px vertical padding:

1. `bolt` — "Strength · Running · Cross Training · Mobility"
2. `heart` — "Sleep · HRV · Recovery · Body Composition"
3. `chart` — "AI Insights · City Leaderboards · Analytics"

Flex spacer, then **"Create Account"** (primary) and **"Log In"** (ghost), 12px gap.

### `login` (built)
**Chrome:** back chevron on a `rgba(255,255,255,.07)` bottom rule, no tab bar.
`h1` "Log in" -> email field (placeholder `james.mitchell@example.com`) -> password field
(`••••••••`) -> "Forgot password?" link -> **"Log In"** -> social row.
Fields: 52px, radius 11, `#151517` fill, uppercase label above.

### `signup` — create account (built)
Same chrome. `h1` "Create account" -> **Your name** / **Email** (`you@email.com`) /
**Password** (`Min. 8 characters`) -> **"Create Account"** -> social row -> legal footnote.

**Validation, in order, on submit:**

1. any field empty -> *"All fields are required."*
2. email fails `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` -> *"Enter a valid email address."*
3. password shorter than 8 -> *"Password must be at least 8 characters."*

Error state: field border `#B8422F`, message `500 12 #E05A3C` under the field.
**The real contract is stricter** — 8+ with upper, lower, digit and a symbol from Supabase's
exact set (a space does not count). Mirror the contract, not this hint. Clear the error when
the field is edited and when a new form is opened — both were emulator-walk bugs.

Social row: "Continue with Apple" / "Continue with Google", 52px, `#151517`, radius 12.
*Not wired in the prototype and not in Phase 1 scope.*

### `goals` — onboarding goals and activities
**Chrome:** bare back chevron, no header title, no tab bar.
Two multi-select groups of option rows (radius 11, 13x15 padding; selected =
`rgba(233,113,47,.09)` fill + `rgba(233,113,47,.45)` border + accent check):

- **Goals** — Get stronger · Lose fat · Build muscle · Improve endurance · Feel better
- **Activities** — Strength · Running · HYROX · Pilates · Cycling · Swimming

**"Save"** -> if `goalsReturnTo === 'newAccount'` go to `home` and toast
*"Welcome to FORJD!"*; otherwise return and toast *"Goals updated"*.

---

## Home

### `home` — dashboard
**Chrome:** wordmark header + bell (7px accent dot badge with a 1.5px `#101011` ring) -> tab
bar (Home). Header: `800 21 .02em` "FORJD" over `500 12.5 #8B8B83` "Hi, {firstName}".
Scroll body, in order:

1. `500 12.5 #6E6E66` date — "Tuesday, 19 Aug"
2. **Readiness card** — `linear-gradient(160deg,#16221A,#141A16)`,
   `rgba(121,185,138,.22)` border, radius 16. Label "Readiness" `#8BBF96`; value
   `700 40/1 -.03em #79B98A` **87**; right column `700 14` "Good" over
   `400 11/1.3 #88A88F` "Ready to train hard"; a 3px rail at 87% animating `fj-grow`
   0.8s ease-out; footer `400 11.5 #7E9A85` "HRV stable · Sleep 7h 42m · Resting HR normal".
3. **Stat strip** — one card, radius 16, split by a 1px divider.
   Row 1, three cells: **147** Workouts · **9** This Month · **#47** City Rank
   (`700 20 #E9712F` over `500 10.5 #6E6E66`).
   Row 2, four tappable metric cells — Sleep **7h 42m** (green), HRV **68 ms** (green),
   RHR **52 bpm**, Steps **4.2k**; metric label `600 9 .10em #77776F` beside a 13px glyph.
   Hover or tap reveals a tooltip strip below the row (`rgba(255,255,255,.02)`,
   `400 11.5/1.4 #A9A9A1`, accent metric name):
   - Sleep — "Total time asleep last night, from your connected wearable."
   - HRV — "Heart rate variability — higher usually means better-recovered."
   - RHR — "Your heart rate at rest, measured overnight."
   - Steps — "Steps counted so far today."
4. **Insight card** — 34px accent `bolt` tile, label "Insight", body *"Training load up 14%
   this week. HRV has been stable — you're absorbing the volume well."* with the closing
   clause in `#79B98A`.
5. **Suggested today** — full accent card, radius 15, shadow
   `0 8px 26px rgba(233,113,47,.20)`. Label `rgba(255,255,255,.72)`, title `700 19`
   "Start Workout", 38px arrow tile `rgba(0,0,0,.22)`. Tap -> the followed program's
   overview, or `train` if none.
6. **This week** — label + `600 12 #E9712F` "4 sessions", an 80% 3px rail, then seven day
   columns (26px bars; full accent = trained, `rgba(233,113,47,.2)` = partial, `#1B1C1E` =
   rest; letters `#9A9A92` when trained, `#4D4D47` when not). The whole block taps to
   `weekly`.
7. **Recent PR** — card with a `star` tile, "Bench Press" / "3 days ago", right-aligned
   `700 18 #E9712F` "100 kg" over "x 3 reps".

*Phase 6 gates items 2, 3 and 4. The stat strip's first row is the same tile trio the roadmap
already omitted from `profile` for lack of a data source — same rule applies here.*

### `weekly` — weekly summary
**Chrome:** `hdr("Your week")` -> `home`. Tab bar (Home).
Date range `500 12 #6E6E66` "12 – 19 Aug 2026" -> **week-score card**
(`linear-gradient(160deg,#1D1512,#141416)`, `rgba(233,113,47,.22)` border, radius 16):
label "Week score" `#C9906C`, `700 42/1 -.03em #E9712F` **82**, `600 12 #79B98A`
"up 6 vs last week", and a seven-segment bar row.
Then **"What changed"** — five delta rows: Training volume +14% · Avg HRV −1 ms ·
Avg sleep +22 min · Resting heart rate −2 bpm · Sessions. Closes with an **AI insight** card
(accent label, `rgba(233,113,47,.2)` border).

### `notifsFeed` — notification feed
**Chrome:** `hdr("Notifications")` -> `home`. Tab bar (Home).
Rows of glyph + title + body + relative time (`500 10.5 #5C5C55`):

- `bolt` **New PR** — "Bench Press 82.5 kg x 6 — your best in 8 weeks."
- `heart` **You missed a workout today** — "Upper Body B was scheduled for today and has not been logged."
- `progress` **You improved** — "Estimated squat 1RM is up 7.5 kg this month."
- `rank` **Leaderboard move** — "You climbed 3 spots to #47 in Alexandria."
- **Recovery holding steady** — "HRV stable at 67–68 ms through a higher-volume week."
- **Streak milestone**

---

## Train

### `train` — training home
**Chrome:** `hdr("Train", null, plusButton)` — the right slot is a 36px accent tile
(radius 11, shadow `0 6px 18px rgba(233,113,47,.25)`) going to `programBuilder`.
Tab bar (Train).

1. **"Follow a Program"** hero — `linear-gradient(150deg,#241710,#17181A)`,
   `rgba(233,113,47,.32)` border, radius 16, subtitle "24 structured programs — strength,
   hybrid, running, cross training" -> `catalog`.
2. **"Currently following: {program}"** accent strip (`rgba(233,113,47,.07)` on
   `rgba(233,113,47,.25)`, radius 12) -> that program's overview. Hidden when not following.
3. **Previous workout** card — name, `PR +` badge (`#C9A03C`), meta "Yesterday · 45:12 ·
   14,200 kg · avg 151 bpm", four exercise chips (Bench 82.5x6 · Incline 32x10 · Fly 20x12 ·
   Dips BWx12), then **"Repeat workout"** (primary, 42px) and **"View summary"** (ghost) side
   by side.
4. Two half-width quick actions, **42px** tall, icon left of a single-line label:
   **"Start a run"** (`runner`) -> `run`, **"Exercise library"** (`dumb`) -> `library`.
5. **My programs** — shown only when the user has saved programs. `target` tile, name,
   "{meta} · {last}", chevron, and a delete affordance (confirm dialog) that toasts
   *"Program deleted"*.
6. **My workouts** — list with a "New Workout" accent link in the section header. Each row:
   name, a `star` when favourited, type badge (Preset / Custom / Program / Customised preset),
   "{n} exercises · {when}", the last-used date, and a **Start** action.

**Both lists cap at 3 rows.** When there are more, a 40px dashed-accent **"See all {n}"** row
sits under the list; tapping it expands in place and the row becomes **"Show less"** (the
chevron flips from down to up). Nothing navigates away — Train stays a launchpad, so
*Previous workout* and the quick actions remain reachable however many workouts the user owns.
If the expanded list routinely runs past a screenful, promote it to its own route and copy the
`workoutHistory` pattern.

### `catalog` — program catalogue
**Chrome:** `hdr("Programs")` -> `train`. Tab bar (Train).
Chip filter row: **All · Strength · Hybrid · Running · Cross Training**. Then program cards
(radius 14, hover border `rgba(233,113,47,.4)`) with name, level badge, accent meta line and
a `400 12 #9A9A92` description:

| Program | Meta | Level | Description |
|---|---|---|---|
| Upper / Lower | 4 days · 8 weeks | Intermediate | Balanced strength for 3–5 sessions a week |
| Push Pull Legs | 6 days · 10 weeks | Advanced | High frequency, high volume hypertrophy |
| Full Body Foundations | 3 days · 6 weeks | Beginner | Time-efficient, pairs well with running |
| 5/3/1 Progression | | | Percentage-based barbell progression |
| Hybrid Athlete | | | Lift heavy, run far, in the same week |
| Race Prep 10K | | | Threshold, intervals, long run |
| Couch to 5K | | | Walk-run build for a first 5K |
| Engine Builder | | | Conditioning circuits and machine intervals |
| Bodyweight Anywhere | | | No equipment, progressive calisthenics |

### `programOverview`
**Chrome:** `hdr(program.name)` -> `←programReturnTo`. Tab bar (Train).
Category / meta / level header, description, a **Workouts** list (each row expandable to its
exercise names, with a **Start** action), then **"Start Following"** or **"Stop Following"**
(toast *"Following {name}"*) plus **"Customise"** (ghost) -> `programBuilder` pre-filled.

### `programBuilder` — new or customised program
**Chrome:** `hdr("New Program")` -> `←programBuilderReturnTo` (default `train`). No tab bar.

- **Program name** — text field, placeholder "e.g. Off-season block"
- **Repeats for** — stepper, "{n} weeks"
- **Weekly schedule** — Mon…Sun, each day a wrapping chip row of the user's workouts plus a
  dashed accent **"+ New"** chip (-> `builder`) and a **Rest day** option. Assigning `REST`
  marks the day as rest; assigned chips show a **Remove** affordance.
- **"Save Program"** — blocked with *"Name it and assign at least one workout"*; on success
  saves as `type: 'Program'` with meta "{n} workouts · {weeks} weeks" and *"Just created"*.

### `workoutDetail`
**Chrome:** `hdr(workout.name)` -> `train`. Tab bar (Train).
Meta line, an **Exercises** card listing name + set/rep detail per row, then
**"Start workout"** (-> `live`) and **"Customise"** (ghost, -> `builder` pre-filled).

### `builder` — workout builder
**Chrome:** `hdr("Workout builder")` -> `←builderReturnTo`. No tab bar.

- **Workout name** field; a type chip row (Custom / Preset)
- **Exercises** list — each row: name, **Sets** and **Reps** steppers, a remove `x`
- dashed accent **"Add exercise"** -> `library` with `pick='builder'`
- **Schedule** — day chips (Mon…Sun) plus "on demand" / "x a week" phrasing
- **"Save workout"** -> meta "{n} exercises · {schedule}", toast *"Saved to My workouts"*,
  returns to the origin. A **"Start now"** action goes straight to `live`.

### `library` — exercise library
**Chrome:** `hdr("Exercise Library")` -> `train`; in pick mode the title becomes
**"Add Exercise"** and back returns to `builder` or `live`. Tab bar (Train) in browse mode.
Search field (46px, radius 11, `#151517`, `search` glyph) filtering live on name, then a chip
filter row: **All · Strength · Running · Cross Training · Yoga · Calisthenics · Mobility**.
Rows: 38px `dumb` tile (radius 9, `#1C1D20`), name, muscle groups, right-aligned last-set
detail, 13px vertical padding, `rgba(255,255,255,.05)` divider.

Dataset in the prototype (name · muscles · category): Bench Press · Chest · Triceps ·
Strength; Back Squat · Quads · Glutes; Deadlift · Back · Glutes; Tempo Intervals, Thruster,
Assault Bike · Cross Training; Pull-up · Back · Biceps · Calisthenics; Pistol Squat · Legs ·
Balance; Sun Salutation A, Warrior Flow · Yoga; Thoracic Opener · T-Spine · Mobility;
5K Run · Running.
**Placeholder.** Phase 2 replaces it with `free-exercise-db` (~870 exercises, ADR-005) and
local FTS5 search. Empty state: *"No exercises match."* (`400 13 #6E6E66`, 26px padding).

Tapping a row: browse -> `exercise`; `pick='builder'` -> adds to the routine, toast
*"{name} added to routine"*; `pick=true` -> adds a 1-set entry to the live workout, toast
*"{name} added to workout"*.

### `exercise` — exercise detail (strength)
**Chrome:** `hdr(exercise.name, back, starButton)` -> `←exerciseReturnTo`. The star toasts
*"Added to favourites"*. Tab bar (Train).
Metadata tag pills (`#1B1C1E`, radius 7, `500 11`) -> **Est. 1RM** stat with "+5 kg this
month" -> **"Top set — last 8 sessions"** sparkline card -> **"Log a set"** card with two
steppers (**Weight** kg, **Reps**; ± buttons 30px radius 8 `#232427`, value `700 20`
tabular) -> **"Log Set"** -> toast *"Logged {kg} kg x {reps}"* -> **History** list.

### `exerciseRun` — exercise detail (running variant)
Same chrome. Rendered instead of `exercise` when the exercise's category is `Running`.
**Avg pace** stat (`/km`, "−8 s/km this month") -> route-map placeholder ->
**"Pace trend — 8 runs"** sparkline -> **"Recent runs"** list (date · distance · time · pace ·
avg HR, with a `PB` badge) -> **"Start Run"** -> `run`.

---

## Live execution

### `live` — live workout
**Chrome:** none. No tab bar — a session is full-attention.

**Sticky header:**

- pulsing 7px accent dot (`fj-pulse` 1.6s) + `600 10 .14em` uppercase accent
  **"Live · {program}"**
- elapsed `700 30/1 -.02em` tabular, ticking every second
- three controls: a 38px `x` (cancel, hover `rgba(201,80,60,.18)`), a **Pause** / **Resume**
  toggle, and a **Finish** accent button -> `done`
- progress row: a 3px accent rail on `#232427`, `600 11 #9A9A92` "{done}/{total} sets",
  `600 11 #6E6E66` "{volume} kg"
- **Watch strip** — `#141517` card, pulsing `#C9503C` dot (1.2s), label "Watch",
  `700 15` live bpm + `700 15` accent average

**Training guide — a collapsed card above the exercise cards.** Header row: a 30px accent
target tile, **"How to train this"** (`600 13/1.2`) over *"Load, reps and rest by goal"*
(`400 11/1.25 #6E6E66`), and a chevron that rotates 90° over 180ms. Collapsed by default.
Expanded (`fj-fade .25s`), it lists four goals, each separated by a
`rgba(255,255,255,.06)` rule: the goal in `700 12.5 #E9712F` with the load right-aligned in
`500 10.5 #8B8B83`, then a row of two `#1B1C1E` pills (reps · rest, both nowrap and
tabular), then the execution note on its own wrapping line (`400 11/1.35 #8B8B83`), then the
advice in `600 11.5/1.4 #E4E2DE`. Execution and advice are prose, not tags — at 390px a pill
cannot hold "Controlled down, aggressive press" without truncating it.

| Goal | Load | Reps | Rest | Execution | Advice |
|---|---|---|---|---|---|
| Strength | 80–95% 1RM | 1–5 | 3–5 min | Controlled down, aggressive press | Move heavy weight with excellent technique |
| Hypertrophy | 60–80% 1RM | 6–15 | 1.5–3 min | Controlled eccentric, full range | Maximise muscle tension and train close to failure |
| Power | 30–70% 1RM | 2–5 | 2–4 min | Explosive concentric | Move the bar as fast as possible |
| Muscular endurance | 40–60% 1RM | 12–25+ | 30–90 s | Controlled, steady tempo | Hold form while fatigue accumulates |

Static reference copy — it does not key off the current exercise. Exercises have no goal field
yet; if it should adapt per exercise, that is a data change first.

**Body — one card per exercise:** name `700 15.5/1.2`, note `400 11.5 #6E6E66`, a chart
glyph at 55% opacity opening `exercise`. Then one row per set (radius 10, 10x12 padding;
unticked `#141517` + `rgba(255,255,255,.07)`, ticked `rgba(121,185,138,.09)` + green
border): set number (16px, `600 11.5 #5C5C55`) · editable **kg** input · "kg" · "x" ·
editable **reps** input · a remove `x` at 40% opacity, only when more than one set · a tick
circle. Ticking a set is the primary gesture — it starts the rest timer and pushes to `rest`.
Below the sets, a dashed **"Add set"** (36px). Below all cards, a dashed accent
**"Add exercise"** (46px) -> `library` in pick mode.

**Set ordering rules** — enforced with toasts, not disabled controls:

- ticking a set while an earlier one is unticked -> *"Complete set {n} first"*
- unticking a set while a later one is ticked -> *"Untick later sets first"*

Inputs stop propagation so editing a value does not tick the row.
**Offline is the requirement, not an optimisation** (CLAUDE.md rule 6).

### `rest` — rest timer
**Chrome:** none. Reached automatically on ticking a set; returns to `live` at zero.
Header row: accent uppercase "Rest" and `600 12.5 #9A9A92` "{elapsed} elapsed".
Centre: a 200px ring (`r=86`, 8px stroke, `#1E1F22` track, accent progress, round cap,
`transition: stroke-dashoffset 1s linear`, rotated −90°) with `700 46/1 -.03em` remaining
time and `500 11.5 #6E6E66` "until next set".
**"Up next"** — the next incomplete set, derived from the session: exercise name `700 19`
and `500 13 #E9712F` "{kg} kg x {reps}". When nothing is left: **"All sets complete"** /
"Finish your workout".
Adjust row: **−15** and **+30** (11x20 padding, radius 10, `#1A1B1D`), clamped at 0.
**"Skip Rest"** (ghost) -> `live`. Default rest is **90s**.

### `done` — session complete
**Chrome:** no header. Tab bar (Train).
A 52px green check tile (-> `home`) beside a 44px share tile (-> `sessionShare` with
`kind='strength'`). `h1` **"Session complete"**, subtitle *"{program} · Day 3 · logged
offline, will sync when you are back online."*
Six stat tiles: **Duration** · **Volume** kg · **Sets** · **Avg HR** bpm · **Peak HR** bpm ·
**Calories** kcal. Then **"HR through the session"** sparkline
(`[92,118,141,136,158,149,163,152,168,144,171,139]`).
**Comparison block** "vs last {program} · 16 Aug" — Volume +8.0% · Duration · Avg HR −3 bpm ·
Top set +2.5 kg · Rest avg −16 s, each with a "was {x}" line.
**"How did that feel?"** — four RPE chips: **Easy · Solid · Hard · Brutal**.
**"Save Workout"** opens a name modal (scrim `rgba(10,10,11,.72)`) defaulting to
"{program} · Day 3"; empty falls back to "Untitled workout". Saves to `myWorkouts` with meta
"{sets} sets · {duration}" and toasts *"Saved {name} to My workouts"*. **"View Progress"**
(ghost) -> `progress`.

### `run` — live run
**Chrome:** none.
Header: pulsing dot + `600 10 .14em` accent **"Live · Outdoor run"**, an `x` to exit.
**Route map placeholder** — striped fill, an accent polyline, a green "GPS strong" pill and a
monospace caption `live map · route + km markers`. **This is where the real map goes.**
Elapsed `700 46/1 -.03em` tabular + "elapsed".
Four stat tiles: **Distance** km · **Avg pace** /km (accent) · **Current speed** km/h ·
**Avg HR** bpm. Then a **Heart rate** sparkline and a **Splits** list (km · pace · "{hr} bpm").
**Pause** (toast *"Run paused"*) and **"Finish run"** -> `runDone`.
Distance, pace, speed and HR all advance every second while the screen is live.

### `runDone`
**Chrome:** no header. Tab bar (Train). Same shape as `done`: green check -> `home`, share tile -> `sessionShare`
with `kind='run'` and `shareLayout='map'`.
Route map, then stats — Distance km · Duration · Avg pace · Avg HR · Calories kcal ·
**Elevation** — then **Splits**. **"Save Run"** toasts *"Run saved · {km} km"* and returns to
`train`; **"View Progress"** (ghost) -> `progress`.

### `sessionShare` — share sheet
**Chrome:** `hdr("Share Workout")` -> `done` or `runDone` depending on `shareKind`.
A live preview card (**New Personal Record** / "Evening Run" / "{program} · Day 3", plus the
session's numbers) over a horizontal row of 100px-wide layout thumbnails:

- **Stats Card** — "Duration · Volume · Sets"
- **Route & Splits** — "For runs — pace, distance, elevation"
- **Heart Rate Zones** — "HR curve + time in zone"

Then actions: **Save Image** (toast *"Image saved to Photos"*), **Instagram**, **Strava**,
**More** — each toasting *"Sharing to {target}"*.
Run sessions default to the **map** layout; strength sessions to **stats**.

---

## Progress

### `progress` / `progressBody` / `progressRec`
**Chrome:** `h1` "Progress" (`700 26/1.15 -.02em`, no back button) + a three-way segmented
control — **Strength · Body · Health** -> tab bar (Progress). One screen, three tabs; each tab
body fades in over 250ms. The third tab was called "Recovery" until design review; only the
label changed, so the route key is still `progressRec`.

**Tab 1 — Strength**

- two stats side by side: **Bench PR** 100 kg (+5 kg this month) · **Squat PR** 140 kg
  (+7.5 kg this month)
- **"Estimated 1RM — 8 weeks"** — filled accent sparkline `[88,89,91,92,94,95,97,100]`,
  axis W2…W8
- **"Weekly volume (kg)"** — seven 82%-wide bars in a 92px band, `#232427` for a rest day
- **"Training calendar — August"** — 7-column grid, accent cell = strength, green = run,
  `#26272A` = rest, a session count in the header, a three-item legend
- **"Muscle group split — August"** — Legs 28% · Back 22% · Chest 18% · Shoulders 14% ·
  Arms 12% · Core 6%, as 7px accent bars
- **"Avg step count"** — a Day / Week / Month mini-segmented control, a `700 22` average and
  a sparkline
- **AI insight** — *"Training volume up 14% this week. HRV has remained stable at 67–68 ms,
  suggesting you are absorbing the load well. Continue this trajectory for 2–3 more weeks
  before deloading."*

**Tab 2 — Body**

- **Weight** 87.1 kg (−2.1 kg since April) · **Body fat** 16.4 % (−1.8% since April)
- **"Body composition — 5 months"** — `#DEDBD5` sparkline `[89.2,88.8,88.1,87.6,87.1]`,
  axis May…Aug
- **"InBody metrics over time"** — one card per metric: name, value, sparkline, "Apr -> Aug"
  and a signed delta coloured green / `#C9503C` / `#5C5C55`
- **"Segmental lean analysis"** — five rows (name, 6px bar on `#26272A`, kg, % of reference)
- **"Import InBody Scan"** row — "Last scan: 8 days ago" -> `inbody` with
  `inbodyReturnTo='progressBody'`

**Tab 3 — Health**

- three stats: **Avg HRV** 66 ms · **Avg sleep** 7h 28m · **Avg RHR** 52 bpm
- **"HRV — 6 days"** — green sparkline `[68,66,63,61,64,70]`
- **"Health metrics"** — per-metric card carrying **the provider name** ("Apple Health",
  "WHOOP") in a `400 10.5 #5C5C55` source line. *That line is CLAUDE.md rule 10 surfacing in
  the UI — keep it.*
- **AI insight** — *"HRV declined 6% on Aug 17–18 following two consecutive high-intensity
  sessions. Recovery appears to be resuming. Consider one moderate session before returning
  to maximum effort."*

### `workoutHistory`
**Chrome:** `hdr("Workout History")` -> `profile`, subtitle "Last 30 days". Tab bar (Profile).
Rows (radius 13, 8px gap, hover border `rgba(233,113,47,.4)`): name, "{date} · {duration}",
right-aligned volume (or "—" for a run), and a delete `x` that stops propagation and toasts
*"Removed {name}"*. Tapping the row -> `workoutHistoryDetail`.

### `workoutHistoryDetail`
**Chrome:** `hdr(session.name)` -> `workoutHistory`. Tab bar (Profile).
Meta line "{date} · {duration} · {volume}" (volume omitted when "—"), then an **Exercises**
card listing each exercise and its set detail.

---

## InBody

### `inbody` — scan upload and history
**Chrome:** `hdr("InBody Scan")` -> `←inbodyReturnTo`. Tab bar (Progress).
**Drop zone** — 210px, radius 16, 1.5px dashed `rgba(255,255,255,.16)`, striped fill, an
`upload` glyph and a monospace caption `inbody result sheet · jpg, png or pdf`. Tapping it
goes to `inbodyConfirm` — the prototype fakes extraction.
**Scan history** — dated rows -> `scanDetail`. A **Compare** link toggles compare mode: rows
gain a check circle, exactly **two** may be selected, and a **"Compare Selected Scans"**
button appears -> `inbodyCompare`. The link reads **Cancel** while comparing.

### `inbodyConfirm` — confirm extracted values
**Chrome:** `hdr("Confirm scan")` -> `inbody`. Tab bar (Progress).
Intro: *"Extracted from your photo on {date}, {time}. Tap any value to correct it — nothing is
saved until you confirm."*
**Scan date & time** — a date input and a time input (`colorScheme: dark`), labelled
"Read from sheet".
**Extracted values** — nine editable rows, each with a **confidence percentage**
("{n}% confidence"): Weight .99 · Skeletal muscle mass .97 · Body fat mass .94 · Body fat
percentage .98 · Visceral fat level .72 · Total body water .91 · Body mass index .96 ·
Basal metabolic rate (kcal) · InBody score.
**Segmental lean analysis** — the same editable treatment per segment.
**"Confirm & Save"** -> `progressBody` on the Body tab, toast *"Scan saved to history"*.
**"Retake Photo"** (ghost) -> `inbody`.

*This screen is the UI half of ADR-006 / Spike B. The confidence numbers are the spike's
per-field confidence, and the low one — visceral fat, .72 — is the point of the screen: the
user corrects what the model is unsure about. If the spike concludes confidence does not
correlate with real error, this screen's design changes; check ADR-006's status first.*

### `scanDetail`
**Chrome:** `hdr(scan.date)` -> `inbody`. Tab bar (Progress). One scan's full metric list.

### `inbodyCompare`
**Chrome:** `hdr("Compare Scans")` -> `inbody`. Tab bar (Progress).
A two-column **Earlier / Later** comparison across Weight · Skeletal muscle mass · Body fat
mass · Body fat percentage · Visceral fat level · BMR (kcal) · InBody score, with a signed
delta per row.

---

## Rank

### `rank` — city leaderboard
**Chrome:** "City" label + `h1` "Alexandria" (`700 25/1.1 -.02em`) with a `pin` glyph ->
`location`. Tab bar (Rank).
**Your rank card** — `linear-gradient(150deg,#2A1A11,#1D1512)`, `rgba(233,113,47,.28)`
border: label "Your rank" `#C9906C`, `700 27 -.02em #E9712F` **#47**, `600 11.5 #79B98A`
"up 3 this week"; right column `700 20` **92.7** over `400 11 #A08167` "Top 8%".
Then a chip row (metric: Activity / Strength / Running / Consistency), a two-segment period
control (This Month / All Time), and the ranked list — position, 17px avatar tile, name,
score, and a signed weekly delta. The current user's row is accent-tinted.

### `location` — location permission
**Chrome:** bare back chevron -> `←locationReturnTo`. The tab bar reflects the origin (Rank,
or Profile when opened from Privacy Settings).
44px `pin` tile -> `h1` **"City Leaderboard Location"** -> *"FORJD uses your approximate
location to assign you to a city leaderboard. Your precise location is never stored or
shared."* -> three Q&A pairs:

- "Why is location used?" — "To place you in the correct city leaderboard automatically."
- "When is it used?" — "Once during setup. Not tracked in the background."
- "What if you decline?" — "You will not appear on any city leaderboard. Everything else in
  FORJD still works normally."

**"Allow Location"** toasts *"Assigned to Alexandria"*; **"Not Now"** (ghost) just returns.
Both go back to the origin.

*Reached from Rank (the city name in the header) and from Privacy Settings' "Location
permission" row; it returns to whichever sent it, and its tab bar follows — Rank from Rank,
Profile otherwise.*

---

## Profile and settings

### `profile` (built)
**Chrome:** no header — the identity row is the header. Tab bar (Profile).
**Identity row** -> `editProfile`: 52px avatar tile (`#1C1D20`, radius 14), name
`700 19 -.01em` beside a plan badge (Pro: accent text on `rgba(233,113,47,.14)` with a
`rgba(233,113,47,.4)` border; Free: `#8B8B83` on `rgba(255,255,255,.05)`), handle line
`400 12 #6E6E66`, trailing chevron.
**Go Pro banner**, free users only — `linear-gradient(135deg,#1C1408,#17181A)`,
`rgba(233,113,47,.35)` border, radius 14: *"Get Unlimited Access to Everything"* + a
**Go Pro** accent pill.
Three labelled groups of rows:

- **Training** — Goals & Activities ("Get stronger · Strength, Running") · Units &
  Preferences ("Metric · kg")
- **Data** — Connected Sources ("Apple Health, WHOOP, Health Connect") · InBody History ("Last scan
  8 days ago") · Workout History ("147 sessions logged")
- **Privacy & permissions** — Privacy Settings ("Leaderboard, location, AI") -> `privacy` ·
  Notifications ("Workouts, recovery, PRs")

**"Log out"** — `600 13 #C9503C`, 26px above.
*The shipped Flutter screen omits the stat tiles and shows the email in the handle slot; both
are recorded deviations, not regressions.*

### `editProfile` (built)
**Chrome:** `hdr("Edit Profile")` -> `profile`. No tab bar.
**Name** field · **Birthday** date input (`colorScheme: dark`; borrows the `clock` glyph
because there is no `calendar`) · **Sex** chips (Male / Female / Rather not say — Flutter
renders four to match `sexSchema`) · **Plan** row ("Pro plan · Yearly · renews
automatically" -> `managePlan`, or "Free plan · Upgrade for unlimited access" -> `pro`).
**"Save Changes"** -> toast *"Profile updated"*.

### `units` — units and preferences
**Chrome:** `hdr("Units & Preferences")` -> `profile`. No tab bar.
Four segmented controls, each full-width two-up: **Measurement system** (Metric / Imperial —
switching it sets weight and distance together), **Weight** (kg / lb), **Distance** (km / mi),
**Energy** (kcal / kJ). **"Save Changes"** -> toast *"Preferences updated"*.
*`unitSystem` exists in the API and stays `metric` until the first Phase 3 screen shows a
weight.*

### `connect` — connected health sources
**Chrome:** bare back chevron -> `profile`. No tab bar.
`h1` **"Connect your data"** over *"FORJD reads. It never writes to your health data without
asking."* Then three provider rows, each glyph + name + description + a **Connect** /
**Disconnect** action with a brief spinner busy state (connected rows carry a
`rgba(121,185,138,.28)` border and a green glyph):

- `heart` **Apple Health** — "Steps, HR, sleep, workouts"
- `bolt` **WHOOP** — "Recovery, strain, sleep"
- `link` **Health Connect** — "Android health aggregation"

**InBody is deliberately not here.** It is not an API integration — scans arrive as a photo
through Progress -> Body -> Import. If InBody ever ships an API it comes back as a provider.

**"Save"** -> toast *"Connected sources updated"*.
*Render this from the `HealthProvider` registry, not as four hard-coded rows (rule 3). WHOOP
OAuth secrets are server-side only (rule 5).*

### `privacy` — privacy settings
**Chrome:** `hdr("Privacy Settings")` -> `profile`. Tab bar (Profile).
Intro: *"You choose what leaves your phone. Health data never goes to advertisers."*
Then five toggle rows (same 46 x 27 track as `notifs`):

| Toggle | Subtitle | Default |
|---|---|---|
| Appear on city leaderboards | Your name and score are visible to others in your city. | on |
| Use approximate location | Assigns you to a city once. Never tracked in the background. | on |
| AI insights | Analyse your training and recovery to write your weekly insights. | on |
| Public profile | Let other athletes open your profile and see your PRs. | **off** |
| Crash diagnostics | Anonymous crash reports only — never health data. | on |

Then a **Permissions** group: **Location permission** ("How your city is assigned") ->
`location`, returning here; **Download my data** ("Export everything FORJD holds") -> toast
*"Export requested — we will email you"*. A `shield` note closes the screen: *"Turning off AI
insights stops new insights being generated. Your history stays on your device either way."*
**"Save"** -> toast *"Privacy settings updated"*, back to `profile`.

*Each toggle is a consent flag that gates a behaviour server-side — read it where the
behaviour happens, not only here. Two need decisions before build: **Public profile** implies a
profile other users can open, and that screen does not exist; **Crash diagnostics** must stay
inside CLAUDE.md rule 15 — no health data to any analytics SDK, which is why the subtitle says
so out loud.*

### `notifs` — notification settings
**Chrome:** `hdr("Notifications")` -> `profile`. Tab bar (Profile).
Intro: *"Two rules: nothing at night, nothing you cannot act on."* Then five toggle rows
(46 x 27 track, 21px knob, `background .18s`):

| Toggle | Subtitle | Default |
|---|---|---|
| Workout reminders | On your program days, 30 min before | on |
| Recovery alerts | When HRV or sleep drops sharply | on |
| PR celebrations | When you beat a lift or a run | on |
| Leaderboard moves | When your city rank changes | **off** |
| Weekly summary | Sunday evening recap | on |

**Quiet hours** card with a `clock` glyph and a **Change** action ("Edit quiet hours").

### `pro` — subscription upsell
**Chrome:** `hdr("Go Pro")` -> `←proReturnTo`. No tab bar.
`h1` **"Unlock everything FORJD tracks"** -> five perk rows, each a green check:

- Unlimited custom routines & programs
- Advanced recovery & HRV insights
- AI-powered workout recommendations
- Full city leaderboard history
- Priority sync with wearables

Two plan cards (selected = `rgba(233,113,47,.1)` fill + accent border): **Yearly** 59.99 —
"5/mo · billed annually" with a **SAVE 40%** badge (default) · **Monthly** 9.99 — "billed
monthly". Prices are shown with a leading dollar sign in the design.
**"Continue"** -> sets `isPro`, toast *"Welcome to Pro!"*, returns to the origin.

### `managePlan` — manage subscription
**Chrome:** `hdr("Manage Subscription")` -> `editProfile`. No tab bar.
**Current plan** card — "{Yearly|Monthly} · {price}", *"Renews automatically until
cancelled"*. A **Switch plan** row offering the other term (" · save 40%" on yearly), and a
destructive **Cancel** row.
*Phase 10, through RevenueCat. Store rules govern what this screen may say — check before
building.*

---

## Not product UI

### `brand` — logo directions
**Chrome:** `hdr("Logo directions")` -> `profile`.
Eight cards, each a 38–44px mark beside the `800 22 .02em` wordmark, with a name and a
rationale: **Current — bar chart** ("Four bars, reads as data. Clear, but close to every
analytics product.") · **A · Forge diamond** · **B · Recovery ring** · **C · Quadrant
block** · **D · Ascent line** · **E · Split tile** · **F · Pulse mark** · **G · Light mode**.
Closes with a **Recommendation** card.
**Do not implement.** Delete the route when transcribing; the decision belongs in an ADR or a
brand doc, not in the app.
