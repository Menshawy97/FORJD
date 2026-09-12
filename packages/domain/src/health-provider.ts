import type { HealthMetricType, HealthSource } from "./health-vocabulary";

/**
 * `HealthProvider` -- verbatim from `docs/architecture/integrations.md` / ADR-003, the
 * interface every external health/fitness source is reached through. The workout engine and
 * analytics never call a provider SDK directly (CLAUDE.md rule 3). `HealthConnectProvider`
 * (`apps/mobile/src/integrations/health/`, Phase 6F) is the first concrete implementation;
 * `WhoopProvider` (`apps/api/src/integrations/whoop/`, Phase 7) is the second.
 *
 * Moved here from `apps/mobile/src/integrations/health/health-provider.interface.ts` in
 * Phase 7C -- a mechanical relocation with no behaviour change. WHOOP's concrete
 * implementation is server-side (`docs/product/phase-7-plan.md`, decision 2: WHOOP's client
 * secret never reaches the mobile bundle), so the interface itself has to live somewhere
 * both `apps/api` and `apps/mobile` can implement it from -- the shared domain package, not
 * either app. This is also correct on principle independent of Phase 7: the provider
 * abstraction is one of `CLAUDE.md`'s four architecturally-critical pillars, so its
 * definition belongs in `@forjd/domain` alongside the canonical health model it serves, not
 * inside one particular app.
 *
 * Permissions and sync results are typed against this same package's `HealthMetricType` /
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
 * neither. The contract-test suite (`health-provider-contract.ts`) enforces this on any
 * implementation, since a permission a caller can't classify either way is one the sync
 * orchestrator cannot safely act on.
 */
export interface PermissionResult {
  granted: readonly HealthPermission[];
  denied: readonly HealthPermission[];
}

/** `since: null` requests a full sync (no checkpoint yet); a `Date` requests only readings at
 *  or after it, mirroring the `last_successful_sync_at` / `last_sync_at` checkpoint
 *  `health-data.md`'s ingestion pipeline and the `health_connections` / `external_connections`
 *  schemas already commit to. */
export interface SyncRequest {
  metricTypes: readonly HealthMetricType[];
  since: Date | null;
}

/**
 * One reading a provider's `sync()` returned, in this package's canonical units already
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
  /**
   * Metric types this sync could not read -- a permission revoked for one record type, say --
   * reported alongside whatever DID succeed rather than discarding the whole sync (H7). Omitted
   * entirely when nothing failed, so a provider that never fails per-metric (the common case)
   * need not thread an always-empty array through every caller.
   */
  failedMetricTypes?: readonly HealthMetricType[];
}

export interface HealthProvider {
  readonly source: HealthSource;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<ProviderCapabilities>;
  requestPermissions(permissions: readonly HealthPermission[]): Promise<PermissionResult>;
  sync(request: SyncRequest): Promise<SyncResult>;
}
