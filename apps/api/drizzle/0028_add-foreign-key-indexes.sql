DROP INDEX "exercise_favourites_pk";--> statement-breakpoint
ALTER TABLE "exercise_favourites" ADD CONSTRAINT "exercise_favourites_pkey" PRIMARY KEY("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "exercise_favourites_exercise_idx" ON "exercise_favourites" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "program_enrollments_program_idx" ON "program_enrollments" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "program_workouts_template_idx" ON "program_workouts" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "workout_templates_based_on_idx" ON "workout_templates" USING btree ("based_on_template_id");