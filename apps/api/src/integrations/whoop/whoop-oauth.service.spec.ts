import { ConfigService } from "@nestjs/config";

import { WhoopOAuthService, whoopOAuthServiceProvider } from "./whoop-oauth.service";
import type { WhoopClient } from "./whoop-client";

/**
 * `WhoopOAuthService` owns the parts of the OAuth round trip that are not raw HTTP:
 * building the authorize-redirect URL (pure, no network) and delegating code
 * exchange/refresh to `WhoopClient`. `buildAuthorizeUrl` is tested against WHOOP's own
 * documented authorize endpoint and scope list (confirmed during Phase 7 planning).
 */
describe("WhoopOAuthService", () => {
  const makeService = (client: Partial<WhoopClient> = {}) =>
    new WhoopOAuthService(client as WhoopClient, "test-client-id", "forjd://whoop-callback");

  describe("buildAuthorizeUrl", () => {
    it("builds the WHOOP authorize URL with client_id, redirect_uri, response_type, state, and every requested scope", () => {
      const service = makeService();

      const url = new URL(service.buildAuthorizeUrl("a1b2c3d4"));

      expect(url.origin + url.pathname).toBe("https://api.prod.whoop.com/oauth/oauth2/auth");
      expect(url.searchParams.get("client_id")).toBe("test-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe("forjd://whoop-callback");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe("a1b2c3d4");
      expect(url.searchParams.get("scope")).toBe(
        "read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline",
      );
    });

    it("rejects a state shorter than WHOOP's documented 8-character minimum", () => {
      const service = makeService();
      expect(() => service.buildAuthorizeUrl("short")).toThrow(/8 characters/);
    });
  });

  describe("exchangeCode", () => {
    it("delegates to the client with this service's own redirect_uri", async () => {
      const exchangeAuthorizationCode = jest.fn().mockResolvedValue({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "read:recovery offline",
      });
      const service = makeService({ exchangeAuthorizationCode });

      const result = await service.exchangeCode("auth-code");

      expect(exchangeAuthorizationCode).toHaveBeenCalledWith("auth-code", "forjd://whoop-callback");
      expect(result.access_token).toBe("at");
    });
  });

  describe("refresh", () => {
    it("delegates to the client", async () => {
      const refreshAccessToken = jest.fn().mockResolvedValue({
        access_token: "at2",
        refresh_token: "rt2",
        expires_in: 3600,
        scope: "offline",
      });
      const service = makeService({ refreshAccessToken });

      const result = await service.refresh("old-refresh-token");

      expect(refreshAccessToken).toHaveBeenCalledWith("old-refresh-token");
      expect(result.access_token).toBe("at2");
    });
  });

  describe("whoopOAuthServiceProvider", () => {
    it("builds a service from WHOOP_CLIENT_ID/WHOOP_REDIRECT_URI via ConfigService", () => {
      const values: Record<string, string> = {
        WHOOP_CLIENT_ID: "test-client-id",
        WHOOP_REDIRECT_URI: "forjd://whoop-callback",
      };
      const config = { getOrThrow: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
      const client = {} as WhoopClient;

      const service = whoopOAuthServiceProvider.useFactory(client, config);

      expect(service.buildAuthorizeUrl("a1b2c3d4")).toContain("client_id=test-client-id");
    });
  });
});
