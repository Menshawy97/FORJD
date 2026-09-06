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

## Real image export — done (2026-09-06), see ADR-028

**The user asked for Save Image / Instagram / More to actually work, on _both_ share screens.**
Both used to only show a toast.

This reversed a documented decision, so it got an ADR first, per CLAUDE.md's "add a new ADR
before overturning one" — `docs/decisions/ADR-028-real-share-card-export.md`.

- The open question this note originally raised — **do `react-native-view-shot` /
  `expo-media-library` run under Expo Go?** — was put to the user directly, including the actual
  cost (no new paid service; Android dev-client builds are free and local, iOS reuses the
  existing EAS/Codemagic TestFlight pipeline). The user chose to switch: `apps/mobile`'s
  day-to-day testing loop now uses a **development-client build**
  (`expo-dev-client`) rather than plain Expo Go — see `apps/mobile/AGENTS.md`.
- Both screens now go through one shared module, `src/media/share-capture.ts`: Save Image
  captures the card (`ViewShot`) and writes it to Photos via `expo-media-library`; Instagram and
  More both open the OS share sheet via `expo-sharing` rather than a platform-specific Instagram
  deep link (ADR-028 explains why that was rejected).
- **Still needs a physical-device walk** before this is fully closed — Jest cannot exercise real
  pixel capture, the Photos permission prompt, or the share sheet actually listing Instagram.

## The pattern worth remembering

Three of the four findings were the same failure: a control drawn faithfully from the design,
shipped without its behaviour, with a comment explaining that the behaviour was out of scope.
Each comment was honest, and each was invisible from the device — the athlete just sees a button.

When a slice deliberately ships a control without its behaviour, the control should look
unavailable, or the gap should land in `roadmap.md` where it will be read again. A truthful
comment in a `.tsx` file is not a record anyone finds before a user does.
