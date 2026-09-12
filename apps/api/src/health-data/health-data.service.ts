import { Injectable } from "@nestjs/common";
import {
  computeReadiness,
  resolveByPriority,
  HEALTH_METRIC_TYPES,
  type HealthMetricType,
  type HealthObservation,
  type ReadinessComponentKey,
  type ReadinessDailyReading,
  type User,
} from "@forjd/domain";
import type {
  BatchIngestHealthObservationsRequest,
  HealthConnectionListResponse,
  HealthObservationSeriesQuery,
  HealthObservationSeriesResponse,
  ReadinessResponse,
} from "@forjd/contracts";

import { localCalendarDate } from "../workouts/workouts.repository";
import { HealthDataRepository, ObservationRow, ObservationsWindow } from "./health-data.repository";

/** The four metric types ADR-031's readiness score reads -- a subset of
 *  `HEALTH_METRIC_TYPES`, in the fixed order `computeReadiness` itself iterates. */
const READINESS_COMPONENT_KEYS: readonly ReadinessComponentKey[] = [
  "hrv",
  "resting_heart_rate",
  "sleep_duration",
  "respiratory_rate",
];

/**
 * R8 (audit H4): readiness only ever needs its own trailing baseline window, never the
 * user's full history. `readiness.ts` keeps its `BASELINE_WINDOW_DAYS` (60) and
 * `RECENT_WINDOW_DAYS` (7) constants private -- this does not import them, it just budgets
 * generously above their sum (67) so a change to either constant can't silently starve this
 * read. The extra day is slack for `getResolvedObservations`'s per-window grouping crossing a
 * UTC day boundary relative to the caller's own time zone.
 */
const READINESS_LOOKBACK_DAYS = 68;
/** Four components x 68 days, with slack for multiple same-day readings per component
 *  (e.g. several short Health Connect sync windows in one day) -- generous, but still a real
 *  bound instead of "however much history exists." */
const READINESS_OBSERVATION_LIMIT = 5000;

@Injectable()
export class HealthDataService {
  constructor(private readonly healthDataRepository: HealthDataRepository) {}

  /** Idempotent: re-posting an overlapping sync window upserts in place, via the partial
   *  unique index the repository's `ingestObservations` targets -- see its own docblock. */
  async ingestBatch(user: User, request: BatchIngestHealthObservationsRequest): Promise<void> {
    await this.healthDataRepository.ingestObservations(
      user.id,
      request.observations.map((o) => ({
        metricType: o.metricType,
        value: o.value,
        unit: o.unit,
        startTime: new Date(o.startTime),
        endTime: new Date(o.endTime),
        source: o.source,
        providerRecordId: o.providerRecordId ?? null,
        deviceId: o.deviceId ?? null,
        quality: o.quality ?? null,
      })),
    );
  }

  /**
   * Applies `health-data.md`'s read-time source-priority reconciliation
   * (`@forjd/domain`'s `resolveByPriority`), per metric type and per exact `(startTime,
   * endTime)` window -- two observations for the same metric at the same window are treated
   * as duplicate candidates for that one reading (e.g. Health Connect and Apple Health both
   * reporting last night's HRV), and `resolveByPriority` picks the single winner to show.
   * Two different windows for the same metric are two distinct points in the series, not
   * candidates for each other.
   */
  async getSeries(user: User, query: HealthObservationSeriesQuery): Promise<HealthObservationSeriesResponse> {
    const window: ObservationsWindow = {
      metricTypes: query.metricTypes ?? HEALTH_METRIC_TYPES,
      since: query.since ? new Date(query.since) : null,
      limit: query.limit,
    };
    const observations = await this.getResolvedObservations(user.id, window);

    const byMetric = new Map<HealthMetricType, HealthObservation[]>();
    for (const obs of observations) {
      const list = byMetric.get(obs.metricType) ?? [];
      list.push(obs);
      byMetric.set(obs.metricType, list);
    }

    const series = Array.from(byMetric.entries()).map(([metricType, winners]) => {
      const sorted = [...winners].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      return {
        metricType,
        // Every metricType key in byMetric was populated by at least one push above, so
        // sorted[0] is always defined despite noUncheckedIndexedAccess.
        unit: sorted[0]!.unit,
        points: sorted.map((w) => ({ startTime: w.startTime.toISOString(), value: w.value })),
      };
    });

    return { series };
  }

