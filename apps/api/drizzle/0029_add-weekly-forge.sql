CREATE TABLE "forge_ladders" (
	"key" text PRIMARY KEY NOT NULL,
	"unit" text NOT NULL,
	"max_band" text NOT NULL,
	"is_public" boolean NOT NULL,
	"sort_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ladder_key" text NOT NULL,
	"type" text NOT NULL,
	"level" integer NOT NULL,
	"band" text NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge_tiers" (
	"ladder_key" text NOT NULL,
	"level" integer NOT NULL,
	"band" text NOT NULL,
	"target" numeric(10, 2) NOT NULL,
	CONSTRAINT "forge_tiers_ladder_key_level_pk" PRIMARY KEY("ladder_key","level")
);
--> statement-breakpoint
CREATE TABLE "forge_user_ladders" (
	"user_id" uuid NOT NULL,
	"ladder_key" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"best_level" integer DEFAULT 1 NOT NULL,
	"miss_streak" integer DEFAULT 0 NOT NULL,
	"tempered_hold_weeks" integer DEFAULT 0 NOT NULL,
	"forged_streak" integer DEFAULT 0 NOT NULL,
	"best_forged_streak" integer DEFAULT 0 NOT NULL,
	"enrolled_week" date NOT NULL,
	"last_evaluated_week" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forge_user_ladders_user_id_ladder_key_pk" PRIMARY KEY("user_id","ladder_key"),
	CONSTRAINT "forge_user_ladders_levels" CHECK ("forge_user_ladders"."level" >= 1 and "forge_user_ladders"."best_level" >= "forge_user_ladders"."level"),
	CONSTRAINT "forge_user_ladders_streaks" CHECK ("forge_user_ladders"."miss_streak" >= 0 and "forge_user_ladders"."tempered_hold_weeks" >= 0 and "forge_user_ladders"."forged_streak" >= 0 and "forge_user_ladders"."best_forged_streak" >= "forge_user_ladders"."forged_streak")
);
--> statement-breakpoint
CREATE TABLE "forge_week_acks" (
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forge_week_acks_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "forge_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ladder_key" text NOT NULL,
	"week_start" date NOT NULL,
	"time_zone" text NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"target" numeric(10, 2) NOT NULL,
	"level_before" integer NOT NULL,
	"level_after" integer NOT NULL,
	"band_before" text NOT NULL,
	"band_after" text NOT NULL,
	"outcome" text NOT NULL,
	"miss_streak_after" integer NOT NULL,
	"tempered_hold_weeks_after" integer NOT NULL,
	"forged_streak_after" integer NOT NULL,
	"rules_version" integer NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge_rewards" ADD CONSTRAINT "forge_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_tiers" ADD CONSTRAINT "forge_tiers_ladder_key_forge_ladders_key_fk" FOREIGN KEY ("ladder_key") REFERENCES "public"."forge_ladders"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_user_ladders" ADD CONSTRAINT "forge_user_ladders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_week_acks" ADD CONSTRAINT "forge_week_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge_weeks" ADD CONSTRAINT "forge_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forge_rewards_user_idx" ON "forge_rewards" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forge_rewards_mark_key" ON "forge_rewards" USING btree ("user_id","ladder_key","level") WHERE "forge_rewards"."type" = 'forge_mark';--> statement-breakpoint
CREATE UNIQUE INDEX "forge_rewards_badge_key" ON "forge_rewards" USING btree ("user_id","ladder_key","band") WHERE "forge_rewards"."type" = 'band_badge';--> statement-breakpoint
CREATE UNIQUE INDEX "forge_rewards_forged_key" ON "forge_rewards" USING btree ("user_id","ladder_key","week_start") WHERE "forge_rewards"."type" = 'forged';--> statement-breakpoint
CREATE UNIQUE INDEX "forge_weeks_key" ON "forge_weeks" USING btree ("user_id","ladder_key","week_start");--> statement-breakpoint
CREATE INDEX "forge_weeks_user_week_idx" ON "forge_weeks" USING btree ("user_id","week_start");