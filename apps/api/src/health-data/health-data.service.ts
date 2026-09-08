import { Injectable } from "@nestjs/common";
import { resolveByPriority, type HealthMetricType, type HealthObservation, type User } from "@forjd/domain";
import type {
  BatchIngestHealthObservationsRequest,
  HealthConnectionListResponse,
  HealthObservationSeriesResponse,
} from "@forjd/contracts";

import { HealthDataRepository, ObservationRow } from "./health-data.repository";

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
  async getSeries(user: User): Promise<HealthObservationSeriesResponse> {
    const rows = await this.healthDataRepository.getObservationsForUser(user.id);
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

    const series = Array.from(byMetricAndWindow.entries()).map(([metricType, byWindow]) => {
      // Non-null assertion, not a filter: every `byWindow` entry was populated by pushing at
      // least one observation onto it above, so `resolveByPriority` (which only returns null
      // for an empty candidate list) can never actually return null here -- and `winners` is
      // therefore never empty either, so `winners[0]` is always defined despite
      // `noUncheckedIndexedAccess`.
      const winners = Array.from(byWindow.values())
        .map((candidates) => resolveByPriority(metricType, candidates)!)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      return {
        metricType,
        unit: winners[0]!.unit,
        points: winners.map((w) => ({ startTime: w.startTime.toISOString(), value: w.value })),
      };
    });

    return { series };
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
