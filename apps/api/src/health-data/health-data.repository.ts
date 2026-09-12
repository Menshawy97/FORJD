import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { HealthMetricType, HealthSource } from "@forjd/domain";

import { Database, DRIZZLE } from "../database/database.module";
import { healthConnections, healthObservations } from "../database/schema/health-data.schema";

export interface NewObservationInput {
  metricType: HealthMetricType;
  value: number;
  unit: string;
  startTime: Date;
  endTime: Date;
  source: HealthSource;
  providerRecordId: string | null;
  deviceId: string | null;
  quality: number | null;
}

/**
 * Carries every field `@forjd/domain`'s `HealthObservation` interface declares (not just
 * what the series-read response exposes) so the service can map a row straight into a real
 * `HealthObservation` and pass it to `resolveByPriority` -- reusing that function honestly
 * means giving it genuine domain objects, not a narrowed shape that happens to satisfy the
 * two fields it currently reads.
 */
export interface ObservationRow {
  id: string;
  userId: string;
  metricType: string;
  value: number;
  unit: string;
  startTime: Date;
  endTime: Date;
  source: string;
  providerRecordId: string | null;
  deviceId: string | null;
  quality: number | null;
  createdAt: Date;
}

export interface ConnectionRow {
  source: string;
  lastSuccessfulSyncAt: Date | null;
}

/**
 * A required, bounded read window for `getObservationsForUser` (R8 / audit finding H4).
 * Naming mirrors `@forjd/domain`'s `SyncRequest.metricTypes: readonly HealthMetricType[]` so
 * this stays consistent with the one other place the codebase already asks "which metrics do
 * you want." Every field is mandatory -- there is deliberately no overload or default that
 * lets a caller omit the window, because that is exactly how the unbounded
 * `SELECT * WHERE user_id = ?` full-table scan this slice fixes came to exist in the first
 * place. `since: null` is the explicit way to say "no lower time bound" (still bounded by
 * `metricTypes` and `limit`); there is no equivalent escape hatch for `metricTypes` or `limit`.
 */
export interface ObservationsWindow {
  metricTypes: readonly HealthMetricType[];
  since: Date | null;
  limit: number;
}

/**
 * Follows `nutrition.repository.ts`'s multi-row upsert shape for `upsertFoods`: one
 * `insert(...).values([...]).onConflictDoUpdate(...)` covering the whole batch, with
 * `sql`excluded.<column>`` referencing each row's own incoming value (there is no single JS
 * value to put in `set` once the insert covers more than one row). `targetWhere` matches the
 * partial unique index `health-data.schema.spec.ts` already proved usable for exactly this
 * query shape -- a row with a null `providerRecordId` simply never matches that predicate, so
 * it always inserts rather than upserting, correctly for both provider-supplied and
 * `manual` observations in the same batch.
 */
@Injectable()
export class HealthDataRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async ingestObservations(userId: string, observations: NewObservationInput[]): Promise<void> {
    if (observations.length === 0) return;

    await this.db
      .insert(healthObservations)
      .values(
        observations.map((o) => ({
          userId,
          metricType: o.metricType,
          value: o.value.toString(),
          unit: o.unit,
          startTime: o.startTime,
          endTime: o.endTime,
          source: o.source,
          providerRecordId: o.providerRecordId,
          deviceId: o.deviceId,
          quality: o.quality === null ? null : o.quality.toString(),
        })),
      )
      .onConflictDoUpdate({
        target: [healthObservations.userId, healthObservations.source, healthObservations.providerRecordId],
        targetWhere: isNotNull(healthObservations.providerRecordId),
        set: {
          value: sql`excluded.value`,
          unit: sql`excluded.unit`,
          startTime: sql`excluded.start_time`,
          endTime: sql`excluded.end_time`,
          deviceId: sql`excluded.device_id`,
          quality: sql`excluded.quality`,
        },
      });
  }

  /**
   * Bounded per R8 (audit H4): every read pushes `metricTypes` (an `IN` predicate), `since`
   * (a `start_time >=` predicate, when given) and `limit` into the SQL itself, rather than
   * pulling the user's entire observation history into Node and filtering there. This is the
   * shape the `(user_id, metric_type, start_time)` index (`health-data.schema.ts`) is built
   * for -- `userId` equality plus a `metricType` `IN` plus a `startTime` lower bound.
   */
  async getObservationsForUser(userId: string, window: ObservationsWindow): Promise<ObservationRow[]> {
    const conditions = [eq(healthObservations.userId, userId), inArray(healthObservations.metricType, window.metricTypes)];
    if (window.since !== null) {
      conditions.push(gte(healthObservations.startTime, window.since));
    }

    const rows = await this.db
      .select()
      .from(healthObservations)
      .where(and(...conditions))
      .orderBy(healthObservations.startTime)
      .limit(window.limit);

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      metricType: r.metricType,
      value: Number(r.value),
      unit: r.unit,
      startTime: r.startTime,
      endTime: r.endTime,
      source: r.source,
      providerRecordId: r.providerRecordId,
      deviceId: r.deviceId,
      quality: r.quality === null ? null : Number(r.quality),
      createdAt: r.createdAt,
    }));
  }

  async getConnectionsForUser(userId: string): Promise<ConnectionRow[]> {
    const rows = await this.db.select().from(healthConnections).where(eq(healthConnections.userId, userId));

    return rows.map((r) => ({ source: r.source, lastSuccessfulSyncAt: r.lastSuccessfulSyncAt }));
  }
}
