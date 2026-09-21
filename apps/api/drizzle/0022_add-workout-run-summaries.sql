CREATE TABLE "workout_run_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"split_index" integer NOT NULL,
	"distance_meters" numeric(10, 2) NOT NULL,
	"duration_seconds" integer NOT NULL,
	"avg_heart_rate_bpm" integer
);
--> statement-breakpoint
CREATE TABLE "workout_run_summaries" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"distance_meters" numeric(10, 2) NOT NULL,
	"moving_seconds" integer NOT NULL,
	"elevation_gain_meters" numeric(7, 1),
	"avg_heart_rate_bpm" integer,
	"calories_kcal" integer,
	"calories_source" text
);
--> statement-breakpoint
ALTER TABLE "workout_run_splits" ADD CONSTRAINT "workout_run_splits_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_run_summaries" ADD CONSTRAINT "workout_run_summaries_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_run_splits_session_index_key" ON "workout_run_splits" USING btree ("session_id","split_index");