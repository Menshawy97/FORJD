CREATE TABLE "health_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric_type" text NOT NULL,
	"value" numeric NOT NULL,
	"unit" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"provider_record_id" text,
	"device_id" text,
	"quality" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_connections" ADD CONSTRAINT "health_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_observations" ADD CONSTRAINT "health_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_connections_user_source_unique" ON "health_connections" USING btree ("user_id","source");--> statement-breakpoint
CREATE INDEX "health_observations_user_metric_start_idx" ON "health_observations" USING btree ("user_id","metric_type","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "health_observations_user_source_provider_record_unique" ON "health_observations" USING btree ("user_id","source","provider_record_id") WHERE "health_observations"."provider_record_id" is not null;