  /**
   * ADR-031's readiness score, computed for "today" in the caller's own time zone -- `now` is
   * read here rather than inside `computeReadiness` itself, mirroring `ProgressService`'s own
   * split (its docblock explains why: keeps the pure domain function testable as a function of
   * its arguments, not of the wall clock).
   */
  async getReadiness(user: User, timeZone: string, now: Date = new Date()): Promise<ReadinessResponse> {
    const since = new Date(now);
    since.setUTCDate(since.getUTCDate() - READINESS_LOOKBACK_DAYS);
    const observations = await this.getResolvedObservations(user.id, {
      metricTypes: READINESS_COMPONENT_KEYS,
      since,
      limit: READINESS_OBSERVATION_LIMIT,
    });
    const asOf = localCalendarDate(now, timeZone);

    const readings = Object.fromEntries(
      READINESS_COMPONENT_KEYS.map((key) => [key, dailyReadingsFor(observations, key, timeZone)]),
    ) as Record<ReadinessComponentKey, ReadinessDailyReading[]>;

    const result = computeReadiness(readings, asOf);
    return { ...result, components: [...result.components] };
  }

  async listConnections(user: User): Promise<HealthConnectionListResponse> {
    const connections = await this.healthDataRepository.getConnectionsForUser(user.id);

    return {
      connections: connections.map((c) => ({
        source: c.source as HealthConnectionListResponse["connections"][number]["source"],
        lastSuccessfulSyncAt: c.lastSuccessfulSyncAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * `health-data.md`'s read-time source-priority reconciliation (`resolveByPriority`), per
   * metric type and per exact `(startTime, endTime)` window -- shared by `getSeries` and
   * `getReadiness`, both of which need the same "one winning observation per window" read,
   * just bucketed differently afterward (by individual point vs. by local calendar day).
   */
  private async getResolvedObservations(userId: string, window: ObservationsWindow): Promise<HealthObservation[]> {
    const rows = await this.healthDataRepository.getObservationsForUser(userId, window);
    const observations: HealthObservation[] = rows.map(toHealthObservation);

    const byMetricAndWindow = new Map<HealthMetricType, Map<string, HealthObservation[]>>();
    for (const obs of observations) {
      const byWindow = byMetricAndWindow.get(obs.metricType) ?? new Map<string, HealthObservation[]>();
      const windowKey = `${obs.startTime.toISOString()}|${obs.endTime.toISOString()}`;
      const candidates = byWindow.get(windowKey) ?? [];
      candidates.push(obs);
      byWindow.set(windowKey, candidates);
      byMetricAndWindow.set(obs.metricType, byWindow);
    }

    const winners: HealthObservation[] = [];
    for (const [metricType, byWindow] of byMetricAndWindow) {
      for (const candidates of byWindow.values()) {
        // Non-null assertion: every `candidates` array was populated by pushing at least one
        // observation onto it above, so `resolveByPriority` (which only returns null for an
        // empty list) can never actually return null here.
        winners.push(resolveByPriority(metricType, candidates)!);
      }
    }
    return winners;
  }
}

/**
 * Reduces a metric's already-resolved observations to one reading per *local calendar day*
 * (`computeReadiness`'s own required input shape) -- distinct from `getSeries`, which reports
 * one point per raw `(startTime, endTime)` window. Multiple resolved observations landing on
 * the same local day (Health Connect can report several short windows within one day) are
 * averaged, the same "one reading per day" reduction `readiness.ts`'s own docblock says the
 * caller (this file) is responsible for.
 */
function dailyReadingsFor(
  observations: readonly HealthObservation[],
  metricType: ReadinessComponentKey,
  timeZone: string,
): ReadinessDailyReading[] {
  const byDate = new Map<string, number[]>();
  for (const obs of observations) {
    if (obs.metricType !== metricType) continue;
    const date = localCalendarDate(obs.startTime, timeZone);
    const values = byDate.get(date) ?? [];
    values.push(obs.value);
    byDate.set(date, values);
  }

  return Array.from(byDate.entries()).map(([date, values]) => ({
    date,
    value: values.reduce((sum, v) => sum + v, 0) / values.length,
  }));
}

function toHealthObservation(row: ObservationRow): HealthObservation {
  return {
    id: row.id,
    userId: row.userId,
    metricType: row.metricType as HealthMetricType,
    value: row.value,
    unit: row.unit,
    startTime: row.startTime,
    endTime: row.endTime,
    source: row.source as HealthObservation["source"],
    providerRecordId: row.providerRecordId,
    deviceId: row.deviceId,
    quality: row.quality,
    createdAt: row.createdAt,
  };
}
