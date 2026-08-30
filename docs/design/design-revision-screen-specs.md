# Design-revision screen specs — the five non-nutrition additions

**Source:** `FORJD mobile app design/FORJD Mobile.dc.html`, the runnable prototype, which
outranks every summary including this file. Line numbers verified against the 2026-08-30
revision; re-anchor with `grep -nE "^\s*s_[A-Za-z0-9_]+\s*\("` if the prototype is
regenerated.

**Scope:** `pickUsername`, `favorites`, `newExercise`, `setTimer`, `athlete`, plus the
Support / Delete-account block added to the existing `profile` template. The six nutrition
screens are in [`nutrition-screen-specs.md`](nutrition-screen-specs.md); the delta record is
[`design-revision-2026-08-30.md`](design-revision-2026-08-30.md).

---

## 0. Build-readiness

| Screen | Method | Backend needed | Status |
|---|---|---|---|
| `pickUsername` | `s_pickUsername` (1883) | `username` column + uniqueness check; avatar upload | blocked on ADR-019 work |
| `athlete` | `s_athlete` (2521) | **partly exists** — `GET /athletes/:userId`. Stat tiles/PRs/sessions need Phase 3 + Phase 10 | partly buildable |
| `newExercise` | `s_newExercise` (3065) | custom-exercise write API | Phase 2 K |
| `favorites` | `s_favorites` (3007) | favourites API + workouts/programs | Phase 2 G, then Phase 4 |
| `setTimer` | `s_setTimer` (3121) | none — pure client state | Phase 3 |

---

## 1. `pickUsername` (1883–1915)

A **new onboarding step between `signup` and `goals`**. `signup` currently routes straight to
`/goals?returnTo=newAccount`; it must route here first.

- Header: `Your Profile`. Back → `signup`.
- Subcopy: `Pick a unique username and add a photo so friends can find you.`
- Avatar block, centred, 88 px circle. Fallback glyph is the first character of the typed
  username, uppercased, or `?` when empty. Camera badge over a file input
  (`accept="image/*"`, read as a data URL). Text link beneath: `Upload photo`.
- Label `Username`; input placeholder `e.g. jsmith`.
- Helper text when there is no error: `3–20 characters: letters, numbers, underscores.`
  (en dash).
- CTA: `Continue`. Inline in the scroll area with `marginTop: 26` — **not** a sticky footer.
- No tab bar.

### Validation — the important part

- Rule: `/^[a-z0-9_]{3,20}$/`.
- **The input sanitises as you type**: `value.toLowerCase().replace(/[^a-z0-9_]/g,'')`.
  Illegal characters are silently stripped, so **length is the only client-reachable error**.
- The button is **never visually disabled**; it validates on tap and writes an error.
- Errors: `Enter 3–20 letters, numbers, or underscores.` and `That username is taken.`
- Prototype's demo taken-list: `['jmitch','admin','forjd','test']` — a stand-in for a real
  server check. Per ADR-019 the server validates the full pattern regardless of the
  sanitising input, and uniqueness is case-insensitive.

On success: writes `username`, `handle` and the avatar onto the profile, then navigates to
`goals` with `returnTo: 'newAccount'` — i.e. it inherits, not replaces, the existing
first-run branch on the goals screen.

---

## 2. `favorites` (3007–3064)

- Header `Favourites` (British spelling), back → `train`. Tab bar active: **Train**.
- Subcopy: `Everything you starred, newest first.`
- Sorted by favourited-at, descending. **Cap of 3 per section**, with a `See all` control
  below when the list is longer.

Two sections, in order:

1. `Favourite programs` — empty state:
   `No favourite programs yet — star one from the program catalogue.`
2. `Favourite workouts` — empty state:
   `No favourite workouts yet — star one in My workouts.`

Section header carries the label and a right-aligned count. Row shows the name, a type chip
with meta, and a third line `Favourited <date>` falling back to `Favourited recently`.
Non-program rows get a `Start` pill; the star icon toggles the favourite.

