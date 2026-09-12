import { ConfigService } from "@nestjs/config";

import { createWhoopClient, whoopClientProvider } from "./whoop-client";

/**
 * `createWhoopClient` is the one place this repo makes an HTTP call to WHOOP -- retried up
 * to 3 times on a network error or a 5xx (the existing convention from
 * `openai-vision.provider.ts`), but NOT on a 4xx: retrying a rejected token or a malformed
 * request three times wastes calls and hides what is actually a real, non-transient failure.
 * `fetchImpl` is injected so these tests never touch the network, mirroring how every other
 * third-party client in this codebase is made testable (ADR-011).
 */
describe("whoop-client", () => {
  const clientId = "test-client-id";
  const clientSecret = "test-client-secret";

  const jsonResponse = (body: unknown, ok = true, status = 200) =>
    ({
      ok,
      status,
      json: () => Promise.resolve(body),
    }) as Response;

  describe("exchangeAuthorizationCode", () => {
    it("POSTs the standard OAuth2 authorization_code grant and returns the token response", async () => {
      const tokenResponse = { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "read:recovery offline" };
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(tokenResponse));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const result = await client.exchangeAuthorizationCode("auth-code-123", "forjd://whoop-callback");

      expect(result).toEqual(tokenResponse);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://api.prod.whoop.com/oauth/oauth2/token");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-123");
      expect(body.get("redirect_uri")).toBe("forjd://whoop-callback");
      expect(body.get("client_id")).toBe(clientId);
      expect(body.get("client_secret")).toBe(clientSecret);
    });
  });

  describe("refreshAccessToken", () => {
    it("POSTs the refresh_token grant with the offline scope", async () => {
      const tokenResponse = { access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "offline" };
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(tokenResponse));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const result = await client.refreshAccessToken("old-refresh-token");

      expect(result).toEqual(tokenResponse);
      const [, init] = fetchImpl.mock.calls[0];
      const body = new URLSearchParams(init.body as string);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh-token");
      expect(body.get("scope")).toBe("offline");
    });
  });

  describe("revokeToken", () => {
    it("POSTs the OAuth2 revocation request with the access token", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await client.revokeToken("access-token-to-revoke");

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://api.prod.whoop.com/oauth/oauth2/revoke");
      expect(init.method).toBe("POST");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("token")).toBe("access-token-to-revoke");
      expect(body.get("client_id")).toBe(clientId);
      expect(body.get("client_secret")).toBe(clientSecret);
    });
  });

  describe("getRecovery / getSleep / getWorkout", () => {
    it("GETs the recovery-by-cycle-id endpoint with a bearer token", async () => {
      const recovery = { cycle_id: 1, score_state: "SCORED" };
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(recovery));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const result = await client.getRecovery("1", "access-token");

      expect(result).toEqual(recovery);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://api.prod.whoop.com/developer/v2/cycle/1/recovery");
      expect(init.headers.Authorization).toBe("Bearer access-token");
    });

    it("GETs the sleep-by-id endpoint", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ id: "s1" }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await client.getSleep("s1", "access-token");

      expect(fetchImpl.mock.calls[0][0]).toBe("https://api.prod.whoop.com/developer/v2/activity/sleep/s1");
    });

    it("GETs the workout-by-id endpoint", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ id: "w1" }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await client.getWorkout("w1", "access-token");

      expect(fetchImpl.mock.calls[0][0]).toBe("https://api.prod.whoop.com/developer/v2/activity/workout/w1");
    });

    it("GETs the basic profile endpoint", async () => {
      const profile = { user_id: 42, email: "a@b.com", first_name: "A", last_name: "B" };
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(profile));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const result = await client.getProfile("access-token");

      expect(result).toEqual(profile);
      expect(fetchImpl.mock.calls[0][0]).toBe("https://api.prod.whoop.com/developer/v2/user/profile/basic");
    });
  });

  describe("listRecovery / listSleep / listWorkout", () => {
    it("GETs the recovery collection with a since filter and returns its records", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ records: [{ cycle_id: 1 }], next_token: null }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const records = await client.listRecovery(new Date("2026-09-01T00:00:00.000Z"), "access-token");

      expect(records).toEqual([{ cycle_id: 1 }]);
      const [url] = fetchImpl.mock.calls[0];
      expect(url).toBe(
        "https://api.prod.whoop.com/developer/v2/recovery?start=2026-09-01T00%3A00%3A00.000Z&limit=25",
      );
    });

    it("omits the start filter for a full sync (since: null)", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ records: [], next_token: null }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await client.listSleep(null, "access-token");

      const [url] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://api.prod.whoop.com/developer/v2/activity/sleep?limit=25");
    });

    it("follows next_token across pages until it is null, accumulating every record", async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({ records: [{ id: "w1" }], next_token: "page-2" }))
        .mockResolvedValueOnce(jsonResponse({ records: [{ id: "w2" }], next_token: null }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const records = await client.listWorkout(null, "access-token");

      expect(records).toEqual([{ id: "w1" }, { id: "w2" }]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const [secondUrl] = fetchImpl.mock.calls[1];
      expect(secondUrl).toContain("nextToken=page-2");
    });

    it("stops after a bounded number of pages rather than looping forever on a misbehaving API", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ records: [{ id: "x" }], next_token: "same-token" }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const records = await client.listRecovery(null, "access-token");

      expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(100);
      expect(records.length).toBe(fetchImpl.mock.calls.length);
    });
  });

  describe("retry behaviour", () => {
    it("retries a network error up to 3 attempts, then succeeds", async () => {
      const fetchImpl = jest
        .fn()
        .mockRejectedValueOnce(new Error("network blip"))
        .mockResolvedValueOnce(jsonResponse({ id: "s1" }));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      const result = await client.getSleep("s1", "access-token");

      expect(result).toEqual({ id: "s1" });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("retries a 500 response up to 3 attempts, then throws after exhausting them", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await expect(client.getSleep("s1", "access-token")).rejects.toThrow(/3 attempts/);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("stringifies a non-Error rejection in the exhausted-attempts message", async () => {
      // fetch itself only ever rejects with an Error, but a network layer beneath it
      // (a proxy, a polyfill) is not guaranteed to -- the message must still be readable.
      const fetchImpl = jest.fn().mockRejectedValue("ECONNRESET");
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await expect(client.getSleep("s1", "access-token")).rejects.toThrow(/ECONNRESET/);
    });

    it("does NOT retry a 401 -- a rejected token is not a transient failure", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: "unauthorized" }, false, 401));
      const client = createWhoopClient({ clientId, clientSecret, fetchImpl });

      await expect(client.getSleep("s1", "access-token")).rejects.toThrow(/401/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("whoopClientProvider", () => {
    it("builds a client from WHOOP_CLIENT_ID/WHOOP_CLIENT_SECRET via ConfigService", async () => {
      const config = {
        get: jest.fn((key: string) => (key === "WHOOP_CLIENT_ID" ? clientId : clientSecret)),
      } as unknown as ConfigService;

      const factory = whoopClientProvider as { useFactory: (config: ConfigService) => ReturnType<typeof createWhoopClient> };
      const client = factory.useFactory(config);

      expect(client).toHaveProperty("exchangeAuthorizationCode");
      expect(config.get).toHaveBeenCalledWith("WHOOP_CLIENT_ID", "");
      expect(config.get).toHaveBeenCalledWith("WHOOP_CLIENT_SECRET", "");
    });

    it("boots even with no WHOOP credentials configured, rather than crashing the whole API -- the exact deploy failure this class of bug caused (see whoop-client.ts's own docblock)", () => {
      const config = { get: jest.fn((_key: string, fallback: string) => fallback) } as unknown as ConfigService;

      const factory = whoopClientProvider as { useFactory: (config: ConfigService) => ReturnType<typeof createWhoopClient> };

      expect(() => factory.useFactory(config)).not.toThrow();
    });
  });
});
