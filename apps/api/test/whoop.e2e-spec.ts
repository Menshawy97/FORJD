import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHmac, randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { users } from "../src/database/schema/users.schema";
import { WHOOP_CLIENT, type WhoopClient } from "../src/integrations/whoop/whoop-client";
import { FakeAuthProvider } from "./support/fake-auth-provider";
import recoveryFixture from "../src/integrations/whoop/__fixtures__/recovery.json";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-whoop-owner-${suiteId}@example.com`;
const otherEmail = `e2e-whoop-other-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
const otherExternalId = randomUUID();
const webhookSecret = process.env.WHOOP_WEBHOOK_SECRET ?? "ci-placeholder-whoop-webhook-secret";

/**
 * The full WHOOP path over real HTTP: authorize -> callback -> sync/disconnect, plus the
 * webhook route's signature verification. Unit suites already cover each layer's own logic
 * in isolation; this proves what only wiring the real routes together can -- `JwtAuthGuard`
 * actually rejecting an unauthenticated caller, the OAuth state round trip actually working
 * end to end, one user never affecting another's connection, and the webhook's HMAC check
 * rejecting a forged or tampered request while accepting (and safely re-accepting) a real one.
 */
describe("WHOOP integration (e2e)", () => {
  let app: INestApplication;
  let db: Database;
  let fakeClient: {
    exchangeAuthorizationCode: jest.Mock;
    refreshAccessToken: jest.Mock;
    getRecovery: jest.Mock;
    getSleep: jest.Mock;
    getWorkout: jest.Mock;
    getProfile: jest.Mock;
    listRecovery: jest.Mock;
    listSleep: jest.Mock;
    listWorkout: jest.Mock;
  };

  const authorize = (token: string) =>
    request(app.getHttpServer()).post("/api/v1/integrations/whoop/authorize").set("Authorization", `Bearer ${token}`);

  const sync = (token: string) =>
    request(app.getHttpServer()).post("/api/v1/integrations/whoop/sync").set("Authorization", `Bearer ${token}`);

  const disconnect = (token: string) =>
    request(app.getHttpServer()).delete("/api/v1/integrations/whoop").set("Authorization", `Bearer ${token}`);

  const series = (token: string) =>
    request(app.getHttpServer()).get("/api/v1/health-data/observations/series").set("Authorization", `Bearer ${token}`);

  function signWebhook(body: object, timestamp = String(Date.now()), secret = webhookSecret) {
    const rawBody = JSON.stringify(body);
    const signature = createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
    return { rawBody, timestamp, signature };
  }

  const sendWebhook = (rawBody: string, timestamp: string, signature: string) =>
    request(app.getHttpServer())
      .post("/api/v1/integrations/whoop/webhook")
      .set("Content-Type", "application/json")
      .set("X-WHOOP-Signature", signature)
      .set("X-WHOOP-Signature-Timestamp", timestamp)
      .send(rawBody);

  beforeAll(async () => {
    fakeClient = {
      exchangeAuthorizationCode: jest.fn(),
      refreshAccessToken: jest.fn(),
      getRecovery: jest.fn(),
      getSleep: jest.fn(),
      getWorkout: jest.fn(),
      getProfile: jest.fn(),
      listRecovery: jest.fn().mockResolvedValue([]),
      listSleep: jest.fn().mockResolvedValue([]),
      listWorkout: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: ownerEmail, externalId: ownerExternalId, tokens: ["owner-token"] },
            { email: otherEmail, externalId: otherExternalId, tokens: ["other-token"] },
          ],
          signIn: "disabled",
        }),
      )
      .overrideProvider(WHOOP_CLIENT)
      .useValue(fakeClient as unknown as WhoopClient)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: ownerEmail, password: "Str0ngPass!" }).expect(201);
    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: otherEmail, password: "Str0ngPass!" }).expect(201);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [ownerEmail, otherEmail]));
    await app.close();
  });

  it("rejects an unauthenticated request on every authenticated route", async () => {
    await authorize("").expect(401);
    await sync("").expect(401);
    await disconnect("").expect(401);
  });

  it("completes the full authorize -> callback round trip and connects the account", async () => {
    fakeClient.exchangeAuthorizationCode.mockResolvedValue({
      access_token: "owner-access-token",
      refresh_token: "owner-refresh-token",
      expires_in: 3600,
      scope: "read:recovery read:sleep read:workout offline",
    });
    fakeClient.getProfile.mockResolvedValue({ user_id: 555111, email: ownerEmail, first_name: "O", last_name: "W" });

    const authorizeResponse = await authorize("owner-token").expect(200);
    const authorizeUrl = new URL(authorizeResponse.body.authorizeUrl);
    const state = authorizeUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackResponse = await request(app.getHttpServer())
      .get(`/api/v1/integrations/whoop/callback?code=fake-auth-code&state=${state}`)
      .expect(302);

    expect(callbackResponse.headers.location).toBe("forjd://whoop-callback?status=success");
    expect(fakeClient.exchangeAuthorizationCode).toHaveBeenCalledWith("fake-auth-code", "forjd://whoop-callback");
  });

  it("redirects to an error status for a callback with no matching pending state", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/integrations/whoop/callback?code=some-code&state=never-issued-state")
      .expect(302);

    expect(response.headers.location).toBe("forjd://whoop-callback?status=error&reason=invalid_state");
  });

  it("cross-user isolation: the other user's sync/disconnect never touch the owner's connection", async () => {
    // The other user has no WHOOP connection at all -- sync must fail for them, not
    // silently return the owner's data.
    await sync("other-token").expect(500);
    // Disconnecting with nothing to disconnect is a harmless no-op update, not an error.
    await disconnect("other-token").expect(204);

    // The owner's connection, established in the previous test, must still be usable.
    fakeClient.listRecovery.mockResolvedValueOnce([recoveryFixture]);
    const ownerSync = await sync("owner-token").expect(200);
    expect(ownerSync.body.observationCount).toBeGreaterThan(0);
  });

  it("rejects a webhook with a forged signature", async () => {
    const { rawBody, timestamp } = signWebhook(
      { user_id: 555111, id: "93845", type: "recovery.updated", trace_id: "t1" },
      undefined,
      "wrong-secret",
    );
    const forgedSignature = createHmac("sha256", "wrong-secret").update(timestamp + rawBody).digest("base64");

    await sendWebhook(rawBody, timestamp, forgedSignature).expect(401);
  });

  it("rejects a webhook with a stale timestamp even if otherwise correctly signed", async () => {
    const staleTimestamp = String(Date.now() - 10 * 60_000);
    const { rawBody, signature } = signWebhook({ user_id: 555111, id: "93845", type: "recovery.updated", trace_id: "t2" }, staleTimestamp);

    await sendWebhook(rawBody, staleTimestamp, signature).expect(401);
  });

  it("accepts a validly signed webhook, ingests the record, and is idempotent on re-delivery", async () => {
    fakeClient.getRecovery.mockResolvedValue(recoveryFixture);
    const { rawBody, timestamp, signature } = signWebhook({
      user_id: 555111,
      id: "93845",
      type: "recovery.updated",
      trace_id: "t3",
    });

    await sendWebhook(rawBody, timestamp, signature).expect(200);
    // WHOOP itself retries webhook delivery -- re-processing the identical event must not
    // duplicate the ingested observation (relies on health_observations' own
    // (user_id, source, provider_record_id) unique index, upserted rather than inserted).
    await sendWebhook(rawBody, timestamp, signature).expect(200);

    const response = await series("owner-token").expect(200);
    const hrv = response.body.series.find((s: { metricType: string }) => s.metricType === "hrv");
    expect(hrv?.points).toHaveLength(1);
    expect(hrv?.points[0].value).toBe(62.3);
  });
});
