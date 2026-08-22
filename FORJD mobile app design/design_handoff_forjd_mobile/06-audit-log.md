# Audit log

The prototype was walked end to end before this handoff was written: every screen rendered,
every tappable element clicked, state inspected after each click. What follows is what that
found and what was changed. It is here because a design file that lies about behaviour costs
more than one that says nothing.

## Method

- **41 route keys** rendered and inspected for console errors and React warnings.
- **2,643 simulated taps** — every element with `cursor: pointer` on every screen, each from a
  freshly reset state, with the state object diffed before and after.
- Static passes for: unreachable methods, unused helpers, unused icons, unused CSS keyframes,
  state keys never read, state keys never written, template holes with no provider, and
  `cursor: pointer` elements with no handler.

**Result: 0 console errors, 0 React warnings, 0 render failures, 0 template holes without a
provider, 0 unreachable helpers.**

Of the 2,643 taps, 58 left state unchanged. All were checked individually and all are
legitimate no-ops: re-selecting an already-active chip or segment, a label `<span>` nested
inside its own tappable parent (counted twice by the crawler), and adjustments already at
their clamp.

## Bugs found and fixed

**1. Crash on a program with no metadata.** `programByName` called `p.meta.match(...)`
unguarded, so customising a user-created program — which has no `meta` — threw. Guarded, with
a name fallback.

**2. Wrong back target from the program builder.** Opening the builder from a program overview
never set `programBuilderReturnTo`, so back fell through to `train` and silently discarded the
context the user came from. Now set at the call site.

**3. Wrong back target from the InBody import.** The "Import InBody Scan" row on the Progress →
Body tab reused the profile's handler, which sets `inbodyReturnTo: 'profile'`. Backing out of
InBody dropped the user on Profile instead of the tab they came from. Split into two handlers.

**4. Privacy Settings landed on the wrong tab.** Profile → Privacy Settings opened the
`location` screen, whose back button and tab bar were hard-coded to Rank — so a settings trip
ended in a different tab. Added `locationReturnTo`; the screen now returns to its origin and
lights the right tab.

**5. Workout history deleted the wrong row.** Deletions were tracked in a `Set` of indices
against a list that had already been re-indexed by the filter, so the second delete removed a
different row than the one tapped — and a `Set` in state is not serialisable. Now an array of
original indices. Verified: two deletes remove exactly the two rows tapped (12 → 11 → 10).

**6. The rest timer lied.** "Up next" was hard-coded to "Bench Press · 82.5 kg × 6" no matter
what the session actually contained or how far through it you were. Now derived from the first
incomplete set, with an "All sets complete" state for the last rest of a session.

**7. Ten state keys were created on the fly.** `shareKind` `shareLayout` `stepRange`
`programBuilderReturnTo` `signupErrMsg` `deletedHistory` `selectedHistory` `selectedScan`
`proPlan` `units` were never declared in initial state and were read through
`|| default` fallbacks scattered at each use — the same default written three different ways
in two places. All declared once; the fallbacks removed.

**8. The exercise library opened pre-filtered.** `libFilter` defaulted to `Running`, so the
library appeared to contain one exercise. Now `All`. *(Flagged as an open question in the
README in case it was deliberate.)*

## Dead code removed

- **Seven unreachable screen methods.** `welcome`, `home`, `progress` (and its two tab
  aliases), `rank`, `live` and `profile` had been rebuilt as template markup, but the old
  `s_*` implementations were still in the logic class and still wired into the router map —
  they could never run. ~250 lines.
- **The `programs` route** — an earlier version of what is now `catalog` +
  `programOverview`. Removed with its method, its router entry, its sidebar entry and its
  caption.
- **`seg()`** — a segmented-control helper superseded by the template's own; zero callers.
- **Two unused icon-map entries** (`bell`, `chart`). Both glyphs are still in the design —
  they are drawn inline in the template — but the map entries had no callers.
- **Two dead state keys** (`prog`, `builder`) and one dead flow flag (`inbodyStep`), all
  written once at init and never read.
- **Four unused render exports** (`goLive`, `goExercise`, `goBrand`, `goRun`) — zero
  template references.
- **An always-`null` parameter** threaded through both mark builders on the `brand` screen.

