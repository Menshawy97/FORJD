import { runHealthProviderContractTests } from "@forjd/domain";

import recoveryFixture from "./__fixtures__/recovery.json";
import sleepFixture from "./__fixtures__/sleep.json";
import workoutFixture from "./__fixtures__/workout.json";
import { WhoopProvider } from "./whoop.provider";
import type { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { WhoopClient } from "./whoop-client";
import type { WhoopOAuthService } from "./whoop-oauth.service";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";

/**
 * `WhoopProvider` is the second concrete `HealthProvider` (`HealthConnectProvider`, Phase
 * 6F, was the first) -- run against the exact same shared contract suite
 * (`@forjd/domain`'s `runHealthProviderContractTests`) to prove it genuinely satisfies the
 * interface, not just its own idea of it.
 *
 * The fake `TokenCipher` here is intentionally trivial (identity, tagged with a fixed key
 * version) -- `token-cipher.ts` already has its own exhaustive spec; this file's job is to
 * prove `WhoopProvider` calls encrypt/decrypt at the right moments, not to re-test AES-GCM.
 */

function makeFakeCipher(): TokenCipher {
  return {
    encrypt: (plaintext: string) => ({ ciphertext: plaintext, keyVersion: 1 }),
    decrypt: (encrypted) => encrypted.ciphertext,
  };
}

function makeFakeRepository(initial?: Partial<WhoopConnectionRow>): WhoopConnectionRepository {
  let row: WhoopConnectionRow | null = initial
    ? {
        id: "conn-1",
        userId: "user-1",
        status: "connected",
        externalUserId: "whoop-user-1",
        encryptedAccessToken: "valid-access-token",
        encryptedRefreshToken: "valid-refresh-token",
        tokenKeyVersion: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: "read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline",
        lastSyncAt: null,
        ...initial,
      }
    : null;

  return {
    findByUserId: jest.fn(async () => row),
    upsertTokens: jest.fn(async (_userId, input) => {
      row = { id: "conn-1", userId: "user-1", lastSyncAt: row?.lastSyncAt ?? null, ...input };
    }),
    updateLastSyncAt: jest.fn(async (_userId, at) => {
      if (row) row = { ...row, lastSyncAt: at };
    }),
    updateStatus: jest.fn(async (_userId, status) => {
      if (row) row = { ...row, status };
    }),
    clearTokens: jest.fn(async () => {
      if (row) row = { ...row, status: "disconnected", encryptedAccessToken: "", encryptedRefreshToken: null, expiresAt: null, scopes: null };
    }),
  } as unknown as WhoopConnectionRepository;
}

function makeFakeClient(overrides: Partial<WhoopClient> = {}): WhoopClient {
  return {
    exchangeAuthorizationCode: jest.fn(),
    refreshAccessToken: jest.fn().mockResolvedValue({
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
      expires_in: 3600,
      scope: "read:recovery offline",
    }),
    getRecovery: jest.fn(),
    getSleep: jest.fn(),
    getWorkout: jest.fn(),
    getProfile: jest.fn(),
    listRecovery: jest.fn().mockResolvedValue([recoveryFixture]),
    listSleep: jest.fn().mockResolvedValue([sleepFixture]),
    listWorkout: jest.fn().mockResolvedValue([workoutFixture]),
    revokeToken: jest.fn(),
    ...overrides,
  };
}

function makeProvider(overrides: { repository?: WhoopConnectionRepository; client?: WhoopClient } = {}): WhoopProvider {
  const repository = overrides.repository ?? makeFakeRepository({});
  const client = overrides.client ?? makeFakeClient();
  const oauthService = { refresh: client.refreshAccessToken } as unknown as WhoopOAuthService;
  return new WhoopProvider("user-1", repository, oauthService, client, makeFakeCipher());
}

runHealthProviderContractTests("WhoopProvider", () => makeProvider());

describe("WhoopProvider", () => {
  describe("connect", () => {
    it("throws when the user has no WHOOP connection at all", async () => {
      const provider = makeProvider({ repository: makeFakeRepository(undefined) });
      await expect(provider.connect()).rejects.toThrow(/not connected/i);
    });

    it("does nothing when the stored access token is not close to expiry", async () => {
      const client = makeFakeClient();
      const provider = makeProvider({ client });
      await provider.connect();
      expect(client.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("refreshes and persists new tokens when the stored token is expired", async () => {
      const client = makeFakeClient();
      const repository = makeFakeRepository({ expiresAt: new Date(Date.now() - 1000) });
      const provider = makeProvider({ repository, client });

      await provider.connect();

      expect(client.refreshAccessToken).toHaveBeenCalledWith("valid-refresh-token");
      expect(repository.upsertTokens).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ status: "connected", encryptedAccessToken: "refreshed-access-token" }),
      );
    });

    it("marks the connection expired and rethrows when a refresh attempt itself fails", async () => {
      const client = makeFakeClient({ refreshAccessToken: jest.fn().mockRejectedValue(new Error("invalid_grant")) });
      const repository = makeFakeRepository({ expiresAt: new Date(Date.now() - 1000) });
      const provider = makeProvider({ repository, client });

      await expect(provider.connect()).rejects.toThrow("invalid_grant");
      expect(repository.updateStatus).toHaveBeenCalledWith("user-1", "expired");
    });

    it("marks the connection expired and throws a clear error when there is no refresh token to renew with", async () => {
      const repository = makeFakeRepository({ expiresAt: new Date(Date.now() - 1000), encryptedRefreshToken: null });
      const provider = makeProvider({ repository });

      await expect(provider.connect()).rejects.toThrow(/no refresh token/i);
      expect(repository.updateStatus).toHaveBeenCalledWith("user-1", "expired");
    });
  });

  describe("disconnect", () => {
    it("revokes the grant at WHOOP before wiping the stored tokens", async () => {
      const repository = makeFakeRepository({});
      const client = makeFakeClient();
      const provider = makeProvider({ repository, client });

      await provider.disconnect();

      expect(client.revokeToken).toHaveBeenCalledWith("valid-access-token");
      expect(repository.clearTokens).toHaveBeenCalledWith("user-1");
    });

    it("still wipes the local tokens when the revoke call itself fails", async () => {
      const repository = makeFakeRepository({});
      const client = makeFakeClient({ revokeToken: jest.fn().mockRejectedValue(new Error("WHOOP is down")) });
      const provider = makeProvider({ repository, client });

      await expect(provider.disconnect()).resolves.not.toThrow();
      expect(repository.clearTokens).toHaveBeenCalledWith("user-1");
    });

    it("resolves without throwing even with no connection to disconnect", async () => {
      const provider = makeProvider({ repository: makeFakeRepository(undefined) });
      await expect(provider.disconnect()).resolves.not.toThrow();
    });
  });

  describe("requestPermissions", () => {
    it("grants only the metrics the connection's stored scopes actually cover", async () => {
      const repository = makeFakeRepository({ scopes: "read:recovery offline" });
      const provider = makeProvider({ repository });

      const result = await provider.requestPermissions(["hrv", "resting_heart_rate", "active_energy"]);

      expect(result.granted).toEqual(["hrv", "resting_heart_rate"]);
      expect(result.denied).toEqual(["active_energy"]);
    });

    it("denies every metric when there is no connection", async () => {
      const provider = makeProvider({ repository: makeFakeRepository(undefined) });
      const result = await provider.requestPermissions(["hrv"]);
      expect(result).toEqual({ granted: [], denied: ["hrv"] });
    });
  });

  describe("sync", () => {
    it("only calls the endpoints whose metrics were actually requested", async () => {
      const client = makeFakeClient();
      const provider = makeProvider({ client });

      await provider.sync({ metricTypes: ["active_energy"], since: null });

      expect(client.listWorkout).toHaveBeenCalled();
      expect(client.listRecovery).not.toHaveBeenCalled();
      expect(client.listSleep).not.toHaveBeenCalled();
    });

    it("maps recovery, sleep, and workout records into one flat observation list", async () => {
      const provider = makeProvider();

      const result = await provider.sync({
        metricTypes: ["hrv", "resting_heart_rate", "sleep_duration", "active_energy"],
        since: null,
      });

      const metricTypes = result.observations.map((o) => o.metricType).sort();
      expect(metricTypes).toEqual(["active_energy", "hrv", "resting_heart_rate", "sleep_duration"]);
    });

    it("passes request.since straight through to the client as the incremental checkpoint", async () => {
      const client = makeFakeClient();
      const provider = makeProvider({ client });
      const since = new Date("2026-09-01T00:00:00Z");

      await provider.sync({ metricTypes: ["hrv"], since });

      expect(client.listRecovery).toHaveBeenCalledWith(since, "valid-access-token");
    });
  });
});
