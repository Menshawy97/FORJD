import type { WhoopClient } from "./whoop-client";
import { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";
import { revokeAndClearWhoopConnection } from "./whoop-revoke";

const row: WhoopConnectionRow = {
  id: "conn-1",
  userId: "user-1",
  status: "connected",
  externalUserId: "12345",
  encryptedAccessToken: "cipher-access",
  encryptedRefreshToken: "cipher-refresh",
  tokenKeyVersion: 1,
  expiresAt: new Date("2026-09-02T10:00:00.000Z"),
  scopes: "read:recovery offline",
  lastSyncAt: null,
};

describe("revokeAndClearWhoopConnection", () => {
  function build(overrides: Partial<WhoopConnectionRow> | null = row) {
    const connections: Pick<WhoopConnectionRepository, "findByUserId" | "clearTokens"> = {
      findByUserId: jest.fn().mockResolvedValue(overrides === null ? null : { ...row, ...overrides }),
      clearTokens: jest.fn().mockResolvedValue(undefined),
    };
    const client: Pick<WhoopClient, "revokeToken"> = { revokeToken: jest.fn().mockResolvedValue(undefined) };
    const cipher: Pick<TokenCipher, "decrypt"> = { decrypt: jest.fn().mockReturnValue("plaintext-access-token") };

    return { connections, client, cipher };
  }

  it("revokes the grant with the decrypted access token, then wipes the local tokens", async () => {
    const { connections, client, cipher } = build();
    const calls: string[] = [];
    (client.revokeToken as jest.Mock).mockImplementation(async () => {
      calls.push("revoke");
    });
    (connections.clearTokens as jest.Mock).mockImplementation(async () => {
      calls.push("clear");
    });

    await revokeAndClearWhoopConnection(
      "user-1",
      connections as WhoopConnectionRepository,
      client as WhoopClient,
      cipher as TokenCipher,
    );

    expect(cipher.decrypt).toHaveBeenCalledWith({ ciphertext: "cipher-access", keyVersion: 1 });
    expect(client.revokeToken).toHaveBeenCalledWith("plaintext-access-token");
    expect(connections.clearTokens).toHaveBeenCalledWith("user-1");
    expect(calls).toEqual(["revoke", "clear"]);
  });

  it("still wipes the local tokens when the revoke call itself fails", async () => {
    const { connections, client, cipher } = build();
    (client.revokeToken as jest.Mock).mockRejectedValue(new Error("WHOOP is down"));

    await expect(
      revokeAndClearWhoopConnection("user-1", connections as WhoopConnectionRepository, client as WhoopClient, cipher as TokenCipher),
    ).resolves.toBeUndefined();

    expect(connections.clearTokens).toHaveBeenCalledWith("user-1");
  });

  it("does nothing for a user with no WHOOP connection", async () => {
    const { connections, client, cipher } = build(null);

    await revokeAndClearWhoopConnection("user-1", connections as WhoopConnectionRepository, client as WhoopClient, cipher as TokenCipher);

    expect(client.revokeToken).not.toHaveBeenCalled();
    expect(connections.clearTokens).not.toHaveBeenCalled();
  });

  it("does nothing for a connection that never completed OAuth (placeholder empty token)", async () => {
    const { connections, client, cipher } = build({ encryptedAccessToken: "" });

    await revokeAndClearWhoopConnection("user-1", connections as WhoopConnectionRepository, client as WhoopClient, cipher as TokenCipher);

    expect(client.revokeToken).not.toHaveBeenCalled();
    expect(connections.clearTokens).not.toHaveBeenCalled();
  });
});
