# Nutrition screen specs — extracted from the prototype

**Source:** `FORJD mobile app design/FORJD Mobile.dc.html`, the runnable prototype, which
outranks every summary including this file. Where this doc and the prototype disagree, the
prototype is right. Line numbers below were verified against the file as of the 2026-08-30
revision; if the prototype is regenerated, re-anchor them with
`grep -nE "^\s*s_[A-Za-z0-9_]+\s*\("`.

**Scope:** the six nutrition screens added by the 2026-08-30 design revision, plus the Home
dashboard's entry point. Build plan: [`../product/nutrition-plan.md`](../product/nutrition-plan.md).
Scope decision: [ADR-020](../decisions/ADR-020-nutrition-in-mvp.md).

**Not a tab.** Nutrition is reached from the Home dashboard's "Nutrition Today" calorie card
(`goNutrition`). The five-tab bar does not change.

---

## 0. Build-readiness

| Screen | Method | Backend needed | Buildable today |
|---|---|---|---|
| `nutrition` | `s_nutrition` (3496) | food log, meals, macro goals | no |
| `foodSearch` | `s_foodSearch` (3646) | food database + search | no |
| `foodDetail` | `s_foodDetail` (3685) | food database | no |
| `savedMeals` | `s_savedMeals` (3738) | saved meals | no |
| `editMeal` | `s_editMeal` (3835) | saved meals | no |
| `nutritionShare` | `s_nutritionShare` (3777) | none — renders from local state | yes, after `nutrition` |

Nothing here exists in the backend today: no food, meal, or nutrition tables, contracts or
routes. The whole area is a new vertical.

---

## 1. Data constants (lines 900–942)

### `FOODS` (line 900) — 38 rows

Row shape: `[name, category, kcalPer100g, protein, carbs, fat, [[servingLabel, grams], …]]`.
Macros are per 100 g; a serving's values are `value * grams / 100`.

