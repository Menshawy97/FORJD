# Lane 9b — App speed (8.5E re-run, 2026-09-26, at 445fcf0)

## Previous findings

| ID | Claim | Status | Evidence |
|---|---|---|---|
| L9b-1 | Progress loaded its four sections one after another | **Fixed (S5)** | `app/(tabs)/progress.tsx:58-75`: one `Promise.allSettled` for strength, body, health and readiness, guarded by a load generation; `progress-parallel-load.test.tsx` asserts all four start before any resolves |
| L9b-2 | Train's previous-workout card read each exercise from SQLite one at a time | **Fixed (S5)** | `app/(tabs)/train.tsx:79-101`: `Promise.all` over `getCachedExercise` |
| L9b-3 | `getMe()` fetched separately by the root layout, Home and Profile | **Fixed (S5)** | `auth/apiClient.ts:208-233`: one in-flight request shared per access token, so a request from one account never answers another; covered by `apiClient.test.ts` |
| L9b-4 | Tabs refetch everything on every focus | **Closed by the user** (2026-09-26); not re-reported |
| L9b-5 | Train's "My programs" loaded once, never refreshed | **Fixed (S5)** | `app/(tabs)/train.tsx:179-202`: loaded on focus, both reads in parallel, each with its own fallback; `train-programs.test.tsx` |

Also checked: **S3 foods cache** (`app/nutrition.tsx:125-160` keeps known foods across focus reloads; fixed) and **S10 lazy Health Connect load** (`integrations/health/device-health-provider.ts:18-26`; fixed, still behind `HealthProvider`).

## New findings

**None** at any severity. Nothing in `b1f006a..445fcf0` (24 commits, 65 mobile files) adds a sequential-await waterfall, an N+1 from the app, blocking start-up work, or network in a live session's critical path:
- Root and tabs layouts: no start-up changes (only the S8 `maxFontSizeMultiplier` on tab labels).
- Home: S1's `getAccountId()` starts alongside the `Promise.allSettled` batch and is awaited after it; no added wall-clock time.
- Live workout and run: S1's `getAccountId()` around queue and snapshot writes resolves from an in-memory cache after the first read (`auth/secureStorage.ts:77-86`); rule 6 holds (local SQLite and a cached JWT decode only).
- `run-health.ts` (S10): per-metric gating adds no requests.
- `food/[id].tsx` (S3): `useSingleFlight` prevents a duplicate write and adds no I/O.
- Spot-checks outside the diff (`workout/[id].tsx`, `program/[id].tsx`) already load in parallel; the one sequential step in `program/[id].tsx` is a real data dependency.

## Unconfirmed
- The screen and cold-start budgets have not been timed on a physical device (as in the first run).
- `live.tsx`'s 1 Hz re-render cost, unverified (unchanged path).
- Bundle size not re-measured; only patch-level Expo updates were added (S11).

## Checked and clean
`getMe` in-flight sharing is scoped by access token; Home's account-scoped consent write does not serialise ahead of the data batch; `useSingleFlight` is ref-gated, so a same-frame double tap is blocked; the lazy-require idiom matches the sibling adapters.

**Not reached** (untouched by 8.5D): `live.tsx` in full, `run.tsx`, InBody and scan detail screens, settings screens beyond edit-profile and goals, a bundle re-export.
