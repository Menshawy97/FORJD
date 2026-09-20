import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const knownEmail = `e2e-resend-known-${suiteId}@example.com`;
const unknownEmail = `e2e-resend-unknown-${suiteId}@example.com`;

/**
 * The "Resend email" button's endpoint, over real HTTP with the real throttler: it answers 202
 * for any well-formed address (a registered one and an unknown one read the same), refuses a
 * malformed body before reaching the provider, and is limited to three sends per fifteen minutes
 * because each call sends real mail.
 */
describe("Resend confirmation email (e2e)", () => {
  let app: INestApplication;
  let fakeAuth: FakeAuthProvider;

  beforeAll(async () => {
    fakeAuth = new FakeAuthProvider({
      accounts: [{ email: knownEmail, externalId: `ext-${suiteId}`, tokens: ["token"] }],
      signIn: "disabled",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(fakeAuth)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // The limit is three calls per fifteen minutes per client and it counts every call, including
  // ones the body check later refuses, so these three tests spend the budget in order: two
  // accepted, one rejected, then the one that must be turned away.
  it("answers 202 with an empty body for a registered and an unknown address alike", async () => {
    const known = await request(app.getHttpServer())
      .post("/api/v1/auth/resend-confirmation")
      .send({ email: knownEmail })
      .expect(202);
    const unknown = await request(app.getHttpServer())
      .post("/api/v1/auth/resend-confirmation")
      .send({ email: unknownEmail })
      .expect(202);

    expect(known.body).toEqual(unknown.body);
    expect(fakeAuth.confirmationResends).toEqual([knownEmail, unknownEmail]);
  });

  it("rejects a malformed request before reaching the provider", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/resend-confirmation")
      .send({ email: "not-an-email" })
      .expect(400);

    expect(fakeAuth.confirmationResends).toHaveLength(2);
  });

  it("turns away a fourth call inside fifteen minutes", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/resend-confirmation")
      .send({ email: knownEmail })
      .expect(429);

    expect(fakeAuth.confirmationResends).toHaveLength(2);
  });
});
