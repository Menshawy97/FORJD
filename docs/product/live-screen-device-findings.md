# Device findings — the live workout screen (2026-09-04)

Four things found by using the app on a physical iPhone, mid-Phase-3K. All four are now fixed
and merged. This records what they were, what was decided, and the one piece of work they left
behind — because three of the four were features the design specified that we shipped the
*shape* of without the behaviour, and that is a pattern worth being able to recognise again.

## What was wrong, and what fixed it

| Finding | Cause | PR |
|---|---|---|
| The numeric keypad covered the set row being edited | `live.tsx` scrolled in a plain `ScrollView` with no keyboard handling at all | [#104](https://github.com/Menshawy97/FORJD/pull/104) |
| The `KG` pill looked tappable and did nothing | The prototype wires it to `toggleUnit(e.name, m)`; Phase 3H shipped the pill without it | [#106](https://github.com/Menshawy97/FORJD/pull/106) |
| No per-exercise training-goal dropdown | The orange `STRENGTH ⌄` pill was drawn with its chevron and a comment saying the picker was "deliberately not in this slice" | [#107](https://github.com/Menshawy97/FORJD/pull/107) |
| Finishing a workout and sharing opened the **nutrition** cards | `workout-done.tsx` pushed `/nutrition-share`; no workout share screen existed | [#108](https://github.com/Menshawy97/FORJD/pull/108) |

Two CI fixes came out of the same stretch: [#105](https://github.com/Menshawy97/FORJD/pull/105)
made the API e2e suites run serially, after a `catalogueVersion` race went red twice on pull
requests that could not have caused it.

## Decisions taken with the user

- **A unit choice persists per exercise, forever.** The prototype forgets it when the session
  ends. Setting the bench to pounds once should not be a weekly chore, so it lives in
  AsyncStorage keyed by exercise **id** — not name, because a catalogue re-ingest renames rows
  and a preference that silently detached from its exercise is worse than one never set.
- **Storage stays metric regardless.** Kilograms and metres in the log, the contracts and the
  database (ADR-016). The chip changes rendering and how typed input is read, nothing else.
- **The workout share screen ships three layouts, not the design's six.** Heart Rate Zones needs
  a `HealthProvider`, Route & Splits needs GPS, and Personal Record needs the session compared
  against history. A share card is the one artefact that leaves the app and is seen by other
  people, which raises rather than lowers the bar on inventing anything on it.

## The one thing left: real image export

**The user asked for Save Image / Instagram / More to actually work, on _both_ share screens.**
Today both only show a toast.

This is not a small follow-up, and it reverses a documented decision, so it needs an ADR before
it is built:

- `nutrition-share.tsx`'s own docblock records the mock as **a deliberate scope reduction**
  ("real device capture/sharing is out of scope for this lowest-priority phase, not a bug to
  silently 'fix' by reaching for new native permissions"). Overturning that is exactly what
  CLAUDE.md means by "add a new ADR before overturning one".
- It needs `react-native-view-shot` (capture a view as an image), `expo-media-library` (write to
  Photos, plus `NSPhotoLibraryAddUsageDescription`) and `expo-sharing` (the share sheet).
- **The open question that must be answered first: do those run under Expo Go?** The app is
  developed and tested on Expo Go against a pinned SDK 54 (`apps/mobile/AGENTS.md`, ADR-013),
  and a module that forces a development build changes how this project is tested day to day.
  That is a decision for the user, not an assumption to make while installing.
- Whatever is built must cover **both** screens in one go. Leaving the nutrition one faking it
  while the workout one is real is the divergence this note exists to prevent.

## The pattern worth remembering

Three of the four findings were the same failure: a control drawn faithfully from the design,
shipped without its behaviour, with a comment explaining that the behaviour was out of scope.
Each comment was honest, and each was invisible from the device — the athlete just sees a button.

When a slice deliberately ships a control without its behaviour, the control should look
unavailable, or the gap should land in `roadmap.md` where it will be read again. A truthful
comment in a `.tsx` file is not a record anyone finds before a user does.
