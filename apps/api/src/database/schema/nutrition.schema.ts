import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.schema";

/**
 * Nutrition schema (Phase 2.5, ADR-023). Six tables: `foods`, `food_servings`, `macro_goals`,
 * `saved_meals`, `saved_meal_items`, `nutrition_log_entries` -- the plan's own list
 * (`docs/product/nutrition-plan.md`'s Phase C).
 *
 * `numeric` columns follow `profiles.schema.ts`'s own convention: Postgres `numeric` maps to a
 * JS `string` through drizzle-orm by default (to avoid float precision loss), converted at the
 * repository boundary with `.toString()` on write and `Number(...)` on read -- see
 * `users.repository.ts`'s `heightCm` handling for the exact precedent this follows.
 */

/**
 * One table for both the USDA catalogue and user-authored custom foods (ADR-023), mirroring
 * `exercises.schema.ts`'s own precedent exactly: `ownerUserId: null` marks a catalogue row.
 *
 * Macros are stored **per 100 g**, matching both the design's own storage shape
 * (`docs/design/nutrition-screen-specs.md` §1) and `Food.macrosPer100g` in `@forjd/domain` --
 * a serving's actual values are always derived (`value * grams / 100`), never stored
 * redundantly, so there is exactly one place a food's nutrition numbers live.
 *
 * `category` is `text`, one of `FOOD_CATEGORIES` in `@forjd/domain` -- never a Postgres enum,
 * same reasoning as every other closed-vocabulary column in this codebase (`ALTER TYPE`
 * cannot remove a value; narrowing a tuple is free).
 *
 * NOT modeled here: `search_vector` (a generated `tsvector` column, GIN-indexed) and the
 * `name` trigram GIN index, both added by the hand-written migration
 * `0009_add-food-search-indexes.sql` -- deliberately absent from this schema object for the
 * exact reason `exercises.schema.ts` gives: reflecting a generated column here would make a
 * future `db:generate` believe it needs to (re)create what that migration already did. Query
 * `search_vector` through a raw `sql` tagged template in the repository, never through the
 * typed column builder.
 */
export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for the ingested USDA catalogue; the owning user's id for a custom food. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** One of FOOD_CATEGORIES in @forjd/domain. */
    category: text("category").notNull(),
    kcalPer100g: numeric("kcal_per_100g", { precision: 8, scale: 2 }).notNull(),
    proteinPer100g: numeric("protein_per_100g", { precision: 8, scale: 2 }).notNull(),
    carbsPer100g: numeric("carbs_per_100g", { precision: 8, scale: 2 }).notNull(),
    fatPer100g: numeric("fat_per_100g", { precision: 8, scale: 2 }).notNull(),
    /** Null for a custom food; the adapter's identifier (e.g. "usda_fdc") otherwise. Mirrors `exercises.source`. */
    source: text("source"),
    /** The source dataset's own id for this food, e.g. USDA's `fdc_id`. Mirrors `exercises.source_id`. */
    sourceId: text("source_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Mirrors exercises_source_unique -- re-running the USDA loader against the same
    // (source, sourceId) can never create a duplicate catalogue row, even concurrently.
    uniqueIndex("foods_source_unique")
      .on(table.source, table.sourceId)
      .where(sql`${table.ownerUserId} is null`),
    // Mirrors exercises_owner_name_unique -- case-insensitive duplicate-name rejection for a
    // user's own custom foods, excluding soft-deleted rows so a deleted name is reusable.
    uniqueIndex("foods_owner_name_unique")
      .on(table.ownerUserId, sql`lower(${table.name})`)
      .where(sql`${table.ownerUserId} is not null and ${table.deletedAt} is null`),
    index("foods_category_idx").on(table.category),
    index("foods_owner_idx").on(table.ownerUserId),
    // The food-search endpoint's sort key (Phase D), same reasoning as exercises_name_id_idx:
    // a keyset without a matching index degrades to a full sort on every page.
    index("foods_name_id_idx").on(table.name, table.id),
  ],
);

export type FoodRow = typeof foods.$inferSelect;
export type NewFoodRow = typeof foods.$inferInsert;

/**
 * A food's named servings, e.g. `{ label: "1 medium (118g)", grams: 118 }` -- a separate table
 * rather than a JSONB column on `foods`, so every table in this schema stays queryable with
 * ordinary SQL and this is not the one JSONB exception in it.
 */
