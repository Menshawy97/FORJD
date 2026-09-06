import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.schema";

/**
 * Body-composition schema (Phase 5, InBody). Two tables giving `docs/architecture/health-data.md`'s
 * tall `BodyCompositionMeasurement` shape a first-class scan entity:
 *
 * - `body_scans` -- one row per photo confirmed by the user. The event.
 * - `body_measurements` -- one row per metric that scan produced. The data.
 *
 * Deliberately NOT a single wide table with a column per metric (weight_kg, bmi, ...): a
 * new field an InBody model prints (bone mass, phase angle) would then need a migration.
 * With this shape it needs only a new `@forjd/domain` BODY_METRICS tuple member. This is the
 * same reasoning `workouts.schema.ts` gives for keeping closed-vocabulary columns as `text`,
 * one level up -- applied to the metric set itself, not just its representation.
 *
 * `measuredAt` is duplicated onto `body_measurements` (also present via the `body_scans` join)
 * so Phase 6's read-time source-priority policy (`health-data.md`'s per-metric priority list)
 * can query measurements directly without joining scans every time.
 *
 * `metric` and `source` are `text`, never a Postgres enum, matching every other
 * closed-vocabulary column in this codebase (`workouts.schema.ts`, `nutrition.schema.ts`):
 * narrowing `@forjd/domain`'s `BODY_METRICS` / `SCAN_SOURCES` tuples is a domain-package edit,
 * `ALTER TYPE` cannot even remove a value.
 *
 * `value` is `numeric`, matching `workouts.schema.ts`'s weight columns -- Postgres `numeric`
 * maps to a JS `string` through drizzle-orm to avoid float precision loss, converted at the
 * repository boundary (`.toString()` on write, `Number(...)` on read).
 *
 * RLS is not enabled, matching every other table in this schema directory -- no client holds
 * a Supabase credential (ADR-008), so the standing gating rule that triggers enabling it is
 * not tripped. Authorization lives in the NestJS service layer (Phase 5D), per rule 12.
 */
export const bodyScans = pgTable(
  "body_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    /** One of SCAN_SOURCES in @forjd/domain -- "inbody" is the only value Phase 5 writes. */
    source: text("source").notNull(),
    /**
     * The StorageProvider key for the confirmed photo in the private `inbody` bucket
     * (`getSignedUrl`, never `getPublicUrl` -- a scan photo is not public like an avatar).
     */
    photoKey: text("photo_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("body_scans_user_measured_idx").on(table.userId, table.measuredAt)],
);

export type BodyScanRow = typeof bodyScans.$inferSelect;
export type NewBodyScanRow = typeof bodyScans.$inferInsert;

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => bodyScans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One of BODY_METRICS in @forjd/domain, e.g. "weight_kg", "visceral_fat_level". */
    metric: text("metric").notNull(),
    value: numeric("value").notNull(),
    /** One of BODY_METRIC_UNITS' values in @forjd/domain -- empty string for unitless metrics. */
    unit: text("unit").notNull(),
    /**
     * 0-1, the vision extraction's own confidence for this specific field. Persisted (not
     * discarded after the confirm screen) so a future re-audit of extraction quality can
     * compare what the model said against what the user ultimately confirmed.
     */
    confidence: numeric("confidence").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("body_measurements_scan_idx").on(table.scanId),
    index("body_measurements_user_metric_measured_idx").on(table.userId, table.metric, table.measuredAt),
  ],
);

export type BodyMeasurementRow = typeof bodyMeasurements.$inferSelect;
export type NewBodyMeasurementRow = typeof bodyMeasurements.$inferInsert;
