# Handoff: FORJD Mobile — full app design

> # FROZEN — this bundle is a pre-revision snapshot. Do not build from it.
>
> **Two things make this bundle non-authoritative:**
>
> 1. **It predates the 2026-08-30 design revision.** The prototype was regenerated and gained
>    **11 screens** — an entire nutrition feature area (`nutrition`, `foodSearch`,
>    `foodDetail`, `savedMeals`, `editMeal`, `nutritionShare`) plus `pickUsername`,
>    `favorites`, `newExercise`, `setTimer` and `athlete`, and a Support / Delete-account
>    block on `profile`. **None of them are described anywhere in this bundle**
>    (`grep -ril nutrition` over these files returns nothing). The copy of
>    `FORJD Mobile.dc.html` sitting in *this* directory is the **old** prototype; the current
>    one is the copy one level up.
> 2. **It already contradicted the prototype in fifteen catalogued places before that** — ten
>    recorded in `docs/design/slice2-screen-specs.md` §9, five in
>    `docs/design/phase2-screen-specs.md` §7. It also still says the target is **Flutter**
>    (line below), which ADR-013 superseded when the app moved to Expo React Native.
>
> **Where to look instead, in priority order:**
>
> 1. `FORJD mobile app design/FORJD Mobile.dc.html` — the current runnable prototype, one
>    directory up. It outranks every summary, this one included.
> 2. `docs/design/design-revision-2026-08-30.md` — the verified delta record
> 3. `docs/design/nutrition-screen-specs.md` and `docs/design/design-revision-screen-specs.md`
> 4. `docs/design/slice2-screen-specs.md` and `docs/design/phase2-screen-specs.md`
>
> **This bundle is kept, not updated.** Bringing it up to date would produce a second summary
> competing with the prototype, which is the failure mode the discrepancy ledgers above exist
> to record. Its lasting value is the correctness audit in `06-audit-log.md` — the reasoning
> there is still worth reading.

**Source design:** `FORJD Mobile.dc.html` (bundled here)
**Target:** `apps/mobile` (Flutter) in the FORJD monorepo
**Prepared:** 2026-08-21, after a full correctness audit of the prototype (see `06-audit-log.md`)

---

## Overview

FORJD unifies training (weightlifting, running, HYROX, cross training, mobility), wearable
and health data (Apple Health, Health Connect, WHOOP) and InBody body-composition scanning
into one product. This design covers the whole app: onboarding, the five-tab shell, live
workout and run execution, programs and workout building, progress analytics, InBody import,
the city leaderboard, notifications, subscription and profile settings.

**43 route keys, 41 distinct screens.** Progress serves three tabs from one screen
(`progress` / `progressBody` / `progressRec`, which is why 41 keys are not 41 screens), and
Exercise detail has a separate running variant (`exerciseRun`) selected by category rather
than by route. One screen — `brand` — is a design exploration, not product UI (see
"Do not implement" below).

## About the design files

The files in this bundle are **design references authored in HTML/JS**. They are a
prototype of intended look and behaviour, not production code to port.

The task is to **recreate these designs in `apps/mobile` using the patterns the repo already
has** — `AppColors` / `AppText` / `AppDimens`, the `core/widgets` primitives, `go_router`,
Riverpod controllers, Drift for local state. Do not lift the JS. Do not introduce a second
token layer.

To open the prototype: put `FORJD Mobile.dc.html` and `support.js` in the same folder and
open the HTML in a browser. The left rail lists 28 screens; the rest are reached by tapping
through the phone. Everything in the frame is live.

## Fidelity

**High fidelity.** Final colours, typography, spacing, radii, copy and interaction states.
Recreate pixel-for-pixel using the existing token layer. Where a value in the prototype has
no token yet, `02-design-tokens.md` names it and proposes where it belongs — add the token,
do not inline the hex.

Two things are deliberately *not* final:
- **Charts** are hand-drawn SVG polylines and CSS bars with hard-coded sample series. The
  shapes are the spec; the data is placeholder.
- **Imagery** (run route map, InBody photo drop zone) is a striped placeholder with a
  monospace caption saying what belongs there.

## What is already built

Slice 11 transcribed this design's token layer and primitives, and shipped five of its
screens. Do not rebuild these — extend them.

| Design screen | Flutter |
|---|---|
| `welcome` | `features/auth/presentation/welcome_screen.dart` |
| `login` | `features/auth/presentation/login_screen.dart` |
| `signup` | `features/auth/presentation/register_screen.dart` |
| `profile` | `features/profile/presentation/profile_screen.dart` |
| `editProfile` | `features/profile/presentation/edit_profile_screen.dart` |
| five-tab shell | `features/shell/presentation/app_shell.dart` |
| tokens | `core/theme/app_colors.dart`, `app_typography.dart`, `app_dimens.dart` |
| primitives | `core/widgets/*` (button, field, labels, list row, chips, chrome, tab bar, icons) |

