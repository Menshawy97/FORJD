ALTER TABLE "nutrition_log_entries" ADD COLUMN "group_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_meals_owner_name_unique" ON "saved_meals" USING btree ("user_id",lower("name"));