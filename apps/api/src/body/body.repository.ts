import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BodyMetric } from "@forjd/domain";

import { Database, DRIZZLE } from "../database/database.module";
import { bodyMeasurements, bodyScans } from "../database/schema/body.schema";

export interface NewMeasurementInput {
  metric: BodyMetric;
  value: number;
  unit: string;
  confidence: number;
}

export interface MeasurementRow {
  metric: string;
  value: number;
  unit: string;
  confidence: number;
}

export interface ScanWithMeasurementsRow {
  id: string;
  measuredAt: Date;
  source: string;
  measurements: MeasurementRow[];
}

export interface MetricSeriesRow {
  metric: string;
  unit: string;
  points: Array<{ measuredAt: Date; value: number }>;
}

/**
 * Two-table repository, following `progress.repository.ts`'s DRIZZLE-injection pattern.
 * All aggregation across scans/measurements is done here in JS after a plain select, not in
 * SQL -- a user's scan count is small (an InBody scan happens rarely), so this trades a
 * theoretical query-count optimisation for code any reader can follow without tracing a
 * multi-join SQL string.
 */
@Injectable()
export class BodyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createScan(
    userId: string,
    measuredAt: Date,
    source: string,
    photoKey: string,
    measurements: NewMeasurementInput[],
  ): Promise<string> {
    const [scan] = await this.db.insert(bodyScans).values({ userId, measuredAt, source, photoKey }).returning();
    if (!scan) throw new Error("insert did not return a row");

    if (measurements.length > 0) {
      await this.db.insert(bodyMeasurements).values(
        measurements.map((m) => ({
          scanId: scan.id,
          userId,
          metric: m.metric,
          value: m.value.toString(),
          unit: m.unit,
          confidence: m.confidence.toString(),
          measuredAt,
        })),
      );
    }

    return scan.id;
  }

  async getScanById(userId: string, scanId: string): Promise<ScanWithMeasurementsRow | null> {
    const [scan] = await this.db
      .select()
      .from(bodyScans)
      .where(and(eq(bodyScans.id, scanId), eq(bodyScans.userId, userId)));
    if (!scan) return null;

    const measurements = await this.db.select().from(bodyMeasurements).where(eq(bodyMeasurements.scanId, scanId));

    return {
      id: scan.id,
      measuredAt: scan.measuredAt,
      source: scan.source,
      measurements: measurements.map((m) => ({
        metric: m.metric,
        value: Number(m.value),
        unit: m.unit,
        confidence: Number(m.confidence),
      })),
    };
  }

  async listScansForUser(userId: string): Promise<ScanWithMeasurementsRow[]> {
    const scans = await this.db
      .select()
      .from(bodyScans)
      .where(eq(bodyScans.userId, userId))
      .orderBy(desc(bodyScans.measuredAt));

    if (scans.length === 0) return [];

    const scanIds = scans.map((s) => s.id);
    const measurements = await this.db
      .select()
      .from(bodyMeasurements)
      .where(inArray(bodyMeasurements.scanId, scanIds));

    const byScan = new Map<string, typeof measurements>();
    for (const m of measurements) {
      const list = byScan.get(m.scanId) ?? [];
      list.push(m);
      byScan.set(m.scanId, list);
    }

    return scans.map((scan) => ({
      id: scan.id,
      measuredAt: scan.measuredAt,
      source: scan.source,
      measurements: (byScan.get(scan.id) ?? []).map((m) => ({
        metric: m.metric,
        value: Number(m.value),
        unit: m.unit,
        confidence: Number(m.confidence),
      })),
    }));
  }

  async getSeriesForUser(userId: string): Promise<MetricSeriesRow[]> {
    const rows = await this.db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(asc(bodyMeasurements.measuredAt));

    const byMetric = new Map<string, MetricSeriesRow>();
    for (const row of rows) {
      const entry = byMetric.get(row.metric) ?? { metric: row.metric, unit: row.unit, points: [] };
      entry.points.push({ measuredAt: row.measuredAt, value: Number(row.value) });
      byMetric.set(row.metric, entry);
    }

    return Array.from(byMetric.values());
  }
}
