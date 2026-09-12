import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { bodyMeasurements, bodyScans } from "../src/database/schema/body.schema";
import { users } from "../src/database/schema/users.schema";
import { VISION_PROVIDER } from "../src/ai/providers/vision-provider.interface";
import { STORAGE_PROVIDER } from "../src/storage/providers/storage-provider.interface";
import { INBODY_BUCKET } from "../src/body/body.service";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-body-owner-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
// C2: a second account that never opts into AI features, for the consent-gate tests.
const noConsentEmail = `e2e-body-no-consent-${suiteId}@example.com`;
const noConsentExternalId = randomUUID();

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

const FIXTURE_SEGMENTAL = {
  right_arm: { value: 3.62, confidence: 0.86, readingNote: "" },
  left_arm: { value: 3.55, confidence: 0.85, readingNote: "" },
  trunk: { value: 31.4, confidence: 0.92, readingNote: "" },
  right_leg: { value: 10.28, confidence: 0.86, readingNote: "" },
  left_leg: { value: 10.11, confidence: 0.84, readingNote: "" },
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
  let visionCallCount = 0;

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
          accounts: [
            { email: ownerEmail, externalId: ownerExternalId, tokens: ["owner-token"] },
            { email: noConsentEmail, externalId: noConsentExternalId, tokens: ["no-consent-token"] },
          ],
          signIn: "disabled",
        }),
      )
      .overrideProvider(VISION_PROVIDER)
      .useValue({
        extractBodyScan: async () => {
          visionCallCount += 1;
          return {
            inbodyModel: "570",
            testDate: "2026-01-15",
            fields: FIXTURE_FIELDS,
            segmental: FIXTURE_SEGMENTAL,
            imageQualityNotes: "Clear",
          };
        },
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
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: noConsentEmail, password: "Str0ngPass!" })
      .expect(201);

    // C2: extract/confirm are gated on aiFeaturesConsent, which defaults to false. The rest
    // of this suite is about the scan pipeline, not consent, so the owner opts in once here;
    // the dedicated consent-gate tests below use noConsentEmail, which never does.
    await request(app.getHttpServer())
      .patch("/api/v1/users/me/privacy")
      .set("Authorization", "Bearer owner-token")
      .send({ aiFeaturesConsent: true })
      .expect(200);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [ownerEmail, noConsentEmail]));
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

  describe("the AI consent gate (C2)", () => {
    it("returns 403 for extract, with no vision call, when the user's consent is off", async () => {
      const callsBefore = visionCallCount;

      await extract("no-consent-token").expect(403);

      expect(visionCallCount).toBe(callsBefore);
    });

    it("returns 403 for confirm, with no upload or vision call, when the user's consent is off", async () => {
      const callsBefore = visionCallCount;
      const uploadsBefore = uploadedRefs.length;

      await confirm(
        [{ metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 }],
        "no-consent-token",
      ).expect(403);

      expect(visionCallCount).toBe(callsBefore);
      expect(uploadedRefs.length).toBe(uploadsBefore);
    });
  });
});

/**
 * A separate app instance that does NOT override `ThrottlerGuard` -- the main suite above
 * disables it entirely so the scan-pipeline tests are not rate-limited, which is exactly why
 * the throttle itself needs its own instance to prove anything.
 */
describe("Body scans -- vision route throttle (e2e)", () => {
  let app: INestApplication;
  let db: Database;
  const throttleEmail = `e2e-body-throttle-${suiteId}@example.com`;
  const throttleExternalId = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [{ email: throttleEmail, externalId: throttleExternalId, tokens: ["throttle-token"] }],
          signIn: "disabled",
        }),
      )
      .overrideProvider(VISION_PROVIDER)
      .useValue({
        extractBodyScan: async () => ({
          inbodyModel: "570",
          testDate: "2026-01-15",
          fields: FIXTURE_FIELDS,
          segmental: FIXTURE_SEGMENTAL,
          imageQualityNotes: "Clear",
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: throttleEmail, password: "Str0ngPass!" })
      .expect(201);
    await request(app.getHttpServer())
      .patch("/api/v1/users/me/privacy")
      .set("Authorization", "Bearer throttle-token")
      .send({ aiFeaturesConsent: true })
      .expect(200);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [throttleEmail]));
    await app.close();
  });

  it("rate-limits extract well short of the global 60/min default", async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post("/api/v1/body-scans/extract")
        .set("Authorization", "Bearer throttle-token")
        .attach("file", TINY_PNG, "scan.png");

    const statuses: number[] = [];
    // The global default is 60/min; a per-route limit tight enough to matter for cost must
    // trip well before that on a burst of calls within the same window.
    for (let i = 0; i < 15; i += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses).toContain(429);
  });
});

