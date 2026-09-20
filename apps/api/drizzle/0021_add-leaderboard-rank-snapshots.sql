CREATE TABLE "leaderboard_rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"city_slug" text NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"week_start" date NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(5, 1) NOT NULL,
	"cohort_size" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_rank_snapshots" ADD CONSTRAINT "leaderboard_rank_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_rank_snapshots_key" ON "leaderboard_rank_snapshots" USING btree ("user_id","city_slug","metric","period","week_start");--> statement-breakpoint
CREATE INDEX "leaderboard_rank_snapshots_lookup" ON "leaderboard_rank_snapshots" USING btree ("city_slug","metric","period","week_start");