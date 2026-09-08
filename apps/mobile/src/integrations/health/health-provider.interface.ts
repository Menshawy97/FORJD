import type { HealthMetricType, HealthSource } from "@forjd/domain";

/**
 * `HealthProvider` -- verbatim from `docs/architecture/integrations.md` / ADR-003, the
 * interface every external health/fitness source is reached through. The workout engine and
 * analytics never call a provider SDK directly (CLAUDE.md rule 3); `HealthConnectProvider`
 * (Phase 6F, not this file) will be the first concrete implementation, followed by
 * `WhoopProvider` (Phase 7) and `AppleHealthProvider` (Phase 11).
 *
 * Permissions and sync results are typed against `@forjd/domain`'s `HealthMetricType` /
 * `HealthSource` tuples -- the same closed vocabulary the API's `health-data` module already
 * validates against (6C's contracts), so a provider adapter cannot invent a metric type the
 * backend would reject.
 */

/** Requesting a permission is requesting read access to one canonical metric type -- there
 *  is no permission granularity finer or coarser than a `HealthMetricType` today. */
export type HealthPermission = HealthMetricType;

/**
 * What one provider instance can actually supply, per ADR-003's "shaped by the union of
 * providers, not the first one" rule -- a provider missing a metric (e.g. a WHOOP account
 * with no VO2 max data) reports that here rather than the interface assuming every provider
 * supports every metric.
 */
export interface ProviderCapabilities {
  source: HealthSource;
  supportedMetrics: readonly HealthMetricType[];
}

/**
 * Every requested permission ends up in exactly one of these two lists -- never both, never
 * neither. The contract-test suite (`health-provider.contract.ts`) enforces this on any
 * implementation, since a permission a caller can't classify either way is one the sync
 * orchestrator (not yet built) cannot safely act on.
 */
export interface PermissionResult {
  granted: readonly HealthPermission[];
  denied: readonly HealthPermission[];
}

/** `since: null` requests a full sync (no checkpoint yet); a `Date` requests only readings at
 *  or after it, mirroring the `last_successful_sync_at` checkpoint `health-data.md`'s
 *  ingestion pipeline and 6B's `health_connections` schema already commit to. */
export interface SyncRequest {
  metricTypes: readonly HealthMetricType[];
  since: Date | null;
}

/**
 * One reading a provider's `sync()` returned, in `@forjd/domain`'s canonical units already
 * (ADR-003/ADR-004: normalization is the adapter's job, not the caller's). Deliberately has
 * no `source` field -- the provider that produced this `SyncResult` has exactly one source
 * (its own `HealthProvider.source`), so the sync orchestrator that eventually calls
 * `POST /health-data/observations` attaches `source` once, from the provider, rather than
 * every observation repeating a value that cannot vary within one sync.
 */
export interface SyncedObservation {
  metricType: HealthMetricType;
  value: number;
  unit: string;
  startTime: Date;
  endTime: Date;
  providerRecordId: string | null;
  deviceId: string | null;
  quality: number | null;
}

export interface SyncResult {
  observations: readonly SyncedObservation[];
  syncedAt: Date;
}

export interface HealthProvider {
  readonly source: HealthSource;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<ProviderCapabilities>;
  requestPermissions(permissions: readonly HealthPermission[]): Promise<PermissionResult>;
  sync(request: SyncRequest): Promise<SyncResult>;
}
