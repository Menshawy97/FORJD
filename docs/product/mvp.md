# MVP scope

The limited Android beta (roadmap week ~35) ships with:

```
ACCOUNT
  Signup/login, profile, goals

WORKOUTS
  Exercise library (licensed/open-source dataset, not hand-authored)
  Full body / Upper-Lower / PPL programs
  Custom workout building
  Live workout execution (offline-first)
  Workout history

PROGRAMS
  Program/week/day structure, enrollment, progression rules, versioning

HEALTH
  Health Connect: steps, HR, resting HR, HRV where available, sleep,
  weight, calories, workout import
  WHOOP: recovery, sleep, strain, workouts

BODY COMPOSITION
  InBody photo upload, Claude vision extraction, mandatory user
  confirmation, historical measurements

ANALYTICS
  Weight / body fat / muscle trend, strength progression, training
  volume, sleep trend, basic recovery, weekly summary

INFRASTRUCTURE
  Auth (Supabase, behind AuthProvider), Postgres, offline sync,
  CI/CD, logging, feature flags
```

## Explicitly NOT in the beta

Social network, nutrition tracking, AI coach beyond simple explanations,
Garmin/Oura/Fitbit, leaderboards, subscriptions, an admin CMS, Apple Health.
Each of these has a planned phase (see `docs/product/roadmap.md`) — deferring
them is sequencing, not cutting.

## Why this scope

Validate the core loop — connect health data, train, measure, analyze,
improve — with real strangers before building anything that only makes
sense once there's a user base (leaderboards need city density; social
needs a graph of real users; nutrition and an AI coach are additive, not
load-bearing for the core value proposition in `docs/product/vision.md`).
