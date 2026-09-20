# Phase 10N — the full athlete profile

Tapping an athlete on the Rank tab opens their profile. Until now that screen showed identity only
(name, @username, city); the stat tiles, records and sessions were left out because the data did
not exist (`docs/design/slice2-screen-specs.md` §11 Q4). Phase 10 built the data, so this slice
builds the rest of the design (`screenshots/public profile.png`, prototype `s_athlete()`).

## Decisions (asked and answered)

| Question | Decision |
|---|---|
| Which personal records? | The athlete's four heaviest lifts (best completed set per exercise, by weight), not a fixed Bench/Squat/Deadlift/5K. |
| Rank tile for someone not on the leaderboard? | Hidden. The rank, score and streak tiles show only for an athlete who is ranked this month; records and sessions still show. |
| Recent sessions? | The last three completed sessions: name, date and one figure (kilograms lifted, else the time). |

## API (additive, `/api/v1`, rule 7)

`GET /api/v1/athletes/:userId` gains three fields on `PublicProfileResponse`:

- `stats: { cityName, cityRank, score, streakWeeks, periodLabel } | null`
- `personalRecords: { exerciseName, weightKg }[]` (max 4)
- `recentSessions: { name, startedAt, volumeKg, durationSeconds }[]` (max 3)

Nothing about health data is in the response: no sleep, HRV, body composition or InBody, which is the
promise the screen's own footnote makes. The 404-for-private rule is unchanged, so a stranger cannot
tell a private profile from a missing one.

**Rank comes from the leaderboard itself.** `LeaderboardsService.standingFor(userId)` is the same
computation as the Rank tab (`get` with the athlete as the viewer), so consent is read live and a
profile can never show a rank the board would not: not joined, no city, no eligible session and a
city below five athletes all read as `stats: null`. The streak is dated in the ranked city's calendar.

Records, sessions and the streak are new read-only queries in `AthleteStatsRepository`, scoped to the
one athlete's completed, undeleted workouts. No migration.

## Mobile

`apps/mobile/src/app/athlete/[userId].tsx` draws the three tiles, the two lists and the footnote from
the response. Values transcribed from the prototype are listed in `features/athlete/athlete-sections.tsx`.
The prototype's retired faint grey is replaced by `label` (8H). An API that predates this slice answers
without the new fields, so the screen treats them as absent rather than crashing.

## Not in this slice

Avatar photos (the design shows initials), tapping a record or session, a stranger view of a private
profile (the API refuses by design), and any per-metric rank other than Activity.
