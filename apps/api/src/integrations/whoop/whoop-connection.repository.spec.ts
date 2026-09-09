import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { users } from "../../database/schema/users.schema";
import { WhoopConnectionRepository } from "./whoop-connection.repository";

/**
 * Exercised against real Postgres, not a mock -- same rationale as
 * `external-connections.schema.spec.ts`: the behaviour under test is the upsert's own
 * conflict-target semantics (`(user_id, provider)`), which a mock would only prove the test
 * author's assumptions about.
 */
describe("WhoopConnectionRepository", () => {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  let repository: WhoopConnectionRepository;
  const createdUserIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `whoopconn-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
    repository = new WhoopConnectionRepository(db);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  it("findByExternalUserId finds a connection by WHOOP's own user id, for matching an incoming webhook to an internal user", async () => {
    const userId = await makeUser("external-lookup");
    await repository.upsertTokens(userId, {
      status: "connected",
      externalUserId: "whoop-external-999",
      encryptedAccessToken: "enc-at",
      encryptedRefreshToken: "enc-rt",
      tokenKeyVersion: 1,
      expiresAt: null,
      scopes: null,
    });

    const row = await repository.findByExternalUserId("whoop-external-999");
    expect(row?.userId).toBe(userId);
  });

  it("findByExternalUserId returns null for a WHOOP user id no connection has", async () => {
    expect(await repository.findByExternalUserId("no-such-whoop-user")).toBeNull();
  });

  it("returns null for a user with no WHOOP connection", async () => {
    const userId = await makeUser("no-connection");
    expect(await repository.findByUserId(userId)).toBeNull();
  });

  it("upserts a new connection and reads it back", async () => {
    const userId = await makeUser("new-connection");

    await repository.upsertTokens(userId, {
      status: "connected",
      externalUserId: "whoop-123",
      encryptedAccessToken: "enc-at",
      encryptedRefreshToken: "enc-rt",
      tokenKeyVersion: 1,
      expiresAt: new Date("2026-09-09T00:00:00Z"),
      scopes: "read:recovery offline",
    });

    const row = await repository.findByUserId(userId);
    expect(row).toMatchObject({
      userId,
      status: "connected",
      externalUserId: "whoop-123",
      encryptedAccessToken: "enc-at",
      encryptedRefreshToken: "enc-rt",
      tokenKeyVersion: 1,
      scopes: "read:recovery offline",
      lastSyncAt: null,
    });
  });

  it("upserting a second time for the same user updates the existing row rather than duplicating it", async () => {
    const userId = await makeUser("reupsert");
    await repository.upsertTokens(userId, {
      status: "pending",
      externalUserId: null,
      encryptedAccessToken: "enc-at-1",
      encryptedRefreshToken: null,
      tokenKeyVersion: 1,
      expiresAt: null,
      scopes: null,
    });

    await repository.upsertTokens(userId, {
      status: "connected",
      externalUserId: "whoop-456",
      encryptedAccessToken: "enc-at-2",
      encryptedRefreshToken: "enc-rt-2",
      tokenKeyVersion: 1,
      expiresAt: new Date("2026-09-10T00:00:00Z"),
      scopes: "read:sleep offline",
    });

    const row = await repository.findByUserId(userId);
    expect(row?.status).toBe("connected");
    expect(row?.encryptedAccessToken).toBe("enc-at-2");
  });

  it("updateLastSyncAt sets the checkpoint without touching other fields", async () => {
    const userId = await makeUser("sync-checkpoint");
    await repository.upsertTokens(userId, {
      status: "connected",
      externalUserId: "whoop-789",
      encryptedAccessToken: "enc-at",
      encryptedRefreshToken: "enc-rt",
      tokenKeyVersion: 1,
      expiresAt: null,
      scopes: null,
    });

    const at = new Date("2026-09-08T12:00:00Z");
    await repository.updateLastSyncAt(userId, at);

    const row = await repository.findByUserId(userId);
    expect(row?.lastSyncAt).toEqual(at);
    expect(row?.status).toBe("connected");
  });

  it("setPendingState stores a state bound to the user with an expiry, readable back by that state", async () => {
    const userId = await makeUser("pending");
    const expiresAt = new Date(Date.now() + 600_000);

    await repository.setPendingState(userId, "a1b2c3d4", expiresAt);

    const byState = await repository.findByOAuthState("a1b2c3d4");
    expect(byState?.userId).toBe(userId);
    expect(byState?.status).toBe("pending");

    const byUser = await repository.findByUserId(userId);
    expect(byUser?.status).toBe("pending");
  });

  it("findByOAuthState returns null for an expired state", async () => {
    const userId = await makeUser("expired-state");
    await repository.setPendingState(userId, "e1e2e3e4", new Date(Date.now() - 1000));

    expect(await repository.findByOAuthState("e1e2e3e4")).toBeNull();
  });

  it("findByOAuthState returns null for a state nobody set", async () => {
    expect(await repository.findByOAuthState("never-issued")).toBeNull();
  });

  it("upsertTokens clears any pending oauth state -- a completed connection has none left pending", async () => {
    const userId = await makeUser("clears-state");
    await repository.setPendingState(userId, "f1f2f3f4", new Date(Date.now() + 600_000));

    await repository.upsertTokens(userId, {
      status: "connected",
      externalUserId: "whoop-111",
      encryptedAccessToken: "enc-at",
      encryptedRefreshToken: "enc-rt",
      tokenKeyVersion: 1,
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: "offline",
    });

    expect(await repository.findByOAuthState("f1f2f3f4")).toBeNull();
  });

  it("updateStatus changes only the status", async () => {
    const userId = await makeUser("disconnect");
    await repository.upsertTokens(userId, {
      status: "connected",
      externalUserId: "whoop-999",
      encryptedAccessToken: "enc-at",
      encryptedRefreshToken: "enc-rt",
      tokenKeyVersion: 1,
      expiresAt: null,
      scopes: null,
    });

    await repository.updateStatus(userId, "disconnected");

    const row = await repository.findByUserId(userId);
    expect(row?.status).toBe("disconnected");
    expect(row?.encryptedAccessToken).toBe("enc-at");
  });
});
