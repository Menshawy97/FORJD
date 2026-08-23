CREATE TABLE "privacy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_profile" boolean DEFAULT false NOT NULL,
	"leaderboard_opt_in" boolean DEFAULT false NOT NULL,
	"location_for_leaderboard" boolean DEFAULT false NOT NULL,
	"ai_features_consent" boolean DEFAULT false NOT NULL,
	"ai_features_consent_at" timestamp with time zone,
	"crash_diagnostics" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "weight_unit" text DEFAULT 'kg' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "distance_unit" text DEFAULT 'km' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "energy_unit" text DEFAULT 'kcal' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "training_goals" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "activities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "city_slug" text;--> statement-breakpoint
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;