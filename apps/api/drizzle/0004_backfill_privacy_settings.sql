-- Gives every account that predates privacy_settings an all-off row, so the settings screen
-- reads the same for an existing user as for a new one. 0003 creates the table; only new
-- registrations get a row from the application, which would leave every existing account
-- without consent state.
--
-- Written by `drizzle-kit generate --custom`, not by hand-editing a generated file and not
-- through the Supabase Studio UI — CLAUDE.md rule 14 forbids those two, not a custom
-- migration that drizzle-kit itself records in its journal.
--
-- The defaults do the work: naming only user_id means every flag lands on its column
-- default of false. Spelling the flags out here would create a second place where the
-- opt-in decision is stated, free to drift from the schema.
--
-- ON CONFLICT names its target explicitly. Bare `ON CONFLICT DO NOTHING` would behave
-- identically today, because user_id is the table's only unique constraint — but it would
-- also silently start swallowing violations of any unique constraint added later, which is
-- not what this backfill means. Naming the column keeps it a statement about the primary key.
--
-- That also makes this idempotent: safe to re-run against a database where 0003 has already
-- landed and new registrations have begun inserting their own rows.
INSERT INTO privacy_settings (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
