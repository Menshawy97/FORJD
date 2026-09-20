# ADR-046: The Activity score behind the city leaderboard

**Status:** Accepted
**Date:** 2026-09-21

## Context

The leaderboard needs one number per athlete that can be compared inside a city. The design shows a
score out of 100 with one decimal ("92.7"). The score must be hard to fake, must use what the app
already records, and must not claim more than it can support. The user chose to count weight lifted,
running distance and time, measured against published targets, and to leave self-rated effort out.

## Decision

**This is an in-app participation metric, not a fitness assessment.** It says nothing about health,
recovery or what anyone should do next, so it needs no evidence base beyond the published targets it
measures against. It is a plain calculation and is never called AI or an insight (ADR-030).

The score has two layers, 100 points in all (`packages/domain/src/leaderboard-scoring.ts`).

1. **WHO adherence, 0 to 70, absolute.** Measured against the World Health Organization's 2020
   guidelines (Bull et al., Br J Sports Med 2020;54:1451-1462): 150 to 300 minutes of activity a
   week, and muscle-strengthening on two or more days a week. Over a window of `W` weeks:
   - aerobic, up to 40: `40 x min(1, minutes / (150 W))`
   - aerobic bonus, up to 10: the extra credit for going from 150 to 300 minutes a week
   - strength, up to 20: `20 x min(1, strengthDays / (2 W))`

   It is absolute, so it means the same thing in a city of six athletes and a city of six thousand.
   The app records no intensity, so any logged working time stands in for WHO's moderate-intensity
   minutes, and time spent lifting counts on the aerobic axis as well as the strength one. That is an
   approximation, stated here, not a clinical claim.
2. **Work done, 0 to 30, relative.** Kilograms lifted (weight x reps over completed sets), kilometres
   covered and hours worked are each percentile-ranked inside the city and the athlete takes their
   best of the three. No exchange rate between kilograms and kilometres is invented, so a runner and
   a lifter are both scored on what they actually do. A modality that fewer than five athletes did
   scores nothing for anyone, which stops a token effort in a rare modality collecting most of the
   points.

**Inputs are limited to what cannot be typed in.** Only workouts run through the live runner count
(ADR-044), only for athletes who joined the leaderboard and allowed location, and each session counts
for at most two hours. Self-rated effort is the best-validated training-load measure (Foster et al.,
J Strength Cond Res 2001;15(1):109-115) but it is self-reported, so on a competitive board anyone
could mark every session "brutal" and climb. It is considered and rejected for ranking, and stays
available for the Progress tab.

**Ranking is a total order.** Score, then strength days, then working minutes, then the earlier first
session, then user id, so the design's contiguous window (44, 45, 46, 47) always has distinct ranks.
The score is rounded half up to one decimal. "Top N%" is `max(1, ceil(100 rank / cohort))`.

**A board needs five athletes** (`MIN_COHORT_SIZE`). Below that a city shows an honest empty state
with the real head-count rather than a meaningless score.

**The windows.** "This month" is the calendar month in the city's own time zone, so everyone on a board
is scored over one interval; "All time" scales each athlete's targets by their own weeks since their
first eligible session.

## Consequences

- The weights are a product judgement anchored to the WHO targets, not a scientific claim. Changing
  them changes everyone's score, so it is an ADR-level change.
- Strength, Running and HYROX chips exist but return `coming_soon`; a number cannot be shown for them.
- The score rewards volume within a window. It does not measure how hard a session was, and the app
  says so (the Data sources page, and the wording above).
