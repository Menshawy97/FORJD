-- R28: missing foreign-key indexes, ordered per the plan -- nutrition_log_entries(food_id)
-- first (the food-search/saved-meals N+1 fix's own hot path), then goals(user_id), then the
-- remaining foreign-key column with no covering index (saved_meal_items.food_id).
CREATE INDEX "nutrition_log_entries_food_idx" ON "nutrition_log_entries" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "goals_user_id_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_meal_items_food_idx" ON "saved_meal_items" USING btree ("food_id");
