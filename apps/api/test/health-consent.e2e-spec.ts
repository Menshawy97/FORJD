import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { auditLogs } from "../src/database/schema/audit-logs.schema";
import { users } from "../src/database/schema/users.schema";
import { markAdult } from "./support/adult";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `e2e-health-consent-${suiteId}@example.com`;
const externalId = randomUUID();

const observation = {
  metricType: "hrv",
  value: 55,
  unit: "ms",
  startTime: "2026-09-07T00:00:00.000Z",
  endTime: "2026-09-07T00:05:00.000Z",
  source: "health_connect",
};

/**
 * ADR-043, over real HTTP and real Postgres: nothing health-related is collected until the
 * person has said yes, and withdrawing is effective on the very next request.
 */
describe("Health data consent (e2e)", () => {
  let app: INestApplication;
  let db: Database;

  const authed = () => ({ Authorization: "Bearer consent-token" });
  const ingest = () =>
    request(app.getHttpServer()).post("/api/v1/health-data/observations").set(authed()).send({ observations: [observation] });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(new FakeAuthProvider({ accounts: [{ email, externalId, tokens: ["consent-token"] }], signIn: "disabled" }))
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email, password: "Str0ngPass!" }).expect(201);
    await markAdult(app, email);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, email));
    await app.close();
  });

  it("starts with consent off", async () => {
    const me = await request(app.getHttpServer()).get("/api/v1/users/me").set(authed()).expect(200);

    expect(me.body.privacy.healthDataConsent).toBe(false);
    expect(me.body.privacy.healthDataConsentAt).toBeNull();
  });

  it("refuses to store health observations, with a code the app acts on", async () => {
    const response = await ingest().expect(403);

    expect(response.body.code).toBe("health_data_consent_required");
  });

  it("refuses to start the WHOOP connection", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/integrations/whoop/authorize").set(authed()).expect(403);

    expect(response.body.code).toBe("health_data_consent_required");
  });

  it("granting consent is recorded with a date and an audit row, and opens ingestion", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/v1/users/me/privacy")
      .set(authed())
      .send({ healthDataConsent: true })
      .expect(200);

    expect(response.body.healthDataConsent).toBe(true);
    expect(typeof response.body.healthDataConsentAt).toBe("string");

    await ingest().expect(204);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.userId, user!.id));
    expect(audits.map((row) => row.action)).toContain("privacy.health_consent_granted");
  });

  it("withdrawing consent clears the date and closes ingestion again on the very next request", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/v1/users/me/privacy")
      .set(authed())
      .send({ healthDataConsent: false })
      .expect(200);

    expect(response.body.healthDataConsent).toBe(false);
    expect(response.body.healthDataConsentAt).toBeNull();
    await ingest().expect(403);
  });
});
