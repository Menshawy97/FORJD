# ADR-054: A city board's totals are reused for 15 seconds; membership is still read live

**Status:** Accepted
**Date:** 2026-09-26
**Amends:** ADR-047 decision 2

## Context

ADR-047 computes standings on read and rejected a TTL cache, because a cache of the computed board
"would hold user ids whose opt-in may have been withdrawn seconds ago: a privacy window, not just
staleness". It asked for a revisit when the aggregate became expensive.

The 2026-09-25 whole-app review (findings L9a-2 and L9a-3) found two costs that make the read path
expensive in practice. Every public-profile view recomputed its city's whole month board to show one
rank (`standingFor`), so scrolling through a board and opening profiles recomputed the same city
over and over. The all-time board re-aggregates the city's entire history on every request.

## Decision

1. **The totals are reused for 15 seconds per server instance.** `LeaderboardsService` keeps each
   `cityAthletes` result in memory, keyed by city and window (the month's start, or all time), for
   `CITY_BOARD_TTL_MS` = 15 s. `get` and `standingFor` share it. A failed read is not kept.
2. **Who is on the board, and how they are shown, is never reused.** Every request calls
   `LeaderboardsRepository.currentMembers` with the reused board's athlete ids. It is a lookup by id
   on `privacy_settings` and `profiles`, and it returns only the athletes whose leaderboard opt-in
   and location permission are on right now, with their current name, username, photo and
   public-profile flag. Anyone not returned is dropped before ranking. ADR-047's guarantee is
   therefore unchanged: a withdrawal, a rename or a switch to private is true on the very next
   request.
3. **The viewer is never told they have no sessions because of the reuse.** When the viewer is
   missing from a reused board (a first workout just finished, or they just joined), their own
   board request recomputes it. A profile view does not, so opening the profile of an athlete who
   has no board this month cannot force a recompute every time.
4. **What can lag is only the numbers.** A workout just finished can take up to 15 s to move its
   athlete's score and rank on other people's boards. Joining is included when the board is next
   computed.
5. The weekly snapshot job (ADR-047 decision 3) still reads the repository directly and never
   uses the reused totals.

## Consequences

- A profile view costs one lookup by id plus, at most once per 15 s per city, the aggregate.
- The reuse is per Cloud Run instance, so two instances may briefly show numbers up to 15 s apart.
  Membership is still read live on both.
- Memory is one entry per city and window that has been viewed. That is bounded by the city list.
  An entry is replaced on the first read after it expires.