Navigation sets a return target before leaving — programs set `programReturnTo: 'favorites'`,
workouts set `workoutDetailReturnTo: 'favorites'`. Follow the `returnTo`-as-query-param
pattern that `goals` and `location` already established, not prototype app state.

> **Discrepancy — the screen ships two sections, not three.** Lines 3017 and 3040–3048 define
> a favourite-*exercises* list and row renderer that are **never rendered**, `favShow` still
> carries an `exercises` key, and the prototype's own caption says "workouts, programs &
> exercises". Build the two sections that render. Any doc promising a third is describing dead
> code — including `docs/design/phase2-screen-specs.md` §7.4, which flagged `s_favorites` as
> dead code entirely when it was reachable only from the screen index.

---

## 3. `newExercise` (3065–3120)

Doubles as create **and** edit: header is `New Exercise`, or `Edit Exercise` when editing.
Back → `library`.

Fields in order:

1. `Exercise name` — placeholder `e.g. Landmine Press`
2. `Muscles worked`, hint `Pick one or more`. Multi-select chips: Chest, Back, Shoulders,
   Biceps, Triceps, Forearms, Core, Glutes, Quads, Hamstrings, Calves, Hips, Full Body.
   Selected chips gain a checkmark.
3. `Equipment used`, hint `Pick one or more`. Chips: Barbell, Dumbbell, Kettlebell, Machine,
   Cable, Band, Bodyweight, Bench, Rack, Medicine Ball, TRX, Sled.
4. `Description`, hint `Optional — cues, setup or form notes`. Textarea placeholder:
   `e.g. Brace the core, elbows tucked at 45°, drive through the mid-foot.`
5. `Category`, single select: Strength, Running, Cross Training, Calisthenics, Yoga,
   Mobility. Default `Strength`.
6. `Measured by`, three equal options: `Weight × reps`, `Time`, `Distance`. Default weight.
   Footnote: `Time-based exercises get a set timer during a live workout; distance exercises
   log metres.`

**Sticky footer**: `Save Exercise`, or `Save Changes` when editing.

**Validation.** Readiness (name + at least one muscle + at least one equipment + category +
measure) only sets `opacity` to 0.5 — the button stays tappable and errors on tap:

- `Give the exercise a name first`
- `Pick at least one muscle worked`
- `Pick at least one piece of equipment`
- `An exercise with that name already exists` (case-insensitive, across the whole library,
  excluding the record being edited)

**Vocabulary reconciliation is required before building this.** The chip lists here are
display strings; `packages/domain/src/exercise-vocabulary.ts` holds the canonical enums.
`MUSCLE_GROUPS` has 19 members against this screen's 13 chips (the screen omits lats, traps,
lower_back, neck, abductors, adductors), and `EQUIPMENT` has 16 against 12 (the screen omits
foam_roller, exercise_ball, ez_curl_bar, other). The screen is a **subset**, not a conflict —
but Phase 2 K must decide explicitly whether the picker shows the subset or the full enum,
and record it. The category tuple matches `EXERCISE_CATEGORIES` exactly, and
`exercise-vocabulary.spec.ts` already asserts that order.

The prototype derives `goal` from `measure` (`weight` gives Hypertrophy, otherwise Muscular
endurance). The real schema has `goal` as its own column with five values, so this derivation
is a prototype shortcut, not a rule to port.

---

## 4. `setTimer` (3121–3155)

Full-bleed, no standard header, no tab bar. Shown for a time-measured exercise during a live
workout.

- Top bar: left eyebrow `Timed set` (uppercase, orange); right `<mm:ss> elapsed` then an `×`
  that returns to `live` and clears the timer.
- Centre: a 200 px progress ring (r = 86) counting `left / total`. Inside, the large `mm:ss`,
  and beneath it `paused` when paused, otherwise `hold the position`.
- Below the ring: label `Current set`, the exercise name, then `Set <n> · <total> s target`.
- Adjust row: `−15s` and `+15s`. `+15` also raises `total` so the ring cannot overflow;
  `left` floors at 1.
- **Sticky footer**: ghost `Pause` / `Resume`, and primary `Complete set`.