## Deliberately left alone

- **Hand-drawn SVG charts.** The shapes are the spec. Flutter should use a chart library or
  `CustomPainter`; the series are fixtures.
- **The placeholder run map and InBody drop zone.** Striped fills with monospace captions
  naming what belongs there — that is the correct way for a design to say "real asset needed"
  rather than inventing one.
- **Hover states.** Mouse affordances that exist only because the prototype runs in a browser.
  Their *values* matter (pressed and highlighted colours); the trigger does not.
- **The `brand` screen.** Not product UI. Kept in the prototype for the founder, marked
  do-not-implement in the README.
- **The atmosphere tweak** (`midnight` / `ember` / `verdant`). A designer control, not a
  product setting. Default is `ember`; ship one value.

## Known gaps, not fixed

These are design work, not bugs — listed so they are not discovered late:

- **Eight missing empty states**, including Progress on a new account. See
  `05-interactions.md`.
- **No network, offline-sync, or permission-denied error states** anywhere except sign-up
  validation.
- **Three missing icons** — `calendar`, `eye`, `pencil`.
- **Accessibility** — untested. Tap targets, contrast on the dim ramp, semantics and text
  scale all need a pass.
- **Est. 1RM has no formula.** The number is displayed on two screens and computed nowhere.

---

## Review round 2 — changes from design review

Seven review comments, all applied and re-crawled: **609 further simulated taps, 0 console
errors, 0 React warnings**. The only no-op targets left are the active tab-bar item and the
already-selected segment.

**1. Train caps its lists.** *My programs* and *My workouts* each show a maximum of **3** rows
with a *See all N* row beneath; tapping expands in place and the row becomes *Show less*.
A cap rather than a separate list screen because Train is a launchpad — a user with ten
workouts should still reach *Previous workout* and the quick actions without scrolling past
everything they own. If the list routinely runs long, promote it to its own route;
`workoutHistory` is the pattern to copy.

**2. The live workout carries a training guide.** A collapsed card — *"How to train this —
load, reps and rest by goal"* — sits above the exercise cards and opens to four rows:

| Goal | Load | Reps | Rest | Execution | Advice |
|---|---|---|---|---|---|
| Strength | 80–95% 1RM | 1–5 | 3–5 min | Controlled down, aggressive press | Move heavy weight with excellent technique |
| Hypertrophy | 60–80% 1RM | 6–15 | 1.5–3 min | Controlled eccentric, full range | Maximise muscle tension and train close to failure |
| Power | 30–70% 1RM | 2–5 | 2–4 min | Explosive concentric | Move the bar as fast as possible |
| Muscular endurance | 40–60% 1RM | 12–25+ | 30–90 s | Controlled, steady tempo | Hold form while fatigue accumulates |

Static reference copy, not per-exercise advice. If it should key off the *current exercise's*
goal, that is a data question first — exercises have no goal field yet.

**3. InBody removed from Connected Sources.** `connect` now lists three providers, the profile
row's subtitle reads "Apple Health, WHOOP, Health Connect", and `conn` lost its `InBody` key.
InBody was never an API integration — scans arrive as a photo through Progress → Body →
Import, which is unchanged.

**4. Privacy Settings is a real screen.** Profile → Privacy Settings used to open the
location-permission screen. It now opens `privacy`: five toggles — appear on city leaderboards,
use approximate location, AI insights, public profile (default **off**), crash diagnostics —
plus a *Location permission* row (which pushes the old screen and returns here) and a
*Download my data* row. **Save** → *"Privacy settings updated"*.

**5. Train's quick actions are compact.** *Start a run* and *Exercise library* went from 76px
stacked tiles to **42px** rows, icon left of a single-line label.

**6. New `runner` glyph.** The run tile used `pin` (location). It now uses a purpose-drawn
runner in the same 24 × 24 / 1.6px-stroke idiom.

**7. Progress tab renamed Recovery → Health.** Label, segmented control and rail entry all
read **Health**; the route key stays `progressRec`. The reconciler that syncs `progTab` to the
screen key was still forcing the old value — caught in re-testing, and it blanked the tab body
until fixed. Worth noting as exactly the bug class a real router does not have.
