-- Custom migration (drizzle-kit --custom), per CLAUDE.md rule 14 -- not hand-edited via
-- Supabase Studio, committed here the same way migration 0004 hand-wrote its backfill.
--
-- Two search paths for `exercises.name` that drizzle-kit's typed schema DSL cannot express
-- as generated columns/extensions: full-text search (server-side browse/search, Phase E) and
-- trigram similarity (fuzzy substring matching, e.g. a typo in an exercise name).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "exercises"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "name")) STORED;
--> statement-breakpoint

CREATE INDEX "exercises_search_vector_idx" ON "exercises" USING gin ("search_vector");
--> statement-breakpoint

CREATE INDEX "exercises_name_trgm_idx" ON "exercises" USING gin ("name" gin_trgm_ops);