| name | category | kcal | P | C | F | servings |
|---|---|---|---|---|---|---|
| Banana | Fruits | 89 | 1.1 | 22.8 | 0.3 | `1 medium (118g)`=118, `100 g`=100 |
| Apple | Fruits | 52 | 0.3 | 13.8 | 0.2 | `1 medium (182g)`=182, `100 g` |
| Blueberries | Fruits | 57 | 0.7 | 14.5 | 0.3 | `1 cup (148g)`=148, `100 g` |
| Strawberries | Fruits | 32 | 0.7 | 7.7 | 0.3 | `1 cup (152g)`=152, `100 g` |
| Avocado | Fruits | 160 | 2 | 8.5 | 14.7 | `1/2 avocado (100g)`=100, `100 g` |
| Orange | Fruits | 47 | 0.9 | 11.8 | 0.1 | `1 medium (131g)`=131, `100 g` |
| Chicken Breast (grilled) | Protein | 165 | 31 | 0 | 3.6 | `1 breast (172g)`=172, `100 g` |
| Salmon (cooked) | Protein | 208 | 20 | 0 | 13 | `1 fillet (154g)`=154, `100 g` |
| Ground Beef 90/10 (cooked) | Protein | 217 | 26 | 0 | 12 | `1 patty (85g)`=85, `100 g` |
| Egg (whole, boiled) | Protein | 155 | 13 | 1.1 | 11 | `1 large egg (50g)`=50, `2 eggs (100g)`=100 |
| Egg Whites | Protein | 52 | 11 | 0.7 | 0.2 | `1 cup (243g)`=243, `100 g` |
| Tofu (firm) | Protein | 144 | 15.8 | 2.8 | 8.7 | `1/2 block (126g)`=126, `100 g` |
| Shrimp (cooked) | Protein | 99 | 24 | 0.2 | 0.3 | `100 g`=100, `6 large (90g)`=90 |
| Turkey Breast (deli) | Protein | 104 | 17.4 | 3.4 | 1.7 | `3 slices (85g)`=85, `100 g` |
| Greek Yogurt (plain, 2%) | Dairy | 73 | 10 | 3.9 | 2 | `1 cup (245g)`=245, `100 g` |
| Cottage Cheese | Dairy | 98 | 11 | 3.4 | 4.3 | `1 cup (226g)`=226, `100 g` |
| Milk (2%) | Dairy | 50 | 3.4 | 4.9 | 2 | `1 cup (244g)`=244, `100 g` |
| Cheddar Cheese | Dairy | 403 | 25 | 1.3 | 33 | `1 slice (28g)`=28, `100 g` |
| Almonds | Snacks | 579 | 21 | 22 | 50 | `1 oz · 23 nuts (28g)`=28, `100 g` |
| Peanut Butter | Snacks | 588 | 25 | 20 | 50 | `2 tbsp (32g)`=32, `100 g` |
| Protein Bar | Snacks | 380 | 30 | 35 | 12 | `1 bar (60g)`=60 only |
| Dark Chocolate (70%) | Snacks | 598 | 7.8 | 45.9 | 42.6 | `1 square (10g)`=10, `100 g` |
| Protein Shake (whey + water) | Beverages | 400 | 80 | 10 | 5 | `1 scoop (33g)`=33 only |
| White Rice (cooked) | Grains | 130 | 2.7 | 28 | 0.3 | `1 cup (158g)`=158, `100 g` |
| Brown Rice (cooked) | Grains | 123 | 2.7 | 26 | 1 | `1 cup (195g)`=195, `100 g` |
| Quinoa (cooked) | Grains | 120 | 4.4 | 21 | 1.9 | `1 cup (185g)`=185, `100 g` |
| Oats (dry) | Grains | 389 | 16.9 | 66 | 6.9 | `1/2 cup (40g)`=40, `100 g` |
| Whole Wheat Bread | Grains | 247 | 13 | 41 | 3.4 | `1 slice (28g)`=28 only |
| Pasta (cooked) | Grains | 158 | 5.8 | 31 | 0.9 | `1 cup (140g)`=140, `100 g` |
| Black Beans (cooked) | Grains | 132 | 8.9 | 23.7 | 0.5 | `1 cup (172g)`=172, `100 g` |
| Sweet Potato (baked) | Vegetables | 90 | 2 | 20.7 | 0.2 | `1 medium (150g)`=150, `100 g` |
| Broccoli (steamed) | Vegetables | 35 | 2.4 | 7.2 | 0.4 | `1 cup (156g)`=156, `100 g` |
| Spinach (raw) | Vegetables | 23 | 2.9 | 3.6 | 0.4 | `1 cup (30g)`=30, `100 g` |
| Mixed Salad Greens | Vegetables | 15 | 1.4 | 2.9 | 0.2 | `2 cups (60g)`=60 only |
| Olive Oil | Fats | 884 | 0 | 0 | 100 | `1 tbsp (14g)`=14 only |
| Butter | Fats | 717 | 0.9 | 0.1 | 81 | `1 tbsp (14g)`=14 only |
| Coffee (black) | Beverages | 2 | 0.3 | 0 | 0 | `1 cup (240ml)`=240 only |
| Orange Juice | Beverages | 45 | 0.7 | 10.4 | 0.2 | `1 cup (248ml)`=248 only |

Three categorisations are surprising and are transcribed as-is, not corrected:
**Black Beans is `Grains`**, **Avocado is `Fruits`**, and Protein Shake / Coffee / Orange
Juice are `Beverages`.

**This table is a demo, not a product.** 38 foods cannot back a real food log. Choosing a
real source is an open ADR — see `../product/nutrition-plan.md`.

### The other three (lines 940–942)

```js
FOOD_CATS   = ['All','Protein','Grains','Fruits','Vegetables','Dairy','Snacks','Fats','Beverages']
SLOTS       = ['Breakfast','Lunch','Snack','Dinner']
MACRO_GOALS = {kcal:2400, protein:180, carbs:240, fat:80}
```

