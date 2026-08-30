# Design revision — 2026-08-30

**What this file is:** the verified record of what changed when the user regenerated the
FORJD design, so a later session can tell revision-driven work from drift. It is a delta
record, not a spec. The per-screen specs are
[`nutrition-screen-specs.md`](nutrition-screen-specs.md) and
[`design-revision-screen-specs.md`](design-revision-screen-specs.md).

**Source of truth, in order:**

1. `FORJD mobile app design/FORJD Mobile.dc.html` — the runnable prototype. Outranks
   everything below. ~365 KB; grep it or `sed -n` it, do not read it whole. Screens are
   class methods named `s_<id>()`; locate them with
   `grep -nE "^\s*s_[A-Za-z0-9_]+\s*\(" "FORJD mobile app design/FORJD Mobile.dc.html"`.
2. `FORJD mobile app design/screenshots/*.png` — 65 annotated captures. Each carries a
   caption bar reading `New · <description>` or `Existing · <description>`, which is the
   designer's own statement of what changed.
3. `docs/design/*-screen-specs.md` — transcriptions of (1). Where a spec and the prototype
   disagree, the prototype wins and the spec is the thing that is wrong.
4. `FORJD mobile app design/design_handoff_forjd_mobile/*.md` — **frozen, pre-revision, and
   not authoritative.** See "The handoff bundle did not move" below.

## How this was verified

The previous prototype survives at
`FORJD mobile app design/design_handoff_forjd_mobile/FORJD Mobile.dc.html` (234 KB), so the
revision is a real diff rather than a recollection. Method lists were extracted from both
files with `grep -nE "^\s*s_[A-Za-z0-9_]+\s*\("` and compared; tokens, keyframes, atmosphere
classes and the tab-bar item list were diffed directly.

## The delta: 11 screens added, 0 removed, 0 renamed

Every screen id that existed before survives verbatim. The method count went 34 → 45.

| Screen id | Method (line) | Area | Screenshots |
|---|---|---|---|
| `pickUsername` | `s_pickUsername` (1883) | Onboarding | `create account username.png` |
| `nutrition` | `s_nutrition` (3496) | Nutrition | `nutrition dashboard.png`, `Set Nutrition goals.png`, `save meal.png`, `saved meals.png` |
| `foodSearch` | `s_foodSearch` (3646) | Nutrition | — |
| `foodDetail` | `s_foodDetail` (3685) | Nutrition | — |
| `savedMeals` | `s_savedMeals` (3738) | Nutrition | `saved meals page.png` |
| `editMeal` | `s_editMeal` (3835) | Nutrition | — |
| `nutritionShare` | `s_nutritionShare` (3777) | Nutrition | — |
| `favorites` | `s_favorites` (3007) | Train | `favourite workouts and programs.png`, `… 2.png` |
| `newExercise` | `s_newExercise` (3065) | Train | `custom exercise1.png`, `custom exercise2.png` |
| `setTimer` | `s_setTimer` (3121) | Live workout | visible within `live workout 2.png` |
| `athlete` | `s_athlete` (2521) | Profile | `public profile.png` |

Plus two additions inside the existing `profile` HTML template (it is a template, not an
`s_` method): a **Support** group (Privacy Policy / About App / Contact Us, all `flash()`
stubs) and a **Delete account** link with a `deleteAccountConfirm` bottom sheet.

Note that `athlete`, `favorites` and `newExercise` were *already referenced* by
`03-navigation.md` and `docs/design/phase2-screen-specs.md` before they existed as prototype
methods. They are new to the prototype, not new to the plan.

## What did NOT change — checked, not assumed

- **Design tokens are byte-identical.** `O='#e9712f'`, `GRN='#79b98a'`, `W='#f6f5f3'`,
  `DIM='#9a9a92'`, `DIMMER='#6e6e66'`, `CARD='#17181a'`,
  `BRD='1px solid rgba(255,255,255,.07)'`. `docs/design/02-design-tokens` equivalents and
  `apps/mobile/tailwind.config.ts` need no change on this account.
- **Fonts unchanged** — Archivo 400/500/600/700/800.
- **Atmosphere unchanged** — `fj-atm-ember`
  (`radial-gradient(130% 90% at 50% -10%, rgba(233,113,47,.20), #101011 55%)`) is still the
  default via `atmosphere ?? 'ember'`, and `fj-atm-verdant` still exists beside it. Keyframes
  `fj-fade`, `fj-pulse`, `fj-spin`, `fj-grow` unchanged.
- **The tab bar's five items are unchanged in label and order**: Home, Train, Progress, Rank,
  Profile. Nutrition is *not* a tab; it is reached from the Home dashboard's calorie card via
  `goNutrition`.

## What changed that is not a screen

**Tab-bar chrome.** The bar was restyled and this one *does* reach shipped code
(`apps/mobile/src/app/(tabs)/_layout.tsx` and `apps/mobile/src/components/tab-bar.tsx`):

| | before | after |
|---|---|---|
| height | fixed `76` | none; `alignItems: stretch` with per-item `minHeight: 44` |
| background | `rgba(14,14,15,.96)` + `backdropFilter: blur(12px)` | opaque `#101011`, no blur |
| padding | `10px 6px 0` | `8px 8px calc(8px + env(safe-area-inset-bottom, 8px))` |
| icon | `22` | `20` |
| label | `10px` | `9.5px` |

The substance is safe-area awareness and a 44 px minimum touch target — the same
accessibility floor that already forced the whole-row-toggle deviation in `notifs`/`privacy`.

**Three lines of new global CSS**, added for the nutrition numeric inputs: a `textarea` reset,
and `appearance: textfield` plus hidden spin buttons on `input[type=number]`.

**New nutrition data constants** at lines 900–942: `FOODS` (38 rows), `FOOD_CATS`, `SLOTS`,
`MACRO_GOALS`. Transcribed in full in `nutrition-screen-specs.md`.

## The handoff bundle did not move

`git diff --ignore-all-space` across
`FORJD mobile app design/design_handoff_forjd_mobile/*.md` is **empty**. All six files show as
modified only because their line endings changed. `grep -ril "nutrition\|pickUsername\|savedMeals"`
over the bundle returns nothing.

So the bundle is a frozen snapshot of the *pre-revision* design. It was already known to
contradict the prototype in fifteen catalogued places (ten in
`slice2-screen-specs.md` §9, five in `phase2-screen-specs.md` §7); it now additionally omits
an entire feature area, the new onboarding step, and five other screens. It is kept as
historical record and for the reasoning in `06-audit-log.md`. **Do not build from it, and do
not try to bring it up to date** — the prototype plus `docs/design/*` supersede it.

## Consequences recorded elsewhere

- Nutrition entering MVP scope: [ADR-020](../decisions/ADR-020-nutrition-in-mvp.md)
- Username and avatar becoming real: [ADR-019](../decisions/ADR-019-username-and-avatar.md)
- Subscription screens without billing:
  [ADR-021](../decisions/ADR-021-subscription-ui-without-billing.md)
- Build order and shipped-code divergences: `docs/product/roadmap.md`, "Design revision
  (2026-08-30)"
