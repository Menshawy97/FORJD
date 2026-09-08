import type {
  HealthMetricType,
  HealthSource,
  HealthPermission,
  HealthProvider,
  PermissionResult,
  ProviderCapabilities,
  SyncedObservation,
  SyncRequest,
  SyncResult,
} from "@forjd/domain";
import {
  SdkAvailabilityStatus,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
} from "react-native-health-connect";
import type { ReadRecordsOptions, RecordType } from "react-native-health-connect";

/** `TimeRangeFilter` itself is not part of the package's exported public types (only
 *  `ReadRecordsOptions`, which contains one, is) -- derived here rather than duplicated. */
type TimeRangeFilter = ReadRecordsOptions["timeRangeFilter"];

import {
  HEALTH_CONNECT_SUPPORTED_METRICS,
  METRIC_TO_RECORD_TYPE,
  mapActiveEnergyRecord,
  mapHeartRateRecord,
  mapHrvRecord,
  mapRespiratoryRateRecord,
  mapRestingHeartRateRecord,
  mapSleepSessionRecord,
  mapStepsRecord,
  mapVo2MaxRecord,
  mapWeightRecord,
  recordTypesFor,
} from "./health-connect-record-mapping";

/** `since: null` (a full sync) reads everything Health Connect will return up to `now` --
 *  the `before` filter variant takes no lower bound, matching "no checkpoint yet" honestly
 *  rather than picking an arbitrary floor date. */
export function buildTimeRangeFilter(since: Date | null, now: Date): TimeRangeFilter {
  if (since === null) {
    return { operator: "before", endTime: now.toISOString() };
  }
  return { operator: "between", startTime: since.toISOString(), endTime: now.toISOString() };
}

/**
 * The first concrete `HealthProvider` implementation (Phase 6F), behind
 * `react-native-health-connect` (ADR-034). Device-gated per CLAUDE.md rule 16 -- this file can
 * be written and exercised against the `forjd_pixel7_api34` emulator, but does not merge to
 * `main` until it has run on a physical Android phone.
 *
 * All actual field mapping lives in `health-connect-record-mapping.ts`; this class only wires
 * that pure logic to the library's SDK-status/permission/read calls, per ADR-003's rule that
 * normalization is the adapter's job, kept small and testable in isolation.
 */
export class HealthConnectProvider implements HealthProvider {
  readonly source: HealthSource = "health_connect";

  /**
   * Confirms Health Connect is actually available (not just that the app doesn't crash
   * calling into it) before anything else touches the SDK. `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED`
   * is deliberately treated as a failure here rather than silently degraded -- the caller
   * (a future connect-flow screen, not built yet) is what should decide how to guide the user
   * to update the Health Connect app, not this adapter.
   */
  async connect(): Promise<void> {
    const status = await getSdkStatus();
    if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      throw new Error(`Health Connect is not available on this device (status ${status})`);
    }

    const initialized = await initialize();
    if (!initialized) {
      throw new Error("Health Connect SDK failed to initialize");
    }
  }

  /**
   * Deliberately does not call the library's `revokeAllPermissions` -- its own docs warn that
   * revocation does not take effect until the app process restarts, reads and writes keep
   * succeeding in the meantime, and it explicitly says not to use it as a "disconnect" toggle.
   * A real disconnect flow (not built yet) should send the user to Health Connect's own
   * settings (`openHealthConnectSettings`) and track disconnected state in FORJD's own
   * `health_connections` row, per that same guidance.
   */
  async disconnect(): Promise<void> {}

  async getCapabilities(): Promise<ProviderCapabilities> {
    return { source: this.source, supportedMetrics: HEALTH_CONNECT_SUPPORTED_METRICS };
  }

  async requestPermissions(permissions: readonly HealthPermission[]): Promise<PermissionResult> {
    const recordTypes = recordTypesFor(permissions);
    const grantedPermissions = await requestPermission(
      recordTypes.map((recordType) => ({ accessType: "read" as const, recordType })),
    );
    const grantedRecordTypes = new Set(grantedPermissions.map((p) => p.recordType as string));

    const granted: HealthPermission[] = [];
    const denied: HealthPermission[] = [];
    for (const permission of permissions) {
      // `?? ""`: a permission with no Health Connect mapping at all (walking_heart_rate) is
      // never granted -- no real RecordType value can equal the empty-string sentinel, so
      // this always denies it rather than needing a separate undefined-check branch.
      const target = grantedRecordTypes.has(METRIC_TO_RECORD_TYPE[permission] ?? "") ? granted : denied;
      target.push(permission);
    }

    return { granted, denied };
  }

  async sync(request: SyncRequest): Promise<SyncResult> {
    const requested = new Set<HealthMetricType>(request.metricTypes);
    const recordTypesToFetch = recordTypesFor(request.metricTypes);
    const timeRangeFilter = buildTimeRangeFilter(request.since, new Date());

    const observations: SyncedObservation[] = [];
    for (const recordType of recordTypesToFetch) {
      observations.push(...(await this.readAndMap(recordType, timeRangeFilter)));
    }

    return {
      observations: observations.filter((o) => requested.has(o.metricType)),
      syncedAt: new Date(),
    };
  }

  /** One case per entry in `METRIC_TO_RECORD_TYPE` -- a switch, not a generic dispatch table,
   *  so each branch's `readRecords` call and mapping function stay type-checked against the
   *  same literal `RecordType`, which a table keyed by a union type cannot express as safely. */
  private async readAndMap(recordType: RecordType, timeRangeFilter: TimeRangeFilter): Promise<SyncedObservation[]> {
    switch (recordType) {
      case "HeartRate": {
        const { records } = await readRecords("HeartRate", { timeRangeFilter });
        return records.flatMap(mapHeartRateRecord);
      }
      case "HeartRateVariabilityRmssd": {
        const { records } = await readRecords("HeartRateVariabilityRmssd", { timeRangeFilter });
        return records.flatMap(mapHrvRecord);
      }
      case "RestingHeartRate": {
        const { records } = await readRecords("RestingHeartRate", { timeRangeFilter });
        return records.flatMap(mapRestingHeartRateRecord);
      }
      case "Steps": {
        const { records } = await readRecords("Steps", { timeRangeFilter });
        return records.flatMap(mapStepsRecord);
      }
      case "ActiveCaloriesBurned": {
        const { records } = await readRecords("ActiveCaloriesBurned", { timeRangeFilter });
        return records.flatMap(mapActiveEnergyRecord);
      }
      case "Weight": {
        const { records } = await readRecords("Weight", { timeRangeFilter });
        return records.flatMap(mapWeightRecord);
      }
      case "Vo2Max": {
        const { records } = await readRecords("Vo2Max", { timeRangeFilter });
        return records.flatMap(mapVo2MaxRecord);
      }
      case "RespiratoryRate": {
        const { records } = await readRecords("RespiratoryRate", { timeRangeFilter });
        return records.flatMap(mapRespiratoryRateRecord);
      }
      case "SleepSession": {
        const { records } = await readRecords("SleepSession", { timeRangeFilter });
        return records.flatMap(mapSleepSessionRecord);
      }
      default:
        // Unreachable: recordTypesFor only ever returns a value from METRIC_TO_RECORD_TYPE,
        // and every entry there is one of the cases above.
        return [];
    }
  }
}
