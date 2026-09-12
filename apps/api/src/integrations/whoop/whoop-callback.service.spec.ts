import { ConflictException } from "@nestjs/common";

import { WhoopCallbackService } from "./whoop-callback.service";
import type { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { WhoopClient } from "./whoop-client";
import type { WhoopOAuthService } from "./whoop-oauth.service";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";

/**
 * Completes the OAuth round trip the authorize/callback routes (Phase 7F) bridge via
 * `oauth_state`: exchange the code, learn WHOOP's own numeric user id (needed so a later
 * webhook, which carries only that id, can be matched back to this internal user), encrypt,
 * and persist. Kept out of the controller so this logic is unit-testable without an HTTP
 * layer, matching every other controller/service split in this codebase.
 */
describe("WhoopCallbackService", () => {
  const pendingRow: WhoopConnectionRow = {
    id: "conn-1",
    userId: "internal-user-1",
    status: "pending",
    externalUserId: null,
    encryptedAccessToken: "",
    encryptedRefreshToken: null,
    tokenKeyVersion: 0,
    expiresAt: null,
    scopes: null,
    lastSyncAt: null,
  };

  function makeService(overrides: { connections?: Partial<WhoopConnectionRepository>; oauth?: Partial<WhoopOAuthService>; client?: Partial<WhoopClient> } = {}) {
    const connections = {
      findByOAuthState: jest.fn().mockResolvedValue(pendingRow),
      upsertTokens: jest.fn().mockResolvedValue(undefined),
      ...overrides.connections,
    } as unknown as WhoopConnectionRepository;

    const oauth = {
      exchangeCode: jest.fn().mockResolvedValue({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        scope: "read:recovery offline",
      }),
      ...overrides.oauth,
    } as unknown as WhoopOAuthService;

    const client = {
      getProfile: jest.fn().mockResolvedValue({ user_id: 10129, email: "a@b.com", first_name: "A", last_name: "B" }),
      ...overrides.client,
    } as unknown as WhoopClient;

    const cipher: TokenCipher = {
      encrypt: (p) => ({ ciphertext: `enc(${p})`, keyVersion: 1 }),
      decrypt: (e) => e.ciphertext,
    };

    return { service: new WhoopCallbackService(oauth, client, connections, cipher), connections, oauth, client };
  }

  it("returns null for a state nobody issued or that has expired", async () => {
    const { service } = makeService({ connections: { findByOAuthState: jest.fn().mockResolvedValue(null) } });
    expect(await service.completeAuthorization("bad-state", "some-code")).toBeNull();
  });

  it("exchanges the code, fetches the profile, and persists encrypted tokens with WHOOP's own user id", async () => {
    const { service, connections } = makeService();

    const result = await service.completeAuthorization("good-state", "auth-code");

    expect(result).toEqual({ userId: "internal-user-1" });
    expect(connections.upsertTokens).toHaveBeenCalledWith("internal-user-1", {
      status: "connected",
      externalUserId: "10129",
      encryptedAccessToken: "enc(new-access-token)",
      encryptedRefreshToken: "enc(new-refresh-token)",
      tokenKeyVersion: 1,
      expiresAt: expect.any(Date),
      scopes: "read:recovery offline",
    });
  });

  it("propagates an error from the code exchange without persisting anything", async () => {
    const { service, connections } = makeService({
      oauth: { exchangeCode: jest.fn().mockRejectedValue(new Error("invalid_grant")) },
    });

    await expect(service.completeAuthorization("good-state", "bad-code")).rejects.toThrow("invalid_grant");
    expect(connections.upsertTokens).not.toHaveBeenCalled();
  });

  it("propagates an error from the profile fetch without persisting anything", async () => {
    const { service, connections } = makeService({
      client: { getProfile: jest.fn().mockRejectedValue(new Error("profile fetch failed")) },
    });

    await expect(service.completeAuthorization("good-state", "auth-code")).rejects.toThrow("profile fetch failed");
    expect(connections.upsertTokens).not.toHaveBeenCalled();
  });

  it("maps a duplicate external_user_id unique violation to a ConflictException (R6, H5)", async () => {
    const duplicateViolation = {
      cause: { code: "23505", constraint: "external_connections_provider_external_user_id_unique" },
    };
    const { service } = makeService({
      connections: { upsertTokens: jest.fn().mockRejectedValue(duplicateViolation) },
    });

    await expect(service.completeAuthorization("good-state", "auth-code")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("does not map an unrelated unique violation to a ConflictException", async () => {
    const unrelatedViolation = {
      cause: { code: "23505", constraint: "some_other_constraint" },
    };
    const { service } = makeService({
      connections: { upsertTokens: jest.fn().mockRejectedValue(unrelatedViolation) },
    });

    await expect(service.completeAuthorization("good-state", "auth-code")).rejects.not.toBeInstanceOf(
      ConflictException,
    );
  });
});
