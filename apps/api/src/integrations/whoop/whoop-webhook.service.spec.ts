import recoveryFixture from "./__fixtures__/recovery.json";
import sleepFixture from "./__fixtures__/sleep.json";
import workoutFixture from "./__fixtures__/workout.json";
import { WhoopWebhookService } from "./whoop-webhook.service";
import type { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { WhoopClient } from "./whoop-client";
import type { WhoopOAuthService } from "./whoop-oauth.service";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";
import type { HealthDataRepository } from "../../health-data/health-data.repository";

/**
 * The webhook path is push-driven with an exact record identity (WHOOP names one changed
 * `id`), unlike `WhoopProvider.sync()`'s bulk pull -- so it goes straight to `WhoopClient` +
 * `whoop-record-mapping.ts` rather than through the `HealthProvider` interface, per
 * `docs/product/phase-7-plan.md` decision B.
 */
describe("WhoopWebhookService", () => {
  const connectedRow: WhoopConnectionRow = {
    id: "conn-1",
    userId: "internal-user-1",
    status: "connected",
    externalUserId: "10129",
    encryptedAccessToken: "valid-access-token",
    encryptedRefreshToken: "valid-refresh-token",
    tokenKeyVersion: 1,
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: "read:recovery read:sleep read:workout offline",
    lastSyncAt: null,
  };

  function makeService(overrides: {
    connections?: Partial<WhoopConnectionRepository>;
    client?: Partial<WhoopClient>;
    healthData?: Partial<HealthDataRepository>;
  } = {}) {
    const connections = {
      findByExternalUserId: jest.fn().mockResolvedValue(connectedRow),
      findByUserId: jest.fn().mockResolvedValue(connectedRow),
      ...overrides.connections,
    } as unknown as WhoopConnectionRepository;

    const client = {
      getRecovery: jest.fn().mockResolvedValue(recoveryFixture),
      getSleep: jest.fn().mockResolvedValue(sleepFixture),
      getWorkout: jest.fn().mockResolvedValue(workoutFixture),
      ...overrides.client,
    } as unknown as WhoopClient;

    const oauth = {} as WhoopOAuthService;
    const cipher: TokenCipher = {
      encrypt: (p) => ({ ciphertext: p, keyVersion: 1 }),
      decrypt: (e) => e.ciphertext,
    };

    const healthData = {
      ingestObservations: jest.fn().mockResolvedValue(undefined),
      ...overrides.healthData,
    } as unknown as HealthDataRepository;

    return { service: new WhoopWebhookService(connections, oauth, client, cipher, healthData), connections, client, healthData };
  }

  it("ignores an event for a WHOOP user id with no known connection", async () => {
    const { service, client, healthData } = makeService({
      connections: { findByExternalUserId: jest.fn().mockResolvedValue(null) },
    });

    await service.processEvent({ user_id: 999, id: "x", type: "recovery.updated", trace_id: "t1" });

    expect(client.getRecovery).not.toHaveBeenCalled();
    expect(healthData.ingestObservations).not.toHaveBeenCalled();
  });

  it("fetches and ingests a recovery.updated event", async () => {
    const { service, client, healthData } = makeService();

    await service.processEvent({ user_id: 10129, id: "93845", type: "recovery.updated", trace_id: "t1" });

    expect(client.getRecovery).toHaveBeenCalledWith("93845", "valid-access-token");
    expect(healthData.ingestObservations).toHaveBeenCalledWith(
      "internal-user-1",
      expect.arrayContaining([expect.objectContaining({ metricType: "hrv", source: "whoop" })]),
    );
  });

  it("fetches and ingests a sleep.updated event", async () => {
    const { service, client, healthData } = makeService();

    await service.processEvent({
      user_id: 10129,
      id: "3e3f7c8a-1b2d-4e5f-9a0b-1c2d3e4f5a6b",
      type: "sleep.updated",
      trace_id: "t2",
    });

    expect(client.getSleep).toHaveBeenCalledWith("3e3f7c8a-1b2d-4e5f-9a0b-1c2d3e4f5a6b", "valid-access-token");
    expect(healthData.ingestObservations).toHaveBeenCalledWith(
      "internal-user-1",
      expect.arrayContaining([expect.objectContaining({ metricType: "sleep_duration", source: "whoop" })]),
    );
  });

  it("fetches and ingests a workout.updated event", async () => {
    const { service, client, healthData } = makeService();

    await service.processEvent({
      user_id: 10129,
      id: "8f4e2d1c-6b5a-4d3e-8c1b-2a3d4e5f6a7b",
      type: "workout.updated",
      trace_id: "t3",
    });

    expect(client.getWorkout).toHaveBeenCalledWith("8f4e2d1c-6b5a-4d3e-8c1b-2a3d4e5f6a7b", "valid-access-token");
    expect(healthData.ingestObservations).toHaveBeenCalledWith(
      "internal-user-1",
      expect.arrayContaining([expect.objectContaining({ metricType: "active_energy", source: "whoop" })]),
    );
  });

  it("acknowledges a *.deleted event without ingesting anything -- deletion is not built yet", async () => {
    const { service, client, healthData } = makeService();

    await service.processEvent({ user_id: 10129, id: "93845", type: "recovery.deleted", trace_id: "t4" });

    expect(client.getRecovery).not.toHaveBeenCalled();
    expect(healthData.ingestObservations).not.toHaveBeenCalled();
  });

  it("ignores an event type this integration does not recognize, without fetching anything", async () => {
    const { service, client, healthData } = makeService();

    await service.processEvent({ user_id: 10129, id: "x", type: "body_measurement.updated", trace_id: "t6" });

    expect(client.getRecovery).not.toHaveBeenCalled();
    expect(client.getSleep).not.toHaveBeenCalled();
    expect(client.getWorkout).not.toHaveBeenCalled();
    expect(healthData.ingestObservations).not.toHaveBeenCalled();
  });

  it("does not ingest anything when the fetched record has not scored yet", async () => {
    const { service, healthData } = makeService({
      client: { getRecovery: jest.fn().mockResolvedValue({ ...recoveryFixture, score_state: "PENDING_SCORE", score: undefined }) },
    });

    await service.processEvent({ user_id: 10129, id: "93845", type: "recovery.updated", trace_id: "t5" });

    expect(healthData.ingestObservations).not.toHaveBeenCalled();
  });
});
