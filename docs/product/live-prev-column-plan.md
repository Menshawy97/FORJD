# Live workout: the PREV column

Owner request 2026-10-14 (seen on the emulator walk: "the prev should load, why is it empty?"). PREV in the live
workout's set rows has always been a hard-coded "—" (`workouts/live-exercise-card.tsx`): nothing ever read the history.
Replica **approved as shown** on 2026-10-14 (shown in the session; this file is the record).

## Owner decisions (2026-10-14)

- **What PREV shows:** the same set from last time. Set 1 shows set 1 of the last session with this exercise,
  e.g. "40 × 10". A set with no match last time shows "—".
- **Which session is "last time":** the most recent session that has this exercise, in any workout or program.
- **Sets start filled in:** each of today's sets starts with last time's weight and reps (or time, or distance). The
  person changes them as usual; nothing counts until the set is ticked. A set with no match keeps the workout's own
  target, as today.
- **Offline:** remembered on the phone, so PREV and the fill work without signal once the phone has seen the
  exercise. A never-seen exercise with no signal shows "—", as today.

## Rules

- Only **completed** sets from last time count, in the order they were done (a skipped set does not leave a gap).
- PREV is shown in the exercise's display unit (kg or lb, km or mi), the same way the set row shows its values.
  Weight: "40 × 10". Weight with no reps: "40 kg". Time: "0:45". Distance: "400 m" / "1.2 km".
- The fill touches only a set that is still exactly as the workout laid it out (not ticked, not edited). A set
  the person has already typed into is never overwritten, even if the history arrives late.
- The fill happens once per exercise per workout, including an exercise added mid-workout. A workout picked back up
  after the app closed is not filled again (its values are already the person's).
- Rule 6: the workout never waits on this. The phone's memory is read first; the server is asked in the background
  and only updates the memory and the display.

## Data

- **Server, unchanged:** `GET /workouts/sessions/exercise/:id?limit=1` gives the latest session with the exercise;
  `GET /workouts/sessions/:id` gives its sets. Two calls per exercise, only when the server's latest is newer than what
  the phone remembers.
- **Phone memory:** a `previous_sets` table in the workout-log database (`store/previous-sets.ts`, a versioned
  migration), one row per account and exercise: when it was performed and the completed sets as JSON. Another account
  on the same phone never sees it.
- **Kept current on Finish:** finishing a workout writes its completed sets into the memory straight away, so the next
  workout has them even before the upload. Dated by the workout's **start**, which is how the server's history dates a
  session, so "newer" always compares like with like (review finding).

## Build (test-first, one PR)

1. `workouts/previous-sets.ts` (pure): completed sets of one exercise from a session response or an upload request;
   the PREV label; the fill (`prefillFromPrevious`) with its "untouched" rule.
2. `store/previous-sets.ts`: the migration, read and write.
3. `workouts/load-previous-sets.ts`: memory first, then the server; never throws. `rememberFinishedWorkout`.
4. `live-exercise-card.tsx` takes `previous` and renders it; `app/live.tsx` loads it and applies the fill once per
   exercise.
5. Tests for each, plus the screen: PREV shows, sets start filled, an edited set is not overwritten, offline uses the
   memory, a first-time exercise stays "—".
