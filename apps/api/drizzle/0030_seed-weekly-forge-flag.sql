-- Custom migration (drizzle-kit --custom), per CLAUDE.md rule 14 -- committed here, never
-- hand-edited via Supabase Studio.
--
-- Weekly Forge ships dark (ADR-057 decision 11): the flag exists from the first deploy and starts
-- switched OFF. Turning it on is a data change (`update feature_flags set enabled = true`), not a
-- deploy. `on conflict do nothing` keeps a flag someone has already switched on from being turned
-- back off if this migration is ever replayed against a database that has the row.

INSERT INTO "feature_flags" ("key", "enabled", "description")
VALUES ('weekly_forge', false, 'Weekly Forge progression ladders (ADR-057)')
ON CONFLICT ("key") DO NOTHING;
