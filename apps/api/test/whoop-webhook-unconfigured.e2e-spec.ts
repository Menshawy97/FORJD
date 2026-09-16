import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { WHOOP_CLIENT, type WhoopClient } from "../src/integrations/whoop/whoop-client";
import { FakeAuthProvider } from "./support/fake-auth-provider";

/**
 * R11 (audit-remediation-plan.md): `WhoopController#webhook` used to read
 * `WHOOP_WEBHOOK_SECRET` with `ConfigService.getOrThrow`. When that variable is unset --
 * true of every environment until the WHOOP webhook is actually provisioned with WHOOP --
 * `getOrThrow` throws inside the handler, Nest has no matching exception filter for a plain
 * `Error`, and the anonymous, unauthenticated caller gets a 500. A 500 on a public route is
 * itself a small information leak (it tells a prober the route exists and is unguarded by a
 * normal auth check) and is the wrong status for "signature can never be valid here" -- an
 * unconfigured secret must fail exactly like a wrong one: 401.
 */
describe("WHOOP webhook without WHOOP_WEBHOOK_SECRET configured (e2e)", () => {
  let app: INestApplication;
  let savedSecret: string | undefined;

  beforeAll(async () => {
    savedSecret = process.env.WHOOP_WEBHOOK_SECRET;
    delete process.env.WHOOP_WEBHOOK_SECRET;

    const fakeClient = {
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
      .useValue(new FakeAuthProvider({ accounts: [], signIn: "disabled" }))
      .overrideProvider(WHOOP_CLIENT)
      .useValue(fakeClient as unknown as WhoopClient)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.WHOOP_WEBHOOK_SECRET;
    else process.env.WHOOP_WEBHOOK_SECRET = savedSecret;
    await app.close();
  });

  it("returns 401, not 500, for any webhook call when the secret is unset", async () => {
    const rawBody = JSON.stringify({ user_id: 1, id: "x", type: "recovery.updated", trace_id: "t" });

    await request(app.getHttpServer())
      .post("/api/v1/integrations/whoop/webhook")
      .set("Content-Type", "application/json")
      .set("X-WHOOP-Signature", "irrelevant-signature")
      .set("X-WHOOP-Signature-Timestamp", String(Date.now()))
      .send(rawBody)
      .expect(401);
  });
});