- `SLOTS` order matters: **Snack sits between Lunch and Dinner**, not last.
- `MACRO_GOALS` is **dead** — `state.macroGoals` is an identical literal and is what every
  screen actually reads. Do not model it as a separate concept.
- Custom foods are written with category `Custom`, which is **not in `FOOD_CATS`**, so they
  are reachable only under the `All` chip. Transcribed as a prototype defect, not a spec.

### First-run state

`nutritionLog` is `{Breakfast:[],Lunch:[],Snack:[],Dinner:[]}` and `savedMeals` is `[]`.
**Every nutrition screen's first impression is its empty state** — spec and build those first.

---

## 2. `nutrition` — the dashboard (3496–3641)

Header `Nutrition`, **no back button** (it is a destination, not a sub-screen), three
right-aligned icon actions in this order:

1. share icon → `nutritionShare`
2. target icon → opens the *Set daily goals* sheet
3. star icon → `savedMeals`

**Summary card.** A 120 px ring for `totals.kcal / goals.kcal`; centre reads the rounded
total with `/ <goal> kcal` beneath. To its right, three macro bars in fixed order —
`Protein` (`#e9712f`), `Carbs` (`#6f9ac9`), `Fat` (`#79b98a`) — each labelled
`<val>g / <goal>g` on the right. **`#6f9ac9` is a new colour with no token**; see §7.

**Meal sections**, one per `SLOTS` entry in order:

- Header: the slot name, uppercase. Right side appears **only when the slot has items**: the
  `<n> kcal` subtotal and the orange link `Save as meal`.
- Item row: name; second line is the serving label plus ` × <qty>` when qty > 1; right side
  `<n> kcal`; an `×` deletes it and flashes `Removed from <Slot>`. Tapping the row opens
  `foodDetail` in edit mode.
- Grouped rows: items logged together from a saved meal share a `groupId` and collapse into
  one row showing the meal name and `<n> items · tap to view` / `tap to collapse`. The `×`
  deletes the whole group.
- Section footer: orange `+ Add food`.
- **There is no per-slot empty-state string.** An empty slot renders its label and
  `+ Add food`, nothing else.

**Saved meals strip**, rendered only when `savedMeals` is non-empty: label `Saved meals` with
a `See all` link to `savedMeals`, then up to three cards showing name, `<n> items · <n> kcal`
and a `Log` pill.

### Sheets

All three are bottom sheets: scrim `rgba(10,10,11,.72)`, panel `#17181a`, radius
`18px 18px 0 0`.

**a) Save as meal** (3601–3607)

- Title: `Save <Slot> as a meal` — e.g. `Save Breakfast as a meal`
- One text input, **prefilled** with `<Slot> — usual` (em dash), e.g. `Breakfast — usual`.
  No placeholder, no label.
- Buttons: `Save` (flex) and `Cancel` (96 px)
- Empty slot: no-ops. Blanked name: falls back to `<Slot> meal`. Flashes `Saved "<name>"`.

**b) Log meal** (3609–3615) — *duplicated verbatim inside `savedMeals` at 3765–3774*

- Title: `Log "<meal name>"`
- Copy: `Add all items to which meal?`
- Slot chips from `SLOTS`; buttons `Log` / `Cancel`
- Flashes `Logged "<name>" to <Slot>`

**c) Set daily goals** (3616–3635)

- Title: `Set daily goals`
- First row is a tappable orange-tinted card: `Auto-calculate`, sub-line
  `From your InBody scan + training goals`. It **fills the inputs only — it does not commit**,
  and flashes `Calculated from your InBody scan + goals`.
- Four numeric rows: `Calories` (unit `kcal`), then protein / carbs / fat rendered with
  `textTransform: capitalize`, so they display **Protein / Carbs / Fat**, unit `g`.
  Digits-only input filter.
