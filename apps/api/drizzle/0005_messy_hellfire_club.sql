CREATE TABLE "exercise_favourites" (
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text NOT NULL,
	"goal" text NOT NULL,
	"measure" text NOT NULL,
	"primary_muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}'::text[] NOT NULL,
	"equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"force" text,
	"level" text,
	"mechanic" text,
	"instructions" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"source" text,
	"source_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_favourites" ADD CONSTRAINT "exercise_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_favourites" ADD CONSTRAINT "exercise_favourites_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_favourites_pk" ON "exercise_favourites" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_source_unique" ON "exercises" USING btree ("source","source_id") WHERE "exercises"."owner_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_owner_name_unique" ON "exercises" USING btree ("owner_user_id",lower("name")) WHERE "exercises"."owner_user_id" is not null and "exercises"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "exercises_category_idx" ON "exercises" USING btree ("category");--> statement-breakpoint
CREATE INDEX "exercises_owner_idx" ON "exercises" USING btree ("owner_user_id");