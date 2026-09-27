-- Custom migration (drizzle-kit --custom), per CLAUDE.md rule 14 -- committed here, never
-- hand-edited via Supabase Studio.
--
-- Switches Weekly Forge on (ADR-057). It shipped dark behind this flag (decision 11) while it was
-- built. On 2026-09-27 the user asked for it on in every environment: the app has not reached the
-- stores, so the only user is the owner. Doing it as a migration rather than a hand edit keeps the
-- switch versioned and applied the same way to local, staging and production by `db:migrate`.
--
-- To switch it off again, a new migration (or a data change) sets `enabled = false`; the feature's
-- routes answer 404 and the app hides it as soon as the flag reads false.

UPDATE "feature_flags" SET "enabled" = true WHERE "key" = 'weekly_forge';
