# ADR-056: Weeks start on Saturday, across the whole app

**Status:** Accepted (2026-09-27)
**Date:** 2026-09-27
**Amends:** ADR-047 decision 5 (a leaderboard week is labelled with the coming local Monday).

## Context

FORJD's first market is Egypt, where the working week runs Sunday to Thursday and the calendar week
is read as Saturday to Friday. When the Weekly Forge feature was planned (ADR-057), the user asked
for Forge weeks to follow the Egyptian calendar. They then chose to switch **every** weekly figure
in the app at the same time, rather than keep two different ideas of "a week" side by side.

Until now, every weekly figure assumed a Monday start:

- `weekStartOf` and `countWeekStreak` in `apps/api/src/workouts/calendar-utils.ts` (Home's This week
  strip, the week streak on Home and on the athlete profile);
- the weekly buckets in `apps/api/src/workouts/progress.repository.ts` and
  `apps/api/src/athletes/athlete-stats.repository.ts`;
- `snapshotWeekStart` in `apps/api/src/leaderboards/city-time.ts` and the Monday 00:20 UTC cron in
  `.github/workflows/leaderboard-snapshot.yml`;
- the day order on the phone: `features/home/this-week.tsx`, `features/home/date.ts`,
  `features/progress/training-calendar.tsx`, `features/progress/volume-bars.tsx`;
- contract doc strings and fixtures in `packages/contracts/src/{workouts,progress}.ts`, and the FAQ
  copy.

## Decision

1. **A week runs Saturday 00:00 to Friday 23:59:59 in the user's local time zone.** One constant,
   `WEEK_START_DOW = 6` (Saturday, JavaScript `getDay()` numbering), lives in `packages/domain`,
   and every server and phone calculation reads it. No second, Monday-based helper survives.
2. **Leaderboard snapshots are labelled with the coming local Saturday.** The half-day nudge in
   ADR-047 decision 5 is unchanged. The cron moves from Monday to **Saturday 00:20 UTC**:
   02:20 or 03:20 in Cairo, after the week there has closed. With the unchanged 12-hour nudge,
   every zone from UTC-12 to UTC+14 labels the run with the same Saturday, exactly as Monday 00:20
   did for Monday. (Friday 22:20 UTC was considered, so the run would land right at the Cairo
   close, but with a 12-hour nudge it would mislabel UTC-11 and UTC-12.)
3. **Old Monday-labelled snapshot rows are not rewritten.** The delta lookup already falls back to
   the latest earlier snapshot within two weeks, so the first Saturday after the switch compares
   against the last Monday row, or shows nothing. Snapshot rows are derived data (rule 9), and
   they age out naturally.
4. **The phone shows the week as S S M T W T F.** This changes the look of existing screens, so it
   is shown to the user as a before-and-after replica and approved before it is built.
5. **Calendar months are unchanged.** "This month" boards and monthly figures are unaffected.

## Consequences

- At the switch, a streak can gain or lose a week, because the week boundary moves by two days.
  This is accepted and is not back-corrected.
- The first leaderboard movement arrow after the switch may be blank.
- Progress's weekly buckets move by two days, so a chart spanning the switch has one short or long
  week.
- A future market with Monday weeks would need this constant to become a per-user preference. That
  is a new ADR, not a patch.