- Buttons `Save` / `Cancel`. Flashes `Goals updated`.
- **`saveGoals()` silently falls back to the previous goal for any NaN or non-positive
  value.** It never errors. Reproduce or improve deliberately, not by accident.

**Auto-goal maths** (`autoGoalsFromInbody`, 1250–1262):
`tdee = bmr × 1.45`, `bmr` from the InBody scan's basal metabolic rate (prototype default
1800; weight default 80). Then per primary training goal:

| goal | kcal delta | protein g/kg |
|---|---|---|
| Lose fat | −500 | 2.2 |
| Build muscle | +250 | 2.0 |
| Get stronger | +100 | 2.0 |
| Improve endurance | +150 | 1.7 |
| Feel better | 0 | 1.6 |

Fat = 25 % of kcal; carbs = the remainder, floored at 50 g.

**This depends on InBody, which is Phase 5.** Per ADR-020, until then the Auto-calculate row
is hidden or disabled with honest copy — never shipped computing from the 1800/80 defaults.

---

## 3. `foodSearch` (3646–3684)

- Header is contextual: `Add ingredient` when `foodTarget === 'meal'`, otherwise
  `Add to <Slot>` (e.g. `Add to Lunch`). Back goes to `editMeal` or `nutrition` to match.
  Right icon `+` opens the custom-food sheet.
- Search field, placeholder `Search foods…` (single-character ellipsis).
- Category chips = `FOOD_CATS`.
- Result row: name; sub-line `<category> · <first serving label>`; right column shows kcal
  **for the first serving**, not per 100 g — `round(kcalPer100g × firstServingGrams / 100)`.
- Filter: `(cat === 'All' || food.category === cat) && name.toLowerCase().includes(query)` —
  **substring, not prefix**.
- Empty state: `No foods match "<query>"`, echoing the raw typed query.

**Add custom food sheet** (3668–3683)

- Title `Add custom food`; input placeholder `Food name`; hint `Enter values per 100 g`
- Four numeric rows: `Calories`/kcal, `Protein`/g, `Carbs`/g, `Fat`/g (decimals allowed)
- Buttons `Add Food` / `Cancel`; flashes `Added <name> to your foods`
- **Returns silently on an empty name — no error message.** Category is hardcoded `Custom`;
  single serving `[['100 g', 100]]`.

---

## 4. `foodDetail` (3685–3737)

- Header title is the food name. Back target depends on entry: `editMeal` for a meal target,
  `nutrition` when editing an existing log entry, otherwise `foodSearch`.
- Category line beneath the header.
- Macro card: large kcal numeral with the label `kcal`, then three centred stats
  `Protein` / `Carbs` / `Fat` as `<n>g`, coloured orange / blue / green.
