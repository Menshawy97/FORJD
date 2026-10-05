CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"workout" boolean DEFAULT true NOT NULL,
	"recovery" boolean DEFAULT true NOT NULL,
	"pr" boolean DEFAULT true NOT NULL,
	"rank" boolean DEFAULT false NOT NULL,
	"weekly" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;