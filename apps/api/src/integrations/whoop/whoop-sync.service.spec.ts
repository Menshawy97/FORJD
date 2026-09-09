import { WhoopSyncService } from "./whoop-sync.service";
import type { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { WhoopProviderFactory } from "./whoop-provider.factory";
import type { HealthDataRepository } from "../../health-data/health-data.repository";
import type { HealthProvider } from "@forjd/domain";

/**
 * The sync orchestrator `health-provider.ts`'s own docblock names as "not yet built" --
 * built here for WHOOP specifically. Asks the provider what it supports rather than
 * hardcoding a metric list, so a future capability change needs no change here.
 */
describe("WhoopSyncService", () => {
  const connectedRow: WhoopConnectionRow = {
    id: "conn-1",
    userId: "user-1",
    status: "connected",
    externalUserId: "10129",
    encryptedAccessToken: "at",
    encryptedRefreshToken: "rt",
    tokenKeyVersion: 1,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: "offline",
    lastSyncAt: new Date("2026-09-01T00:00:00Z"),
  };

  function makeService(overrides: { connections?: Partial<WhoopConnectionRepository>; provider?: Partial<HealthProvider> } = {}) {
    const connections = {
      findByUserId: jest.fn().mockResolvedValue(connectedRow),
      updateLastSyncAt: jest.fn().mockResolvedValue(undefined),
      ...overrides.connections,
    } as unknown as WhoopConnectionRepository;

    const provider = {
      source: "whoop",
      getCapabilities: jest.fn().mockResolvedValue({ source: "whoop", supportedMetrics: ["hrv", "resting_heart_rate"] }),
      sync: jest.fn().mockResolvedValue({
        observations: [
          {
            metricType: "hrv",
            value: 60,
            unit: "ms",
            startTime: new Date(),
            endTime: new Date(),
            providerRecordId: "1",
            deviceId: null,
            quality: null,
          },
        ],
        syncedAt: new Date("2026-09-08T12:00:00Z"),
      }),
      ...overrides.provider,
    } as HealthProvider;

    const providerFactory = { forUser: jest.fn().mockReturnValue(provider) } as unknown as WhoopProviderFactory;
    const healthData = { ingestObservations: jest.fn().mockResolvedValue(undefined) } as unknown as HealthDataRepository;

    return { service: new WhoopSyncService(connections, healthData, providerFactory), connections, provider, healthData };
  }

  it("throws when the user has no WHOOP connection", async () => {
    const { service } = makeService({ connections: { findByUserId: jest.fn().mockResolvedValue(null) } });
    await expect(service.syncUser("user-1")).rejects.toThrow(/not connected/i);
  });

  it("syncs using the provider's own declared capabilities as metricTypes, since the stored checkpoint", async () => {
    const { service, provider } = makeService();

    await service.syncUser("user-1");

    expect(provider.sync).toHaveBeenCalledWith({
      metricTypes: ["hrv", "resting_heart_rate"],
      since: connectedRow.lastSyncAt,
    });
  });

  it("ingests the returned observations tagged with source: whoop", async () => {
    const { service, healthData } = makeService();

    await service.syncUser("user-1");

    expect(healthData.ingestObservations).toHaveBeenCalledWith(
      "user-1",
      expect.arrayContaining([expect.objectContaining({ metricType: "hrv", source: "whoop" })]),
    );
  });

  it("advances the checkpoint to the sync's own syncedAt", async () => {
    const { service, connections } = makeService();

    await service.syncUser("user-1");

    expect(connections.updateLastSyncAt).toHaveBeenCalledWith("user-1", new Date("2026-09-08T12:00:00Z"));
  });

  it("skips ingestion but still advances the checkpoint when nothing new was returned", async () => {
    const { service, healthData, connections } = makeService({
      provider: { sync: jest.fn().mockResolvedValue({ observations: [], syncedAt: new Date("2026-09-08T13:00:00Z") }) },
    });

    const result = await service.syncUser("user-1");

    expect(healthData.ingestObservations).not.toHaveBeenCalled();
    expect(connections.updateLastSyncAt).toHaveBeenCalledWith("user-1", new Date("2026-09-08T13:00:00Z"));
    expect(result).toEqual({ observationCount: 0 });
  });
});
