import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { users } from "../src/database/schema/users.schema";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-health-data-owner-${suiteId}@example.com`;
const otherEmail = `e2e-health-data-other-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
const otherExternalId = randomUUID();

/**
 * The full health-data path over real HTTP: ingest -> series -> connections. Unit suites
 * already cover each layer's own logic in isolation (`health-data.service.spec.ts`,
 * `health-data.schema.spec.ts`); this proves what only wiring the real routes together can --
 * `ZodValidationPipe` rejecting a malformed batch, the idempotent-reingest upsert actually
 * taking effect end to end, and that one user never sees another user's observations or
 * connections.
 */
describe("Health data (e2e)", () => {
  let app: INestApplication;
  let db: Database;

  const ingest = (body: unknown, token = "owner-token") =>
    request(app.getHttpServer())
      .post("/api/v1/health-data/observations")
      .set("Authorization", `Bearer ${token}`)
      .send(body as object);

  const series = (token = "owner-token") =>
    request(app.getHttpServer()).get("/api/v1/health-data/observations/series").set("Authorization", `Bearer ${token}`);

  const seriesWithQuery = (query: string, token = "owner-token") =>
    request(app.getHttpServer())
      .get(`/api/v1/health-data/observations/series?${query}`)
      .set("Authorization", `Bearer ${token}`);

  const connections = (token = "owner-token") =>
    request(app.getHttpServer()).get("/api/v1/health-data/connections").set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
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
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: ownerEmail, password: "Str0ngPass!" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: otherEmail, password: "Str0ngPass!" })
      .expect(201);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [ownerEmail, otherEmail]));
    await app.close();
  });

  it("rejects an unauthenticated request on every route", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/health-data/observations")
      .send({ observations: [] })
      .expect(401);
    await request(app.getHttpServer()).get("/api/v1/health-data/observations/series").expect(401);
    await request(app.getHttpServer()).get("/api/v1/health-data/connections").expect(401);
  });

  it("rejects a malformed batch instead of reaching the repository", async () => {
    await ingest({ observations: [{ metricType: "not-a-real-metric", value: 1 }] }).expect(400);
  });

  it("ingests a batch and reflects it in the series read", async () => {
    await ingest({
      observations: [
        {
          metricType: "hrv",
          value: 62,
          unit: "ms",
          startTime: "2026-09-07T00:00:00.000Z",
          endTime: "2026-09-07T00:00:00.000Z",
          source: "health_connect",
        },
      ],
    }).expect(204);

    const response = await series().expect(200);
    const hrv = response.body.series.find((s: { metricType: string }) => s.metricType === "hrv");
    expect(hrv).toBeDefined();
    expect(hrv.points).toEqual([{ startTime: "2026-09-07T00:00:00.000Z", value: 62 }]);
  });

  it("re-ingesting the same (source, providerRecordId) window upserts instead of duplicating the series point", async () => {
    await ingest({
      observations: [
        {
          metricType: "steps",
          value: 1000,
          unit: "steps",
          startTime: "2026-09-07T00:00:00.000Z",
          endTime: "2026-09-07T23:59:59.000Z",
          source: "health_connect",
          providerRecordId: "sync-batch-1",
        },
      ],
    }).expect(204);

    await ingest({
      observations: [
        {
          metricType: "steps",
          value: 8500,
          unit: "steps",
          startTime: "2026-09-07T00:00:00.000Z",
          endTime: "2026-09-07T23:59:59.000Z",
          source: "health_connect",
          providerRecordId: "sync-batch-1",
        },
      ],
    }).expect(204);

    const response = await series().expect(200);
    const steps = response.body.series.find((s: { metricType: string }) => s.metricType === "steps");
    expect(steps.points).toHaveLength(1);
    expect(steps.points[0].value).toBe(8500);
  });

  it("never shows one user's observations or connections to another", async () => {
    await ingest(
      {
        observations: [
          {
            metricType: "resting_heart_rate",
            value: 50,
            unit: "bpm",
            startTime: "2026-09-07T00:00:00.000Z",
            endTime: "2026-09-07T00:00:00.000Z",
            source: "manual",
          },
        ],
      },
      "other-token",
    ).expect(204);

    const ownerSeries = await series().expect(200);
    expect(ownerSeries.body.series.some((s: { metricType: string }) => s.metricType === "resting_heart_rate")).toBe(
      false,
    );

    const ownerConnections = await connections().expect(200);
    expect(ownerConnections.body.connections).toEqual([]);
  });

  it("honours its range and metric-type query params instead of returning full history (R8 / H4)", async () => {
    await ingest({
      observations: [
        {
          metricType: "hrv",
          value: 40,
          unit: "ms",
          startTime: "2020-01-01T00:00:00.000Z",
          endTime: "2020-01-01T00:00:00.000Z",
          source: "manual",
        },
        {
          metricType: "hrv",
          value: 71,
          unit: "ms",
          startTime: "2026-09-10T00:00:00.000Z",
          endTime: "2026-09-10T00:00:00.000Z",
          source: "manual",
        },
        {
          metricType: "resting_heart_rate",
          value: 55,
          unit: "bpm",
          startTime: "2026-09-10T00:00:00.000Z",
          endTime: "2026-09-10T00:00:00.000Z",
          source: "manual",
        },
      ],
    }).expect(204);

    const response = await seriesWithQuery(
      `metricTypes=hrv&since=${encodeURIComponent("2026-09-09T00:00:00.000Z")}`,
    ).expect(200);

    // Only "hrv" appears -- "resting_heart_rate" is excluded by the metricTypes filter even
    // though it shares the same startTime.
    expect(response.body.series).toHaveLength(1);
    const hrv = response.body.series[0];
    expect(hrv.metricType).toBe("hrv");
    // Only the 2026-09-10 point survives -- the 2020 point (and this suite's own earlier
    // 2026-09-07 hrv point) are excluded by the `since` lower bound.
    expect(hrv.points).toEqual([{ startTime: "2026-09-10T00:00:00.000Z", value: 71 }]);
  });

  it("rejects a limit above the bounded maximum instead of silently pulling more history", async () => {
    await seriesWithQuery("limit=999999").expect(400);
  });
});
