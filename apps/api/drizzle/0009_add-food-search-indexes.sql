-- Custom migration (drizzle-kit --custom), per CLAUDE.md rule 14 -- not hand-edited via
-- Supabase Studio, mirroring exercises' own 0006_add-exercise-search-indexes.sql exactly.
--
-- Two search paths for `foods.name` that drizzle-kit's typed schema DSL cannot express as
-- generated columns/extensions: full-text search (server-side food search, Phase D) and
-- trigram similarity (fuzzy substring matching while the user is still typing).
--
-- pg_trgm is already created by migration 0006 (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) --
-- restated here with IF NOT EXISTS anyway, so this migration is self-contained and does not
-- depend on 0006 having run in a particular database, the same defensive habit as any
-- `CREATE ... IF NOT EXISTS`.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "foods"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "name")) STORED;
--> statement-breakpoint

CREATE INDEX "foods_search_vector_idx" ON "foods" USING gin ("search_vector");
--> statement-breakpoint

CREATE INDEX "foods_name_trgm_idx" ON "foods" USING gin ("name" gin_trgm_ops);
