import {
  HEALTH_METRIC_TYPES,
  type HealthMetricType,
  type HealthSource,
  type HealthProvider,
  type PermissionResult,
  type ProviderCapabilities,
  type SyncedObservation,
  type SyncRequest,
  type SyncResult,
} from "@forjd/domain";

export interface FakeHealthProviderOptions {
  source?: HealthSource;
  supportedMetrics?: readonly HealthMetricType[];
  observations?: readonly SyncedObservation[];
}

/**
 * In-memory `HealthProvider`, with no native dependency -- (a) proves
 * `@forjd/domain`'s `health-provider-contract.ts` actually catches a real violation of its
 * own rules, and (b)
 * is what any screen/hook that consumes a `HealthProvider` can be tested against before
 * `HealthConnectProvider` (Phase 6F, device-gated) exists.
 *
 * `sync` only returns an observation once its metric type has been granted via
 * `requestPermissions` -- mirroring how a real provider like Health Connect actually behaves
 * (data for an ungranted permission is simply not readable), which is also what exercises the
 * contract suite's "sync only returns declared-supported metric types" rule meaningfully
 * rather than vacuously.
 */
export class FakeHealthProvider implements HealthProvider {
  readonly source: HealthSource;
  private readonly supportedMetrics: readonly HealthMetricType[];
  private readonly observations: readonly SyncedObservation[];
  private readonly granted = new Set<HealthMetricType>();

  constructor(options: FakeHealthProviderOptions = {}) {
    this.source = options.source ?? "health_connect";
    this.supportedMetrics = options.supportedMetrics ?? HEALTH_METRIC_TYPES;
    this.observations = options.observations ?? [];
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {
    this.granted.clear();
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return { source: this.source, supportedMetrics: this.supportedMetrics };
  }

  async requestPermissions(permissions: readonly HealthMetricType[]): Promise<PermissionResult> {
    const granted: HealthMetricType[] = [];
    const denied: HealthMetricType[] = [];

    for (const permission of permissions) {
      if (this.supportedMetrics.includes(permission)) {
        this.granted.add(permission);
        granted.push(permission);
      } else {
        denied.push(permission);
      }
    }

    return { granted, denied };
  }

  async sync(request: SyncRequest): Promise<SyncResult> {
    const observations = this.observations.filter(
      (o) =>
        request.metricTypes.includes(o.metricType) &&
        this.granted.has(o.metricType) &&
        (request.since === null || o.startTime.getTime() >= request.since.getTime()),
    );

    return { observations, syncedAt: new Date() };
  }
}
