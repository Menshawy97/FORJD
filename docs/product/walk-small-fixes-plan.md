# Emulator walk: the small visible fixes

Owner decisions 2026-10-14 on findings 5, 6, 7, 8, 13, 18, 19 and 22 of `docs/reviews/2026-10-14-emulator-walk.md`.
One combined replica was shown in the session (this file is the record).

## Approved, slice 1 (layout and numbers)

- **5, set table header:** the live workout's set-number column is 24 px wide (was 16), header and rows alike, so
  "SET" stays on one line.
- **6, workout page targets:** a program exercise with no target shows what the workout will lay out, "3×10 reps"
  (the live workout's default of 10 reps, `workouts/start-session.ts`), not "3×—". Time and distance targets unchanged.
- **18, previous workout chip:** a distance chip reads in the app's distance style and the person's unit,
  "Outdoor Run 0.19 km" (or miles), not "193.56m". Timed chips keep "45s".
- **19, run calories note:** when Calories shows no value (no estimate, e.g. no weight on the account), the note is
  "Watch calories are turned off for FORJD in Health Connect." without "so this run uses an estimate". With an
  estimate shown, it stays as it is.
- **22, Health Connect card on Connect:** subtitle "Heart rate and calories for your runs", status "Used by runs"
  instead of "Coming soon". Still not tappable. Apple Health stays "Coming soon".

## Approved, slice 2 (the word "AI")

- **8:** FORJD's insights are rules-based (`packages/domain/src/progress-insight.ts`); the only AI is reading an
  InBody sheet (`apps/api/src/body/body.service.ts`, gated by `aiFeaturesConsent`).
  - Welcome: "FORJD Insight · City Leaderboards · Analytics" (owner's wording).
  - Privacy switch: "AI scan reading", subtitle "Read your InBody sheet with an AI model when you scan one." Its
    note and the scan screen's consent message name it the same way. The stored field is unchanged.

## Not now

- **7** ("logged offline, will sync..." under Session/Run complete): owner left it as it is.

## Approved, slice 3 (finding 13, workout summary)

Replica approved 2026-10-14 (it replaced the earlier "muscles only, no counts" answer once it turned out the sets are
already on the phone: Train's Previous workout card holds the full session).

- **Muscles worked** counts completed sets from History too: Train's summary handoff passes the session's per-exercise
  completed set counts, as `live.tsx` does. Nothing extra is downloaded.
- **A new Exercises list** under Muscles worked on every summary: each exercise with completed sets, "3 × 40 kg"
  (the share card's line: completed sets × the first completed set's value; "3 × 45 s", "1 × 0.80 km"). Exercises with
  nothing ticked are left out.
