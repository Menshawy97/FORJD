import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BodyMetric, SegmentalSite } from "@forjd/domain";

import { Database, DRIZZLE } from "../database/database.module";
import { bodyMeasurements, bodyScans } from "../database/schema/body.schema";

export interface NewMeasurementInput {
  metric: BodyMetric | SegmentalSite;
  value: number;
  unit: string;
  confidence: number;
  /** Worked out by the server from the scan's other values, not read or typed. Defaults to false. */
  calculated?: boolean;
}

export interface MeasurementRow {
  metric: string;
  value: number;
  unit: string;
  confidence: number;
  calculated: boolean;
}

/** The height and age printed on (or typed in for) one scan; null when a scan has none. */
export interface ScanProfileInput {
  heightCm: number | null;
  ageYears: number | null;
}

export interface ScanWithMeasurementsRow extends ScanProfileInput {
  id: string;
  measuredAt: Date;
  source: string;
  measurements: MeasurementRow[];
}

const NO_SCAN_PROFILE: ScanProfileInput = { heightCm: null, ageYears: null };

/** `numeric` arrives from drizzle as a string (see body.schema.ts); null stays null. */
function readScanProfile(scan: { heightCm: string | null; ageYears: number | null }): ScanProfileInput {
  return { heightCm: scan.heightCm === null ? null : Number(scan.heightCm), ageYears: scan.ageYears };
}

export interface MetricSeriesRow {
  metric: string;
  unit: string;
  points: Array<{ measuredAt: Date; value: number; calculated: boolean }>;
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

  /**
   * R7 (H3): both inserts run inside one `db.transaction` -- a crash or thrown error between
   * them (the measurements insert previously ran as a separate statement, after the photo
   * was already uploaded) used to leave an unrecoverable scan row with zero measurements,
   * since vision extraction is never re-run. Either both rows land, or neither does.
   */
  async createScan(
    userId: string,
    measuredAt: Date,
    source: string,
    /** Null for a manual entry, which has no photo. */
    photoKey: string | null,
    measurements: NewMeasurementInput[],
    /** Stored on the scan row, never as measurements, so they never become Body-tab trends. */
    profile: ScanProfileInput = NO_SCAN_PROFILE,
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [scan] = await tx
        .insert(bodyScans)
        .values({
          userId,
          measuredAt,
          source,
          photoKey,
          heightCm: profile.heightCm === null ? null : profile.heightCm.toString(),
          ageYears: profile.ageYears,
        })
        .returning();
      if (!scan) throw new Error("insert did not return a row");

      if (measurements.length > 0) {
        await tx.insert(bodyMeasurements).values(
          measurements.map((m) => ({
            scanId: scan.id,
            userId,
            metric: m.metric,
            value: m.value.toString(),
            unit: m.unit,
            confidence: m.confidence.toString(),
            calculated: m.calculated ?? false,
            measuredAt,
          })),
        );
      }

      return scan.id;
    });
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
      ...readScanProfile(scan),
      measurements: measurements.map((m) => ({
        metric: m.metric,
        value: Number(m.value),
        unit: m.unit,
        confidence: Number(m.confidence),
        calculated: m.calculated,
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
      ...readScanProfile(scan),
      measurements: (byScan.get(scan.id) ?? []).map((m) => ({
        metric: m.metric,
        value: Number(m.value),
        unit: m.unit,
        confidence: Number(m.confidence),
        calculated: m.calculated,
      })),
    }));
  }

  /**
   * `photoKey` on its own -- deliberately not folded into `listScansForUser`, whose
   * `ScanWithMeasurementsRow` shape is the public read contract and never leaks the storage
   * key. Account deletion (R3) is the one caller that needs the key itself, to delete the
   * object rather than merely read the scan.
   */
  async listScanPhotoKeysForUser(userId: string): Promise<string[]> {
    const rows = await this.db.select({ photoKey: bodyScans.photoKey }).from(bodyScans).where(eq(bodyScans.userId, userId));
    // Only photo *files* are listed here. A manual entry has no file in storage; its scan row
    // and values are still deleted with the account, by the cascade on body_scans.user_id.
    return rows.map((row) => row.photoKey).filter((key): key is string => key !== null);
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
      entry.points.push({ measuredAt: row.measuredAt, value: Number(row.value), calculated: row.calculated });
      byMetric.set(row.metric, entry);
    }

    return Array.from(byMetric.values());
  }
}
