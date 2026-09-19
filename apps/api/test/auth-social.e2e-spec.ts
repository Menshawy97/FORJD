import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { auditLogs } from "../src/database/schema/audit-logs.schema";
import { users } from "../src/database/schema/users.schema";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const newEmail = `e2e-social-new-${suiteId}@example.com`;
const linkedEmail = `e2e-social-linked-${suiteId}@example.com`;
const newExternalId = randomUUID();
const linkedExternalId = randomUUID();
const longToken = (email: string) => `valid:${email}`;

/**
 * ADR-041, over real HTTP and real Postgres: a Google/Apple ID token is exchanged (through
 * the auth provider) for a session; a first sign-in creates the account, a later one and an
 * email account with the same address both land on the same user, and the new account is held
 * at the age gate until it gives a date of birth (ADR-042).
 */
describe("Social sign-in (e2e)", () => {
  let app: INestApplication;
  let db: Database;
  let fakeAuth: FakeAuthProvider;

  beforeAll(async () => {
    fakeAuth = new FakeAuthProvider({
      accounts: [
        { email: newEmail, externalId: newExternalId, tokens: ["new-token"] },
        { email: linkedEmail, externalId: linkedExternalId, tokens: ["linked-token"] },
      ],
      signIn: "disabled",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(fakeAuth)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [newEmail, linkedEmail]));
    await app.close();
  });

  it("rejects a malformed request before reaching the provider", async () => {
    await request(app.getHttpServer()).post("/api/v1/auth/social").send({ provider: "facebook", idToken: longToken(newEmail) }).expect(400);
    await request(app.getHttpServer()).post("/api/v1/auth/social").send({ provider: "google", idToken: "short" }).expect(400);
    expect(fakeAuth.socialSignIns).toHaveLength(0);
  });

  it("requires the nonce for Apple", async () => {
    await request(app.getHttpServer()).post("/api/v1/auth/social").send({ provider: "apple", idToken: longToken(newEmail) }).expect(400);
  });

  it("refuses a token the identity provider cannot verify, with the same constant message as a bad password", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/social")
      .send({ provider: "google", idToken: "not-a-real-token-not-a-real-token" })
      .expect(401);

    expect(response.body.message).toBe("Invalid credentials");
  });

  it("a first Google sign-in creates the account and returns a session marked new", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/social")
      .send({ provider: "google", idToken: longToken(newEmail) })
      .expect(200);

    expect(response.body.isNewUser).toBe(true);
    expect(typeof response.body.accessToken).toBe("string");
    const [user] = await db.select().from(users).where(eq(users.email, newEmail));
    expect(user).toBeDefined();
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.userId, user!.id));
    expect(audits.map((row) => row.action)).toContain("auth.social_sign_in");
  });

  it("holds the new account at the age gate until it gives a date of birth", async () => {
    await request(app.getHttpServer()).get("/api/v1/workouts/templates").set("Authorization", "Bearer new-token").expect(403);

    await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer new-token")
      .send({ dateOfBirth: "1990-01-01" })
      .expect(204);

    await request(app.getHttpServer()).get("/api/v1/workouts/templates").set("Authorization", "Bearer new-token").expect(200);
  });

  it("a second sign-in with the same account is not new and lands on the same user", async () => {
    const before = await db.select().from(users).where(eq(users.email, newEmail));

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/social")
      .send({ provider: "apple", idToken: longToken(newEmail), nonce: "raw-nonce-123" })
      .expect(200);

    expect(response.body.isNewUser).toBe(false);
    const after = await db.select().from(users).where(eq(users.email, newEmail));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(fakeAuth.socialSignIns).toContainEqual({ provider: "apple", nonce: "raw-nonce-123" });
  });

  it("an account that signed up by email keeps its data when the same address signs in with Google", async () => {
    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: linkedEmail, password: "Str0ngPass!" }).expect(201);
    const [registered] = await db.select().from(users).where(eq(users.email, linkedEmail));

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/social")
      .send({ provider: "google", idToken: longToken(linkedEmail) })
      .expect(200);

    expect(response.body.isNewUser).toBe(false);
    const rows = await db.select().from(users).where(eq(users.email, linkedEmail));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(registered!.id);
  });
});