`forgot_password_screen.dart` exists in Flutter with **no counterpart in this design** — the
design only has the "Forgot password?" link on `login`. Treat the Flutter screen as the
source of truth for that flow and leave it alone.

## Do not implement

- **`brand`** — eight logo directions with rationale copy. A design artefact for the founder,
  not a screen. Its recommendation is direction **A · Forge diamond**; the current bar-chart
  mark is what the app ships today. Delete the route when transcribing.
- The **left rail and caption strip** around the phone — prototype navigation chrome.
- The **phone bezel, notch and 9:41 status bar** — mock chrome. The real app uses the device's.

## Phase mapping

Screens are grouped by the roadmap phase that unblocks their data. Building a screen before
its data source exists means rendering zeros, which reads as a bug — the roadmap already made
that call for the profile stat tiles.

| Phase | Screens |
|---|---|
| **1 — done** | `welcome` `login` `signup` `profile` `editProfile` shell |
| **1 — designed, no data yet** | `goals` `units` `notifs` `privacy` `location` |
| **2 — exercise database** | `library` `exercise` `exerciseRun` |
| **3 — walking skeleton** | `live` `rest` `done` `builder` `workoutDetail` `workoutHistory` `workoutHistoryDetail` `train` `run` `runDone` |
| **4 — programs** | `catalog` `programOverview` `programBuilder` |
| **5 — InBody** | `inbody` `inbodyConfirm` `scanDetail` `inbodyCompare` `progressBody` |
| **6 — health + analytics** | `home` `progress` `progressRec` `weekly` `notifsFeed` `connect` |
| **10 — leaderboards + subs** | `rank` `athlete` `pro` `managePlan` `sessionShare` |

## Constraints this design must respect

From `CLAUDE.md` — these are not suggestions, CI enforces several of them:

1. **Live workout execution must work offline** (rule 6). `live` / `rest` / `done` and
   `run` / `runDone` never block on the network. `done` already shows this in copy:
   *"logged offline, will sync when you are back online."*
2. **No health data to any analytics or advertising SDK** (rule 15). Every number on
   `home`, `progress*`, `weekly` and `connect` is health data.
3. **Health observations preserve their source** (rule 10). `progressRec` renders a source
   line per metric ("Apple Health", "WHOOP") — that is the source-priority policy surfacing
   in the UI, not decoration. Keep it.
4. **Providers behind `HealthProvider`** (rule 3). `connect` is a view over the provider
   registry, not four hard-coded integrations.
5. **Domain code must not depend on UI** (rule 1). Screen state stays in
   `features/<x>/application`.
6. **HealthKit / Health Connect needs a physical device before merge** (rule 16).

## Files in this bundle

| File | What is in it |
|---|---|
| `README.md` | this file |
| `01-screen-inventory.md` | every screen: purpose, layout, components, exact copy |
| `02-design-tokens.md` | full token census, mapping to the Flutter theme, gaps to add |
| `03-navigation.md` | route graph, the return-target contract, tab bar rules |
| `04-state-and-data.md` | the prototype's state model and what each field becomes |
| `05-interactions.md` | validation, timers, animations, toasts, empty and error states |
| `06-audit-log.md` | the correctness audit that preceded this handoff |
| `FORJD Mobile.dc.html` | the prototype |
| `support.js` | runtime the prototype needs to open |

## Open questions for the designer

1. **`libFilter` default.** The exercise library opened pre-filtered to *Running*; the audit
   changed it to *All*. Confirm that is right.
2. **`AppColors.errorText` (`#E05A3C`)** sits close to the accent, so an inline error reads
   a little like a link. Known, recorded in the roadmap, needs a palette call.
3. **Three missing icons** — `calendar` (the birthday field borrows `clock`), `eye`
   (password visibility) and `pencil` (edit). Currently Material glyphs. Drawing them is a
   design task.
4. **`@username`** is designed but has no column, no uniqueness policy and no availability
   endpoint. The profile screen currently shows the email in the handle slot.
5. **Avatar upload** is designed as initials only; `StorageProvider` is unconsumed until
   Phase 5.
6. **Sex chips** — the design draws three values, `sexSchema` has four. Flutter renders four.
7. **The five privacy toggles have no backend.** Each needs a column and a policy. *Public
   profile* now has the screen it implies (`athlete`), so what remains is the server-side rule:
   a private profile must be refused server-side, not hidden client-side, and the leaderboard
   row stays public either way.
8. **Exercise training goals must come from somewhere.** The live guide keys off a per-exercise
   goal (see `06-audit-log.md`, round 3). `free-exercise-db` has no such field — map it from
   category/mechanic on import, or author it.
9. **InBody is no longer a connected source.** `connect` lists three providers; scans arrive
   through the Progress → Body import flow.