export const foodServings = pgTable(
  "food_servings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    foodId: uuid("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    grams: numeric("grams", { precision: 8, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("food_servings_food_idx").on(table.foodId, table.sortOrder)],
);

export type FoodServingRow = typeof foodServings.$inferSelect;

/**
 * One row per user, created only when the user actually saves goals via the *Set daily goals*
 * sheet -- there is deliberately no seeded default row and no fallback computation. Before a
 * user saves goals, `MacroGoalsRepository.findByUserId` returns `null` and the dashboard shows
 * an honest "set your goals" prompt rather than a ring against a fabricated number, the same
 * honest-empty-state principle `phase-2-plan.md`'s Phase J applied to exercise stat tiles.
 *
 * `MACRO_GOALS` is the design's own dead constant (`nutrition-screen-specs.md` §1); the design
 * has no default-goals concept at all once that literal is set aside, which is exactly what
 * this schema reflects.
 */
export const macroGoals = pgTable("macro_goals", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  kcal: numeric("kcal", { precision: 8, scale: 2 }).notNull(),
  protein: numeric("protein", { precision: 8, scale: 2 }).notNull(),
  carbs: numeric("carbs", { precision: 8, scale: 2 }).notNull(),
  fat: numeric("fat", { precision: 8, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MacroGoalsRow = typeof macroGoals.$inferSelect;

/**
 * A named, ordered list of food entries a user can log in one action (`nutrition-plan.md`'s
 * locked decisions). Logging a saved meal **copies** its items into the day's log rather than
 * referencing this table, so editing a saved meal never rewrites logged history -- enforced
 * structurally by `nutrition_log_entries` having no foreign key back to `saved_meals` at all.
 */
export const savedMeals = pgTable(
  "saved_meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("saved_meals_user_idx").on(table.userId)],
);

export type SavedMealRow = typeof savedMeals.$inferSelect;

export const savedMealItems = pgTable(
  "saved_meal_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    savedMealId: uuid("saved_meal_id")
      .notNull()
      .references(() => savedMeals.id, { onDelete: "cascade" }),
    foodId: uuid("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    /** Snapshot of the serving picked when this item was added -- see nutrition_log_entries for why servings are always snapshotted, never referenced live. */
    servingLabel: text("serving_label").notNull(),
    grams: numeric("grams", { precision: 8, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("saved_meal_items_meal_idx").on(table.savedMealId, table.sortOrder)],
);

export type SavedMealItemRow = typeof savedMealItems.$inferSelect;

/**
 * The day's food log -- one row per logged item, per `nutrition-plan.md`'s locked decisions.
 *
 * **`loggedDate` is a plain `date`, supplied by the client, not derived from `createdAt` on
 * the server.** A day boundary computed from a server timestamp would use the server's
 * timezone, which is wrong for a user anywhere else -- the same reason a calendar `date`
 * column, not a `timestamptz`, is what "which day is this for" means to the person logging it.
 * The client sends its own local calendar day; the server trusts it, the same way food-logging
 * products conventionally treat the device's clock as authoritative for day boundaries.
 *
 * **`servingLabel`/`grams`/the macro snapshot are captured at log time, not looked up live.**
 * If a food's data is corrected later (a custom food edited, or a re-vendored USDA row), past
 * log entries must not silently change what a user is told they ate that day -- the same
 * "preserve source, do not silently rewrite" instinct CLAUDE.md rule 10 states for health
 * observations, applied here to a food log entry's own history.
 *
 * **`groupId`** ties together every item logged from one `saved_meals` action in a single call
 * (`nutrition-plan.md`'s locked decisions: "Grouped log entries... share a group_id so the
 * dashboard can collapse and delete them as one"). `null` for an item logged individually.
 */
export const nutritionLogEntries = pgTable(
  "nutrition_log_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    foodId: uuid("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "restrict" }),
    loggedDate: date("logged_date").notNull(),
    /** One of MEAL_SLOTS in @forjd/domain. */
    slot: text("slot").notNull(),
    servingLabel: text("serving_label").notNull(),
    grams: numeric("grams", { precision: 8, scale: 2 }).notNull(),
    /** Snapshot of the food's macros for this entry's actual grams, not per-100g -- see the table docblock. */
    kcal: numeric("kcal", { precision: 8, scale: 2 }).notNull(),
    protein: numeric("protein", { precision: 8, scale: 2 }).notNull(),
    carbs: numeric("carbs", { precision: 8, scale: 2 }).notNull(),
    fat: numeric("fat", { precision: 8, scale: 2 }).notNull(),
    /** Groups items logged together from one saved meal; null for an individually logged item. */
    groupId: uuid("group_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The dashboard's own read: "give me today's log, grouped by slot" -- (userId, loggedDate)
    // is the whole WHERE clause of that query.
    index("nutrition_log_entries_user_date_idx").on(table.userId, table.loggedDate),
    index("nutrition_log_entries_group_idx").on(table.groupId),
  ],
);

export type NutritionLogEntryRow = typeof nutritionLogEntries.$inferSelect;
