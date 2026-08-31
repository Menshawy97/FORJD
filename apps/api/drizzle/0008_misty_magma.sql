CREATE TABLE "food_servings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" numeric(8, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"kcal_per_100g" numeric(8, 2) NOT NULL,
	"protein_per_100g" numeric(8, 2) NOT NULL,
	"carbs_per_100g" numeric(8, 2) NOT NULL,
	"fat_per_100g" numeric(8, 2) NOT NULL,
	"source" text,
	"source_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_goals" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kcal" numeric(8, 2) NOT NULL,
	"protein" numeric(8, 2) NOT NULL,
	"carbs" numeric(8, 2) NOT NULL,
	"fat" numeric(8, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"logged_date" date NOT NULL,
	"slot" text NOT NULL,
	"serving_label" text NOT NULL,
	"grams" numeric(8, 2) NOT NULL,
	"kcal" numeric(8, 2) NOT NULL,
	"protein" numeric(8, 2) NOT NULL,
	"carbs" numeric(8, 2) NOT NULL,
	"fat" numeric(8, 2) NOT NULL,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_meal_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"serving_label" text NOT NULL,
	"grams" numeric(8, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_goals" ADD CONSTRAINT "macro_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_log_entries" ADD CONSTRAINT "nutrition_log_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_log_entries" ADD CONSTRAINT "nutrition_log_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_meal_items" ADD CONSTRAINT "saved_meal_items_saved_meal_id_saved_meals_id_fk" FOREIGN KEY ("saved_meal_id") REFERENCES "public"."saved_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_meal_items" ADD CONSTRAINT "saved_meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_meals" ADD CONSTRAINT "saved_meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_servings_food_idx" ON "food_servings" USING btree ("food_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_unique" ON "foods" USING btree ("source","source_id") WHERE "foods"."owner_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "foods_owner_name_unique" ON "foods" USING btree ("owner_user_id",lower("name")) WHERE "foods"."owner_user_id" is not null and "foods"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "foods_category_idx" ON "foods" USING btree ("category");--> statement-breakpoint
CREATE INDEX "foods_owner_idx" ON "foods" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "foods_name_id_idx" ON "foods" USING btree ("name","id");--> statement-breakpoint
CREATE INDEX "nutrition_log_entries_user_date_idx" ON "nutrition_log_entries" USING btree ("user_id","logged_date");--> statement-breakpoint
CREATE INDEX "nutrition_log_entries_group_idx" ON "nutrition_log_entries" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "saved_meal_items_meal_idx" ON "saved_meal_items" USING btree ("saved_meal_id","sort_order");--> statement-breakpoint
CREATE INDEX "saved_meals_user_idx" ON "saved_meals" USING btree ("user_id");