- **`Serving`**: one row per serving (label + that serving's kcal), then a final
  `Custom amount` row. Unselected, its right side reads `enter grams`; selected, it becomes a
  numeric input with placeholder `0` and a `g` suffix.
- **`Quantity`**: `−` / count / `+` stepper, minimum 1. **Hidden entirely when Custom amount
  is selected.**
- **`Log as`**: slot chips. **Hidden when `foodTarget === 'meal'`.**
- Sticky footer, primary label by mode: `Save Changes` (editing) → `Add Ingredient` (meal
  target) → `Add to Log`. When editing, a ghost `Remove Entry` sits below it.
- No disabled state. A custom amount of 0 g is accepted and logs a 0-kcal item labelled
  `0 g (custom)`.
- Saving filters the item id out of **every** slot before appending, so editing an entry can
  relocate it between meals. Flashes `Logged <name> — <Slot>` / `Updated <name> — <Slot>`.

---

## 5. `savedMeals` (3738–3776)

- Header `Saved Meals`, back to `nutrition`. **No tab bar.**
- Meal card: name; sub-line `<n> items · <n> kcal · P<n> C<n> F<n>`; a pencil icon opening
  `editMeal` and an `×` that deletes — **no confirmation dialog** — flashing
  `Saved meal removed`.
- Ingredient list inside the card: `<name> · <servingLabel>` (+ ` × <qty>` if > 1) with kcal
  right-aligned.
- Card CTA: `Log this meal`, opening the log sheet defaulted to `Breakfast`.
- Empty state: `No saved meals yet — save one from a meal on the Nutrition tab.`
- Carries its own copy of the *Log meal* sheet, identical to `nutrition`'s.

---

## 6. `editMeal` (3835–3866) and `nutritionShare` (3777–3834)

### `editMeal`

- Header `Edit Meal`, back to `savedMeals`. Renders an empty node when there is no draft.
- Name input at top — **no label, no placeholder** — prefilled with the meal name.
- Summary line: `<n> items · <n> kcal · P<n> C<n> F<n>`.
- Ingredient row: name; `<n> kcal` sub-line; an inline **grams input** with a `g` suffix; an
  `×` to remove. Editing grams recomputes macros and rewrites the serving label to
  `<n> g (custom)` with `qty: 1`, minimum 1 g.
- Empty state: `No ingredients — add one below.`
- Below the list: orange `+ Add ingredient` → `foodSearch` with `foodTarget: 'meal'`.
- Sticky footer `Save Meal` → returns to `savedMeals`, flashes `Saved meal updated`.
  **No validation** — an empty-name, zero-ingredient meal saves fine.

### `nutritionShare`

- Header `Share Nutrition`, back to `nutrition`. Live 4:5 preview card with the `FORJD`
  wordmark in orange.
- Three layouts:

  | id | label | description |
  |---|---|---|
  | `summary` | `Daily Summary` | `Calories vs goal, at a glance` |
  | `macros` | `Macro Split` | `Protein · Carbs · Fat breakdown` |
  | `meals` | `Meal Log` | `Everything logged today` |

- Preview bodies: *summary* = 110 px ring + caption `Today's intake`; *macros* = `<n> kcal`
  headline over three labelled bars `<n>g / <n>g`; *meals* = `<n> kcal total` then the
  **first 7 items only**, overflow hidden with **no "+N more" affordance**.
- Section label `Choose a layout`, a horizontal strip of 100×125 thumbnails; the selected one
  gets a 2 px orange border and an orange label.
- Actions: primary `Save Image` (flashes `Image saved to Photos`), then a row of `Instagram`
  and `More`, each flashing `Sharing to <label>…`.
- `nutriShareLayout` defaults to `null`, falling back to `summary`.

---

## 7. Discrepancies and things to decide

Recorded so a later session does not mistake them for its own mistakes.

1. **`MACRO_GOALS` (942) is dead code.** `state.macroGoals` is the real source. Do not model
   both.
2. **Custom foods use category `Custom`, absent from `FOOD_CATS`** — only findable under
   `All`. Either add the category or drop it; the prototype does neither.
3. **`saveGoals()` swallows invalid input** (NaN or non-positive silently reverts). Almost
   certainly wants a real validation message in the build.
4. **`saveCustomFood()` returns silently on an empty name** — same class of problem.
5. **`nutritionShare` and `editMeal` have no entries in `CAPTIONS`**, and no nutrition screen
   appears in `SCREENS_A`/`SCREENS_B`. The prototype's screen index is **not** the screen
   list; six real screens are missing from it.
6. **`#6f9ac9` (the Carbs blue) has no design token** and is not in the token block at line
   892. It needs one before any screen uses it; `apps/mobile/src/theme/tokens.ts` and
   `tailwind.config.ts` are hand-synced and guarded by `theme/__tests__/tokens.test.ts`.
7. **The share sheet exports health data as an image.** User-initiated, so it is not a
   CLAUDE.md rule 15 violation — but it is the first export path in the app and deserves an
   explicit look when built.
8. **Deleting a saved meal has no confirmation**, while deleting an *account* does. Worth
   asking whether that asymmetry is intended.
