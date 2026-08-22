# Interactions, states and motion

## Toast — `flash(message)`

One mechanism carries almost all feedback in this design. Pill at `bottom: 96`
(`left/right: 22`), `rgba(28,29,32,.97)`, radius 12, `600 13` text, shadow
`0 10px 30px rgba(0,0,0,.50)`, fades in over 200ms, **auto-dismisses after 1900ms**. Never
has an action or a dismiss button. It is not a snackbar with an undo.

Every toast in the design:

| Trigger | Message |
|---|---|
| Goals saved, new account | Welcome to FORJD! |
| Goals saved, returning | Goals updated |
| Preferences saved | Preferences updated |
| Profile saved | Profile updated |
| Sources saved | Connected sources updated |
| Provider connected / disconnected | {name} connected / {name} disconnected |
| Privacy settings saved | Privacy settings updated |
| Data export requested | Export requested — we will email you |
| Location allowed | Assigned to Alexandria |
| Pro purchased | Welcome to Pro! |
| Plan switched | Switched to {term} |
| Subscription cancelled | Subscription cancelled |
| Exercise favourited | Added to favourites |
| Set logged | Logged {kg} kg × {reps} |
| Added from library, live | {name} added to workout |
| Added from library, builder | {name} added to routine |
| Set order violated | Complete set {n} first / Untick later sets first |
| Workout cancelled | Workout cancelled |
| Run paused | Run paused |
| Run saved | Run saved · {km} km |
| Workout saved | Saved "{name}" to My workouts |
| Routine saved | Saved to My workouts |
| Program saved | blocked: Name it and assign at least one workout |
| Program followed | Following {name} |
| Workout or program deleted | Deleted "{name}" / Program deleted |
| History row removed | Removed "{name}" |
| Scan confirmed | Scan saved to history |
| Quiet hours | Edit quiet hours |
| Share target picked | Sharing to {target} / Image saved to Photos |

**Disclosure, not a second screen.** Two places hide detail behind a tap rather than a route:
the live workout's **"How to train this"** card (a four-goal load/reps/rest guide, collapsed by
default, chevron rotates 90° over 180ms) and Train's **"See all N"** row under each capped
list. Both keep their state local and fade the revealed block in with `fj-fade`.

**Two patterns worth copying:**

1. **Validation speaks in toasts, not disabled buttons.** "Save Program" is always tappable;
   tapping it with nothing assigned explains what is missing. Same for set ordering. The user
   is never left guessing why a control is dead.
2. **Destructive actions are immediate and announced.** Deleting a workout or a history row
   just does it and says so. If product wants undo, that is a **design change** — it needs a
   toast with an action, which this design does not have.

## Timers

| Timer | Period | Behaviour |
|---|---|---|
| splash | 1600ms once | `loading` → `welcome`; guarded so a manual navigation wins |
| session ticker | 1000ms | only advances on `live` / `rest` / `run`, and only when not paused |
| rest countdown | 1000ms | decrements to 0, then returns to `live` automatically |
| toast | 1900ms | auto-dismiss |
| provider connect | short busy state | `connBusy` holds the provider name |

In Flutter: one `Ticker` or a periodic timer per active session, cancelled in `dispose`, with
elapsed time **derived from a start timestamp**. The prototype's increment-per-tick approach
loses time when the app is backgrounded — acceptable in a browser, not in a gym.

## Animation

Four keyframes, all short. Nothing is decorative-only.

| Name | Spec | Where |
|---|---|---|
| `fj-fade` | `opacity 0→1, translateY 4px→0`, 250–300ms | every screen body and each Progress tab |
| `fj-pulse` | `opacity 1→.35→1` | live dot, 1.6s; watch dot, 1.2s |
| `fj-spin` | `rotate 360deg`, 0.8s linear infinite | splash spinner |
| `fj-grow` | `scaleX 0→1`, 0.8s ease-out | readiness rail on `home` |

Transitions: rest ring `stroke-dashoffset 1s linear` (matches the tick, so it sweeps rather
than steps); toggles `background .18s`; hover states `.15s`.

Screens fade **in place** — the prototype has no push transition because it has no navigator.
Use the platform default push in Flutter; do not rebuild the fade.

## Interaction states

| State | Treatment |
|---|---|
| primary button hover | `filter: brightness(1.07)` |
| any button active | `transform: scale(.985)` |
| list row hover | `rgba(255,255,255,.025)` |
| card hover (tappable) | border → `rgba(233,113,47,.40)` |
| destructive hover | `rgba(201,80,60,.18)` |
| selected option row | `rgba(233,113,47,.09)` fill + `rgba(233,113,47,.45)` border + accent check |
| selected plan card | `rgba(233,113,47,.10)` fill + accent border |
| selected chip | accent fill, `#101011` label |
| selected segment | `#232326` + `0 1px 3px rgba(0,0,0,.4)` |
| ticked set row | `rgba(121,185,138,.09)` fill + green border |
| toggle on | accent track, knob at `x: 21` |
| field error | `#B8422F` border + `#E05A3C` message below |
| disabled | **does not exist in this design.** Nothing is greyed out; see the toast pattern |

Hover states are mouse affordances from the prototype. Keep the *value* (they define the
pressed/highlighted colour) and map them to `InkWell` splash and highlight colours.

## Empty states

Only two are drawn. **Every list needs one** — write the missing ones with product.

| Screen | State |
|---|---|
| `library` | "No exercises match." — `400 13 #6E6E66`, 26px padding |
| `athlete` | private profile — a `shield` card, *"This profile is private"* / *"{name} keeps their profile private. Their leaderboard position stays public."*; the self-preview variant reads *"Your profile is private"* and adds an **Open Privacy Settings** button |
| `rest` | "All sets complete" / "Finish your workout" when no set is left |
| `train` | *missing* — no saved workouts |
| `workoutHistory` | *missing* — no sessions |
| `inbody` | *missing* — no scans |
| `notifsFeed` | *missing* — no notifications |
| `rank` | *missing* — location declined, so no leaderboard. The `location` copy promises this works: "You will not appear on any city leaderboard. Everything else in FORJD still works normally." Something must render |
| `progress` | *missing* — a new account has no history. This is the most visible gap: the tab is all charts |

## Error states

The design draws exactly one: sign-up field validation. Not drawn, and needed:

- **Network failure** on any save. `ApiFailure` exists in the codebase; nothing in the design
  shows it. Decide once — a toast, an inline message, or a retry row — and apply it everywhere.
- **Offline** during a session. The design's only acknowledgement is the `done` subtitle
  "logged offline, will sync when you are back online." There is no sync-pending indicator,
  no conflict UI, no failed-sync state.
- **Permission denied** — location has a "Not Now" path but no "denied in system settings"
  state; health providers have neither.
- **Scan extraction failure** — `inbody` assumes success. The confidence percentages on
  `inbodyConfirm` imply the model can be unsure; nothing covers "could not read this sheet".

## Accessibility

Not addressed in the prototype. Before shipping:

- **Tap targets** — several glyph-only controls are drawn at 34px or smaller. Minimum 44.
  Pad the hit box, do not grow the glyph (`ForjdBackButton` already does this).
- **Contrast** — the dim ramp is deliberately low. `#5C5C55` on `#101011` is roughly 3.2:1,
  below AA for body text. It is used for axis labels and legal copy, which is defensible; do
  not let it spread to anything a user must read.
- **Semantics** — the tick circle on a set row, the metric tooltips and the compare
  checkboxes all need labels and states.
- **Text scale** — every size in this design is fixed. Charts and the tab bar will break
  first at 200%.
- **Reduced motion** — the pulsing live dot and the spinner should respect it.
