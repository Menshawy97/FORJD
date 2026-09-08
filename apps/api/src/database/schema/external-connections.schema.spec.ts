import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";

import { users } from "./users.schema";
import { externalConnections } from "./external-connections.schema";

/**
 * Exercised against real Postgres, not a mock -- the behaviour under test is this
 * migration's own constraint decisions (FK cascade, the one-connection-per-provider unique
 * index, defaults), which a mock would only prove the test author's assumptions about. Same
 * rationale as `health-data.schema.spec.ts`. No repository exists yet for this table (that
 * is Phase 7D/7E); this pins the schema's own claims directly against the applied migration.
 */
describe("external-connections schema (migration 0016)", () => {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";

  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;
  const createdUserEmails: string[] = [];
  const createdUserIds: string[] = [];

  const makeUser = async (label: string): Promise<string> => {
    const email = `extconn-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    createdUserEmails.push(email);
    const [row] = await db.insert(users).values({ email }).returning();
    if (!row) throw new Error("insert did not return a row");
    createdUserIds.push(row.id);
    return row.id;
  };

  const connectionValues = (userId: string, overrides: Partial<typeof externalConnections.$inferInsert> = {}) => ({
    userId,
    provider: "whoop",
    status: "pending",
    encryptedAccessToken: "encrypted-access-token-placeholder",
    encryptedRefreshToken: "encrypted-refresh-token-placeholder",
    tokenKeyVersion: 1,
    ...overrides,
  });

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Cascades to external_connections rows -- asserted below, not just relied on here.
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  it("stores and reads back a pending connection row with nullable fields left null", async () => {
    const userId = await makeUser("basic");

    const [row] = await db.insert(externalConnections).values(connectionValues(userId)).returning();
    if (!row) throw new Error("insert did not return a row");

    expect(row.provider).toBe("whoop");
    expect(row.status).toBe("pending");
    expect(row.externalUserId).toBeNull();
    expect(row.expiresAt).toBeNull();
    expect(row.scopes).toBeNull();
    expect(row.lastSyncAt).toBeNull();
    expect(row.oauthState).toBeNull();
    expect(row.oauthStateExpiresAt).toBeNull();
    expect(row.tokenKeyVersion).toBe(1);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("stores a connected row with every optional field populated", async () => {
    const userId = await makeUser("full");

    const [row] = await db
      .insert(externalConnections)
      .values(
        connectionValues(userId, {
          status: "connected",
          externalUserId: "whoop-user-123",
          expiresAt: new Date("2026-09-09T00:00:00Z"),
          scopes: "read:recovery read:sleep offline",
          lastSyncAt: new Date("2026-09-08T12:00:00Z"),
        }),
      )
      .returning();
    if (!row) throw new Error("insert did not return a row");

    expect(row.status).toBe("connected");
    expect(row.externalUserId).toBe("whoop-user-123");
    expect(row.scopes).toBe("read:recovery read:sleep offline");
  });

  it("rejects a second connection for the same (user, provider)", async () => {
    const userId = await makeUser("dedup");
    await db.insert(externalConnections).values(connectionValues(userId));

    await expect(db.insert(externalConnections).values(connectionValues(userId))).rejects.toThrow();
  });

  it("allows the same provider for two different users (the unique index is per-user)", async () => {
    const userA = await makeUser("shared-provider-a");
    const userB = await makeUser("shared-provider-b");

    await expect(
      db.insert(externalConnections).values([connectionValues(userA), connectionValues(userB)]),
    ).resolves.not.toThrow();
  });

  it("cascades on user deletion: deleting a user removes their external_connections row", async () => {
    const userId = await makeUser("cascade");
    await db.insert(externalConnections).values(connectionValues(userId));

    await db.delete(users).where(eq(users.id, userId));
    createdUserIds.splice(createdUserIds.indexOf(userId), 1);
    createdUserEmails.splice(
      createdUserEmails.findIndex((e) => e.startsWith("extconn-cascade-")),
      1,
    );

    const rows = await db.select().from(externalConnections).where(eq(externalConnections.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("allows re-connecting the same (user, provider) via upsert instead of a duplicate row", async () => {
    // The natural shape 7F's disconnect-then-reconnect flow needs -- reconnecting updates
    // the existing row's tokens/status rather than colliding with the unique index.
    const userId = await makeUser("reconnect");
    await db.insert(externalConnections).values(connectionValues(userId, { status: "disconnected" }));

    await db
      .insert(externalConnections)
      .values(connectionValues(userId, { status: "connected" }))
      .onConflictDoUpdate({
        target: [externalConnections.userId, externalConnections.provider],
        set: { status: "connected" },
      });

    const rows = await db.select().from(externalConnections).where(eq(externalConnections.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("connected");
  });
});
