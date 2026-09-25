# Lane 4 — API correctness (2026-09-25, at b1f006a)

### L4-1 — Logging a food has no idempotency and no double-tap guard
- **Severity:** high · **Where:** `apps/api/src/nutrition/nutrition.repository.ts:650-673` (`logEntry`, bare insert); `packages/contracts/src/nutrition.ts:174-184` (no client id); `apps/mobile/src/app/food/[id].tsx:101-106,253-259,416-422` (`onPrimary`, no submitting state)
- **Scenario:** a double tap on "Log" (or a retried request after a dropped response) creates two identical entries, doubling that food's calories and macros for the day. `saved-meals.tsx:118-131` already added a guard after a live device bug; sessions use a client id (`upsertSession`).
- **Suggested fix:** a submitting guard on the button; for retries, a client-generated id with `onConflictDoNothing`.

### L4-2 — Suggested targets can use a stale weight: ascending order + LIMIT keeps the oldest rows
- **Severity:** high · **Where:** `apps/api/src/health-data/health-data.repository.ts:117-128` (`ORDER BY startTime ASC … LIMIT`); `apps/api/src/nutrition/macro-suggestion.service.ts:27-43` (limit 1000, one year); `macro-suggestion.ts:60-68` (picks the newest of what came back)
- **Scenario:** more than 1,000 weight rows in a year (several sources) → the newest readings are cut off, and the "latest weight" behind BMR and the calorie target is months old, with no warning.
- **Suggested fix:** order descending for "latest N" reads (or an explicit order parameter); a test with more rows than the limit.

### L4-3 — Logging a saved meal reads each item's food one query at a time
- **Severity:** medium (speed) · **Where:** `apps/api/src/nutrition/nutrition.repository.ts:686-725`
- **Scenario:** an N-item meal costs N sequential cross-region round trips before the insert.
- **Suggested fix:** one `inArray(foods.id, …)` read, like `listServingsForFoods`.

## Unconfirmed
Program enrollment delete-then-insert visibility; whether `nutrition_log_entries.food_id` got its index (old audit); export does one read per template/session (fine for a rare call).

## Checked and clean
`upsertSession` idempotent and transactional; stats use the caller's IANA time zone; `LIMIT n+1` paging correct; body scan transactional (old H3); bounded health reads with a separate export read (old H4); AI consent (old C2); account deletion (old C1); leaderboard snapshot recompute-and-replace in one transaction, per-city isolation; health ingest and WHOOP webhook idempotent on (user, source, record); registration atomic with an email-collision check; waitlist `onConflictDoNothing`; migrations 0024-0027 additive.
