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
import { VISION_PROVIDER } from "../src/ai/providers/vision-provider.interface";
import { STORAGE_PROVIDER } from "../src/storage/providers/storage-provider.interface";
import { INBODY_BUCKET } from "../src/body/body.service";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-body-owner-${suiteId}@example.com`;
const ownerExternalId = randomUUID();

/** A real, tiny (1x1) PNG -- `sharp` genuinely decodes and re-encodes this (ADR-024's
 *  server-side re-encode step is not mocked here, only VISION_PROVIDER and STORAGE_PROVIDER
 *  are), so a placeholder string of bytes would correctly be rejected as corrupt. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const FIXTURE_FIELDS = {
  weight_kg: { value: 84.6, confidence: 0.97, readingNote: "" },
  skeletal_muscle_mass_kg: { value: 38.1, confidence: 0.95, readingNote: "" },
  body_fat_mass_kg: { value: 15.5, confidence: 0.94, readingNote: "" },
  body_fat_percent: { value: 18.2, confidence: 0.98, readingNote: "" },
  visceral_fat_level: { value: 8, confidence: 0.72, readingNote: "" },
  total_body_water_l: { value: 45.3, confidence: 0.91, readingNote: "" },
  bmi: { value: 26.4, confidence: 0.96, readingNote: "" },
  basal_metabolic_rate_kcal: { value: 1780, confidence: 0.88, readingNote: "" },
  inbody_score: { value: 79, confidence: 0.93, readingNote: "" },
};

/**
 * The full InBody path over real HTTP: extract -> confirm -> read back -> series. Unit
 * suites already cover each layer's own logic in isolation (nvidia-vision.provider.spec.ts,
 * body.schema.spec.ts); this proves what only wiring the real routes together can --
 * multipart parsing through `FileInterceptor`, the `series` route not being captured by
 * `:id`, and a confirmed scan actually being visible on every read endpoint a moment later.
 *
 * VISION_PROVIDER and STORAGE_PROVIDER are both overridden with in-memory fakes: this suite
 * is about the HTTP/DB wiring, not about NVIDIA's live API (already contract-tested against
 * recorded fixtures) or a live Supabase bucket.
 */
describe("Body scans (e2e)", () => {
  let app: INestApplication;
  let db: Database;
  const uploadedRefs: Array<{ bucket: string; key: string }> = [];

  const extract = (token = "owner-token") =>
    request(app.getHttpServer())
      .post("/api/v1/body-scans/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", TINY_PNG, "scan.png");

  const confirm = (measurements: unknown[], token = "owner-token") =>
    request(app.getHttpServer())
      .post("/api/v1/body-scans")
      .set("Authorization", `Bearer ${token}`)
      .field("data", JSON.stringify({ measuredAt: "2026-01-15T09:00:00.000Z", measurements }))
      .attach("file", TINY_PNG, "scan.png");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [{ email: ownerEmail, externalId: ownerExternalId, tokens: ["owner-token"] }],
          signIn: "disabled",
        }),
      )
      .overrideProvider(VISION_PROVIDER)
      .useValue({
        extractBodyScan: async () => ({
          inbodyModel: "570",
          testDate: "2026-01-15",
          fields: FIXTURE_FIELDS,
          imageQualityNotes: "Clear",
        }),
      })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue({
        upload: async (req: { bucket: string; key: string }) => {
          uploadedRefs.push({ bucket: req.bucket, key: req.key });
          return { bucket: req.bucket, key: req.key };
        },
        exists: async () => true,
        getSignedUrl: async (ref: { key: string }) => `https://example.invalid/signed/${ref.key}`,
        getPublicUrl: (ref: { key: string }) => `https://example.invalid/public/${ref.key}`,
        delete: async () => undefined,
        ensureBucket: async () => undefined,
      })
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
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [ownerEmail]));
    await app.close();
  });

  it("rejects an unauthenticated extract request", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/body-scans/extract")
      .attach("file", TINY_PNG, "scan.png")
      .expect(401);
  });

  it("extracts fields without saving anything", async () => {
    const response = await extract().expect(201);
    expect(response.body.fields.weight_kg.value).toBe(84.6);
    expect(response.body.fields.visceral_fat_level.confidence).toBe(0.72);

    const list = await request(app.getHttpServer())
      .get("/api/v1/body-scans")
      .set("Authorization", "Bearer owner-token")
      .expect(200);
    expect(list.body.scans).toEqual([]);
    expect(uploadedRefs).toHaveLength(0);
  });

  it("confirms a scan and makes it visible on every read endpoint", async () => {
    const measurements = [
      { metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 },
      { metric: "body_fat_percent", value: 18.2, unit: "%", confidence: 0.98 },
    ];

    const confirmed = await confirm(measurements).expect(201);
    expect(confirmed.body.measurements).toHaveLength(2);
    const scanId = confirmed.body.id as string;

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/body-scans/${scanId}`)
      .set("Authorization", "Bearer owner-token")
      .expect(200);
    expect(detail.body.id).toBe(scanId);
    expect(detail.body.measurements).toHaveLength(2);

    const list = await request(app.getHttpServer())
      .get("/api/v1/body-scans")
      .set("Authorization", "Bearer owner-token")
      .expect(200);
    expect(list.body.scans).toHaveLength(1);
    expect(list.body.scans[0].weightKg).toBe(84.6);
    expect(list.body.scans[0].bodyFatPercent).toBe(18.2);
  });

  it("'series' is not captured by ':id' and reflects the confirmed measurements", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/body-scans/series")
      .set("Authorization", "Bearer owner-token")
      .expect(200);

    const weightSeries = response.body.series.find((s: { metric: string }) => s.metric === "weight_kg");
    expect(weightSeries).toBeDefined();
    expect(weightSeries.points).toHaveLength(1);
    expect(weightSeries.points[0].value).toBe(84.6);
  });

  it("uploads the confirmed photo to the private inbody bucket", () => {
    expect(uploadedRefs.length).toBeGreaterThan(0);
    expect(uploadedRefs.every((ref) => ref.bucket === INBODY_BUCKET)).toBe(true);
  });
});
