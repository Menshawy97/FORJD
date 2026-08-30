# MVP scope

The limited Android beta (roadmap week ~35) ships with:

```
ACCOUNT
  Signup/login, profile, goals, username, avatar

WORKOUTS
  Exercise library (licensed/open-source dataset, not hand-authored)
  Full body / Upper-Lower / PPL programs
  Custom workout building
  Custom exercise creation, favourites
  Live workout execution (offline-first)
  Workout history

PROGRAMS
  Program/week/day structure, enrollment, progression rules, versioning

HEALTH
  Health Connect: steps, HR, resting HR, HRV where available, sleep,
  weight, calories, workout import
  WHOOP: recovery, sleep, strain, workouts

BODY COMPOSITION
  InBody photo upload, vision extraction, mandatory user
  confirmation, historical measurements

NUTRITION
  Daily calorie and macro goals, food search, food logging across
  four meal slots, saved meals, custom foods
  (Auto-calculated goals ship degraded until InBody lands — see ADR-020)

ANALYTICS
  Weight / body fat / muscle trend, strength progression, training
  volume, sleep trend, basic recovery, weekly summary

INFRASTRUCTURE
  Auth (Supabase, behind AuthProvider), Postgres, offline sync,
  CI/CD, logging, feature flags
```

## Explicitly NOT in the beta

Social network, AI coach beyond simple explanations, Garmin/Oura/Fitbit,
leaderboards, an admin CMS, Apple Health, **and real billing** — the
subscription screens ship as UI with a plan flag and nothing gated or
charged (ADR-021); in-app purchase is Phase 10.

Each of these has a planned phase (see `docs/product/roadmap.md`) — deferring
them is sequencing, not cutting.

## Why this scope

Validate the core loop — connect health data, train, measure, analyze,
improve — with real strangers before building anything that only makes
sense once there's a user base (leaderboards need city density; social
needs a graph of real users; an AI coach is additive, not load-bearing
for the core value proposition in `docs/product/vision.md`).

### Nutrition, and why it moved

Nutrition was previously on the exclusion list above, on the argument that
it is additive rather than load-bearing. The 2026-08-30 design revision
overturned that, and the reason is placement rather than principle: the
design puts a "Nutrition Today" calorie card on the **Home dashboard**, as
the second card on the app's most-visited screen. A feature reachable only
from a settings menu can be deferred without the rest of the app noticing.
A card on Home cannot — building Home "as designed, minus one card" means
building Home twice, and that card is the feature's only entry point, so
deferring it defers the whole feature anyway.

It also fits the product thesis more comfortably than the old argument
allowed. FORJD's bet is one canonical model instead of three separate apps;
food is the third app most people in this audience already have open.

The full reasoning, including what is *not* being built (real billing, and
auto-calculated macro goals before InBody exists), is in
[ADR-020](../decisions/ADR-020-nutrition-in-mvp.md) and
[ADR-021](../decisions/ADR-021-subscription-ui-without-billing.md). The
build order is [`nutrition-plan.md`](nutrition-plan.md).