Pure client state — no backend. Note this screen is why `newExercise`'s `Measured by` field
matters: it is the destination for `measure: 'time'`.

---

## 5. `athlete` (2521–2570) — the divergence to fix

Header: `Your public profile` for self, otherwise `Athlete`. Back → the return target
(`rank` or `profile`), with the tab bar following it.

Two mutually exclusive bodies:

**Private** (the default for your own profile — `publicProfile` starts `false`):
shield icon card; title `Your profile is private` / `This profile is private`; body for self
`Turn on Public profile and other athletes will see your rank, records and recent sessions —
nothing else.`, for others `<Name> keeps their profile private. Their leaderboard position
stays public.`; self only gets the button `Open Privacy Settings`.

**Public:**

- Identity row: initials avatar (up to two name words), name, **`@handle`**, and
  `<City> · #<n> this month` with a pin icon.
- Stat trio: `City rank` `#n`, `Score`, `Streak` with the sub-label `weeks`.
- `Personal records`: Bench Press, Back Squat, Deadlift, 5K Run — orange values.
- `Recent sessions`: three rows of `<name> · <date>` with volume or time.
- Footer disclosure card: `Rank, records and sessions only. Sleep, HRV, body composition and
  InBody scans are never public.`

### What is shipped versus what is drawn

`apps/mobile/src/app/athlete/[userId].tsx` ships **identity only**, and its header comment
records three justifications for that. One of the three is now overtaken:

| Comment's claim | Status |
|---|---|
| "No handle line — the handle concept was dropped project-wide" | **Overturned by ADR-019.** The handle is back. |
| "Stat tiles, PRs and sessions omitted — they need Phase 10 data that does not exist" | **Still true, and still correct.** The data genuinely does not exist. Keep omitting them; do not fake them. |
| "One generic error state, not the stranger-specific 'this profile is private' copy" | **Still true and still correct.** The backend returns byte-identical 404s for "private" and "no such user" deliberately, because a distinguishable refusal is an account-enumeration oracle. Reproducing the prototype's copy for a 404 would leak exactly what the backend refuses to leak. |

The self-view private state **does** render and is unaffected — self always receives data
regardless of the flag, so it renders from a real success response rather than a refusal.

**When this screen is next touched, rewrite that comment.** A justification left in place
outlives the decision it justified, and the next session would re-derive the dropped-handle
rule from the code.

---

## 6. Profile template — Support and Delete account

The `profile` screen is a static HTML template, not an `s_` method. Two blocks were added.

**Support group**, eyebrow `Support`, three chevron rows — all `flash()` stubs in the
prototype with no destination screen:

| Row | Prototype behaviour |
|---|---|
| `Privacy Policy` | flash only |
| `About App` | flash only |
| `Contact Us` | flash only |

These need real destinations (or a web view) before beta; `Privacy Policy` in particular is a
store-review requirement, not a nicety.

Below them: `Log out` in red (`#c9503c`) with a red door icon, `margin-top: 14px`, **no
confirmation** — matching the shipped screen. Then, below the divider list, `Delete account`
as a plain dim text link (`#6e6e66`), no icon and no chevron.

**`deleteAccountConfirm` sheet:**

- Title: `Delete account?`
- Body: `This permanently deletes your account, workout history, and progress data. This
  can't be undone.`
- Two buttons, **side by side and equal width**: `Delete account` on a red `#c9503c` fill
  with white text on the **left**, and `Keep account` on the **orange brand fill `#e9712f`**
  on the right.
- No typed confirmation, no password re-entry. Confirming returns to `welcome`.

> **Read the button emphasis carefully.** The destructive action is on the left and the
> *safe* action carries the primary brand colour. That is the intended emphasis. Any doc or
> implementation that styles `Delete account` as the primary button has it backwards.

Backend note: there is no delete-account route today, but every foreign key in the schema is
already `ON DELETE CASCADE`, so the data model needs no change — only an endpoint, and a
decision about whether the Supabase auth user is deleted alongside the local row.