/**
 * R7 (H3): a real HTTP-level regression test for the transaction fix. `confirm` used to run
 * `insert(bodyScans)` and `insert(bodyMeasurements)` as two independent statements; a crash
 * between them left an orphaned scan row with zero measurements, unrecoverable because
 * vision extraction is never re-run.
 *
 * The confirm payload is validated by `confirmBodyScanRequestSchema` before it ever reaches
 * the repository, so there is no way to make the *measurements* insert fail at the DB layer
 * (a NOT NULL / FK / type violation) using only a request body that also satisfies Zod --
 * every field Zod accepts is also a value Postgres accepts. So this suite overrides DRIZZLE
 * with a database whose `transaction()` hands the caller a `tx` that behaves exactly like
 * the real one, except that `insert(bodyMeasurements)` inside that transaction always
 * rejects. That is the same failure shape as a mid-write crash: the scan insert has already
 * gone through on `tx` when the measurements insert throws.
 */
describe("Body scans -- transaction integrity on a forced measurement-insert failure (e2e, H3)", () => {
  let app: INestApplication;
  let db: Database;
  let pool: Pool;
  const txEmail = `e2e-body-tx-${suiteId}@example.com`;
  const txExternalId = randomUUID();

  /** Wraps a real Drizzle database so any `tx.insert(bodyMeasurements)` issued inside a
   *  `transaction()` callback rejects, while every other call (including `tx.insert(bodyScans)`
   *  on the very same transaction, and every call outside a transaction) goes through to the
   *  real client untouched. */
  const withFailingMeasurementsInsert = (real: Database): Database =>
    new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (callback: (tx: unknown) => unknown) =>
            (
              Reflect.get(target, prop, receiver) as unknown as (
                cb: (tx: Record<string, unknown>) => unknown,
              ) => unknown
            ).call(
              target,
              (tx: Record<string, unknown>) =>
                callback(
                  new Proxy(tx, {
                    get(txTarget, txProp, txReceiver) {
                      if (txProp === "insert") {
                        return (table: unknown) => {
                          if (table === bodyMeasurements) {
                            return {
                              values: () => Promise.reject(new Error("forced measurement insert failure (test)")),
                            };
                          }
                          return (Reflect.get(txTarget, txProp, txReceiver) as (t: unknown) => unknown).call(
                            txTarget,
                            table,
                          );
                        };
                      }
                      const value = Reflect.get(txTarget, txProp, txReceiver);
                      return typeof value === "function" ? value.bind(txTarget) : value;
                    },
                  }),
                ),
            );
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Database;

  const confirmTx = (measurements: unknown[]) =>
    request(app.getHttpServer())
      .post("/api/v1/body-scans")
      .set("Authorization", "Bearer tx-token")
      .field("data", JSON.stringify({ measuredAt: "2026-01-15T09:00:00.000Z", measurements }))
      .attach("file", TINY_PNG, "scan.png");

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL ?? "postgresql://forjd:forjd_local_dev@localhost:5432/forjd";
    pool = new Pool({ connectionString });
    const realDb = drizzle(pool) as unknown as Database;
    db = withFailingMeasurementsInsert(realDb);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE)
      .useValue(db)
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [{ email: txEmail, externalId: txExternalId, tokens: ["tx-token"] }],
          signIn: "disabled",
        }),
      )
      .overrideProvider(VISION_PROVIDER)
      .useValue({
        extractBodyScan: async () => ({
          inbodyModel: "570",
          testDate: "2026-01-15",
          fields: FIXTURE_FIELDS,
          segmental: FIXTURE_SEGMENTAL,
          imageQualityNotes: "Clear",
        }),
      })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue({
        upload: async () => undefined,
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

    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: txEmail, password: "Str0ngPass!" })
      .expect(201);
    await request(app.getHttpServer())
      .patch("/api/v1/users/me/privacy")
      .set("Authorization", "Bearer tx-token")
      .send({ aiFeaturesConsent: true })
      .expect(200);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [txEmail]));
    await app.close();
    await pool.end();
  });

  it("leaves no scan row with zero measurements after the measurements insert fails mid-transaction", async () => {
    await confirmTx([{ metric: "weight_kg", value: 84.6, unit: "kg", confidence: 0.97 }]).expect(500);

    const [userRow] = await db.select().from(users).where(eq(users.email, txEmail));
    if (!userRow) throw new Error("test user not found");

    const scanRows = await db.select().from(bodyScans).where(eq(bodyScans.userId, userRow.id));
    expect(scanRows).toHaveLength(0);
  });
});
