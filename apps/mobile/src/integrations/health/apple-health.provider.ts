import type {
  HealthMetricType,
  HealthPermission,
  HealthProvider,
  HealthSource,
  PermissionResult,
  ProviderCapabilities,
  SyncedObservation,
  SyncRequest,
  SyncResult,
} from "@forjd/domain";
import {
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";

import {
  APPLE_HEALTH_SUPPORTED_METRICS,
  QUANTITY_READS,
  SLEEP_ANALYSIS,
  mapQuantitySample,
  mapSleepSample,
  readTypeFor,
  readTypesFor,
  type AppleCategorySample,
  type AppleQuantitySample,
} from "./apple-health-sample-mapping";

// The library types its identifiers as string literal unions; the mapping keeps them as plain strings
// so it needs no runtime import from the library. These are the call signatures as this file uses them.
type QueryQuantity = (identifier: string, options: object) => Promise<readonly AppleQuantitySample[]>;
type QueryCategory = (identifier: string, options: object) => Promise<readonly AppleCategorySample[]>;
type RequestRead = (request: { toRead: readonly string[] }) => Promise<boolean>;
type RequestStatus = (request: { toRead: readonly string[] }) => Promise<number>;

/** `AuthorizationRequestStatus.unnecessary`: HealthKit has already shown the sheet for these types. */
const ALREADY_REQUESTED = 2;

/** HealthKit's "no limit": every sample in the window (the library's documented meaning of 0). */
const ALL_SAMPLES = 0;

/**
 * The iPhone `HealthProvider` (ADR-068), behind `@kingstinct/react-native-healthkit`. CLAUDE.md
 * rule 17's iPhone counterpart: only `integrations/health/` imports the library, and every reading is
 * recorded as `apple_health` explicitly.
 *
 * **Merged switched off (ADR-069).** `getDeviceHealthProvider()` returns it only when the build has
 * `APPLE_HEALTH_ENABLED`, which no profile sets until it has run on a physical iPhone (rule 16).
 *
 * Read only, while the app is open: no write access and no background delivery are asked for.
 * HealthKit never says whether a read was refused (Apple hides it, so an app cannot infer what a
 * person has), so once the permission sheet has been shown every requested metric counts as granted,
 * and a refusal reads as no data. A type is only ever read after it has been requested: reading an
 * unrequested type crashes the app (the library's README; ADR-068, check 4). "Requested" is what
 * HealthKit itself remembers across launches, not only this instance: the run screen asks once, on
 * the first run, and builds a new provider for every run (run-health.ts).
 */
export class AppleHealthProvider implements HealthProvider {
  readonly source: HealthSource = "apple_health";

  /** Metrics whose HealthKit type has been requested in this session; nothing else is read. */
  private requested: ReadonlySet<HealthMetricType> = new Set();

  async connect(): Promise<void> {
    if (!isHealthDataAvailable()) {
      throw new Error("Apple Health is not available on this device");
    }
  }

  /** Access is turned off in the Health app (Settings, Health, Data Access), not by an app call. */
  async disconnect(): Promise<void> {}

  async getCapabilities(): Promise<ProviderCapabilities> {
    return { source: this.source, supportedMetrics: APPLE_HEALTH_SUPPORTED_METRICS };
  }

  async requestPermissions(permissions: readonly HealthPermission[]): Promise<PermissionResult> {
    const supported = permissions.filter((permission) => readTypeFor(permission) !== undefined);
    const unsupported = permissions.filter((permission) => readTypeFor(permission) === undefined);
    if (supported.length === 0) return { granted: [], denied: unsupported };
    try {
      await (requestAuthorization as unknown as RequestRead)({ toRead: readTypesFor(supported) });
    } catch {
      return { granted: [], denied: [...permissions] };
    }
    this.requested = new Set([...this.requested, ...supported]);
    return { granted: supported, denied: unsupported };
  }

  async sync(request: SyncRequest): Promise<SyncResult> {
    const asked = await this.alreadyRequested(request.metricTypes);
    const readable = request.metricTypes.filter((metric) => asked.has(metric));
    const failedMetricTypes = request.metricTypes.filter((metric) => !asked.has(metric));
    const date = { ...(request.since ? { startDate: request.since } : {}), endDate: new Date() };
    const observations: SyncedObservation[] = [];

    for (const metric of readable.filter((m) => QUANTITY_READS[m] !== undefined)) {
      try {
        observations.push(...(await this.readQuantity(metric, date)));
      } catch {
        // One failed type (H7) must not discard what the others returned.
        failedMetricTypes.push(metric);
      }
    }

    const sleepMetrics = readable.filter((metric) => readTypeFor(metric) === SLEEP_ANALYSIS);
    if (sleepMetrics.length > 0) {
      try {
        const wanted = new Set(sleepMetrics);
        observations.push(...(await this.readSleep(date)).filter((o) => wanted.has(o.metricType)));
      } catch {
        failedMetricTypes.push(...sleepMetrics);
      }
    }

    return {
      observations,
      syncedAt: new Date(),
      ...(failedMetricTypes.length > 0 ? { failedMetricTypes } : {}),
    };
  }

  /**
   * The metrics HealthKit has already been asked about: those requested by this instance, plus those
   * whose type HealthKit reports as requested before (an earlier run or launch). Checked per type, so
   * one unasked type never blocks the others; a failed check counts as not asked, never as a read.
   */
  private async alreadyRequested(metrics: readonly HealthMetricType[]): Promise<ReadonlySet<HealthMetricType>> {
    const asked = new Set(metrics.filter((metric) => this.requested.has(metric)));
    const unknownTypes = readTypesFor(metrics.filter((metric) => !asked.has(metric)));
    for (const type of unknownTypes) {
      const status = await (getRequestStatusForAuthorization as unknown as RequestStatus)({ toRead: [type] }).catch(
        () => null,
      );
      if (status !== ALREADY_REQUESTED) continue;
      metrics.filter((metric) => readTypeFor(metric) === type).forEach((metric) => asked.add(metric));
    }
    this.requested = new Set([...this.requested, ...asked]);
    return asked;
  }

  private async readQuantity(metric: HealthMetricType, date: object): Promise<SyncedObservation[]> {
    const read = QUANTITY_READS[metric];
    if (!read) return [];
    const samples = await (queryQuantitySamples as unknown as QueryQuantity)(read.identifier, {
      limit: ALL_SAMPLES,
      unit: read.unit,
      ascending: true,
      filter: { date },
    });
    return samples
      .map((sample) => mapQuantitySample(metric, sample))
      .filter((o): o is SyncedObservation => o !== null);
  }

  private async readSleep(date: object): Promise<SyncedObservation[]> {
    const samples = await (queryCategorySamples as unknown as QueryCategory)(SLEEP_ANALYSIS, {
      limit: ALL_SAMPLES,
      ascending: true,
      filter: { date },
    });
    return samples.flatMap(mapSleepSample);
  }
}
