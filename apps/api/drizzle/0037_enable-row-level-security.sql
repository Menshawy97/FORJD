-- Custom migration (drizzle-kit --custom), per CLAUDE.md rule 14 -- committed here, never
-- hand-edited via Supabase Studio.
--
-- Enables row-level security, deny-all (no policies), on every table (ADR-038 amendment).
--
-- Why: Supabase exposes the `public` schema through its Data API (PostgREST). Anyone holding the
-- project's anon key -- a public-by-design key -- could read and write any table that has RLS off,
-- including health observations, OAuth connections and push tokens. With RLS on and no policy,
-- the `anon` and `authenticated` roles see nothing.
--
-- Why this cannot break the API: it connects as `postgres`, which owns these tables and has
-- BYPASSRLS, so it ignores RLS entirely (checked against the role catalogue on forjd-prod). No
-- FORCE ROW LEVEL SECURITY, deliberately, so the owner keeps bypassing.
--
-- Authorization is still the NestJS guards (rule 12); this is the SQL backstop. Real policies are
-- written only if a client is ever given direct database access. Idempotent: audit_logs and
-- exercise_favourites already have RLS on in dev, where it was switched on by hand.
-- scripts/ci/check-architecture-conformance.sh now fails any table created without a line here.

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "body_scans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "device_push_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exercise_favourites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exercises" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "external_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feature_flags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "food_servings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "foods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forge_ladders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forge_rewards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forge_tiers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forge_user_ladders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forge_week_acks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forge_weeks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "health_observations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leaderboard_rank_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "macro_goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "nutrition_log_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "privacy_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "program_enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "program_workouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "push_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "push_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "saved_meal_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "saved_meals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "waitlist_signups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_blocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_exercises" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_run_splits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_run_summaries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_session_exercises" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workout_templates" ENABLE ROW LEVEL SECURITY;
