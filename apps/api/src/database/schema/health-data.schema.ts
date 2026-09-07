import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.schema";

/**
 * Health-observation schema (Phase 6). Two tables:
 *
 * - `health_observations` -- the tall, one-row-per-reading shape `docs/architecture/health-data.md`
 *   specifies verbatim (`id, user_id, metric_type, value, unit, start_time, end_time, source,
 *   provider_record_id, device_id, quality, created_at`). Deliberately not a wide table with a
 *   column per metric, for the same reason `body.schema.ts` gives one level up: a new metric a
 *   provider starts reporting is then a `@forjd/domain` tuple edit, not a migration.
 * - `health_connections` -- per-user, per-source connection state, holding the sync checkpoint
 *   (`last_successful_sync_at`) `health-data.md`'s "Ingestion pipeline" section requires
 *   ("Sync is checkpointed... and incremental").
 *
 * Only these two tables are built this slice, not the full set `docs/architecture/domain-model.md`
 * lists (`health_permissions`, `health_workouts`, `sleep_sessions`) -- per Phase 6's own plan
 * doc, building only what the current slices need rather than the whole documented model
 * up front.
 *
 * `metric_type` and `source` are `text`, never a Postgres enum, matching every other
 * closed-vocabulary column in this codebase: narrowing `@forjd/domain`'s `HEALTH_METRIC_TYPES`
 * / `HEALTH_SOURCES` tuples is a domain-package edit, `ALTER TYPE` cannot even remove a value.
 *
 * `value` and `quality` are `numeric`, matching `body.schema.ts`'s measurement columns --
 * Postgres `numeric` maps to a JS `string` through drizzle-orm to avoid float precision loss,
 * converted at the repository boundary.
 *
 * RLS is not enabled, matching every other table in this schema directory -- no client holds
 * a Supabase credential (ADR-008), so the standing gating rule that triggers enabling it is
 * not tripped. Authorization lives in the NestJS service layer, per rule 12.
 */
export const healthObservations = pgTable(
  "health_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One of HEALTH_METRIC_TYPES in @forjd/domain, e.g. "hrv", "sleep_deep_duration". */
    metricType: text("metric_type").notNull(),
    value: numeric("value").notNull(),
    /** One of HEALTH_METRIC_UNITS' values in @forjd/domain. Carried per row, not implied
     *  from metricType, so a row stays self-describing even if a canonical unit is revised. */
    unit: text("unit").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    /** Equal to startTime for an instantaneous reading. */
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    /** One of HEALTH_SOURCES in @forjd/domain, e.g. "health_connect", "manual". */
    source: text("source").notNull(),
    /**
     * The id the provider itself assigns to this record. Null for a provider with no stable
     * per-record id, or for a "manual" entry. The idempotent-reingest unique index below is
     * partial specifically because this column is legitimately null for some rows.
     */
    providerRecordId: text("provider_record_id"),
    deviceId: text("device_id"),
    /** 0-1 provider-reported confidence, or null when the provider does not report one. */
    quality: numeric("quality"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("health_observations_user_metric_start_idx").on(table.userId, table.metricType, table.startTime),
    /**
     * Idempotent re-ingestion: re-syncing an overlapping window upserts in place rather than
     * duplicating, the same keyed-upsert property `exercises:load` relies on for the
     * exercise catalogue. Partial (WHERE provider_record_id IS NOT NULL) because a provider
     * without stable record ids, or a manual entry, legitimately has no value to dedupe on.
     */
    uniqueIndex("health_observations_user_source_provider_record_unique")
      .on(table.userId, table.source, table.providerRecordId)
      .where(sql`${table.providerRecordId} is not null`),
  ],
);

export type HealthObservationRow = typeof healthObservations.$inferSelect;
export type NewHealthObservationRow = typeof healthObservations.$inferInsert;

export const healthConnections = pgTable(
  "health_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** One of HEALTH_SOURCES in @forjd/domain -- which provider this connection is for. */
    source: text("source").notNull(),
    /**
     * Null until the first successful sync completes. The checkpoint an incremental sync
     * reads from and advances -- health-data.md: "Sync is checkpointed... and incremental."
     */
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** One connection per user per provider -- reconnecting the same provider updates this
     *  row rather than creating a second, dangling connection state. */
    uniqueIndex("health_connections_user_source_unique").on(table.userId, table.source),
  ],
);

export type HealthConnectionRow = typeof healthConnections.$inferSelect;
export type NewHealthConnectionRow = typeof healthConnections.$inferInsert;
