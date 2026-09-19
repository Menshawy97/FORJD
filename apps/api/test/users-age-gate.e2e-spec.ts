import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { Database, DRIZZLE } from "../src/database/database.module";
import { users } from "../src/database/schema/users.schema";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const adultEmail = `e2e-age-adult-${suiteId}@example.com`;
const youngEmail = `e2e-age-young-${suiteId}@example.com`;
const adultExternalId = randomUUID();
const youngExternalId = randomUUID();

/** `YYYY-MM-DD`, `years` full years before today (plus `extraDays` days), in local time. */
function dateYearsAgo(years: number, extraDays = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear() - years, now.getMonth(), now.getDate() - extraDays);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * ADR-042, over real HTTP and real Postgres: an account with no date of birth is refused by
 * every route bar the ones needed to finish the check; an under-16 answer deletes the account
 * (including the upstream login); an adult answer opens everything; and the date can never be
 * changed or cleared afterwards.
 */
describe("Age gate (e2e)", () => {
  let app: INestApplication;
  let db: Database;
  let fakeAuth: FakeAuthProvider;

  beforeAll(async () => {
    fakeAuth = new FakeAuthProvider({
      accounts: [
        { email: adultEmail, externalId: adultExternalId, tokens: ["adult-token"] },
        { email: youngEmail, externalId: youngExternalId, tokens: ["young-token"] },
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

    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: adultEmail, password: "Str0ngPass!" }).expect(201);
    await request(app.getHttpServer()).post("/api/v1/auth/register").send({ email: youngEmail, password: "Str0ngPass!" }).expect(201);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [adultEmail, youngEmail]));
    await app.close();
  });

  it("refuses a feature route for an account with no date of birth, with a code the app acts on", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/workouts/templates")
      .set("Authorization", "Bearer adult-token")
      .expect(403);

    expect(response.body.code).toBe("date_of_birth_required");
  });

  it("still lets that account read itself, so the app can tell what to do next", async () => {
    await request(app.getHttpServer()).get("/api/v1/users/me").set("Authorization", "Bearer adult-token").expect(200);
  });

  it("rejects a date of birth in the wrong format or in the future before the service is reached", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: "19/09/2000" })
      .expect(400);
    await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: dateYearsAgo(0, -3) })
      .expect(400);
  });

  it("an adult answer stores the date and opens every route", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: dateYearsAgo(30) })
      .expect(204);

    await request(app.getHttpServer()).get("/api/v1/workouts/templates").set("Authorization", "Bearer adult-token").expect(200);
    const me = await request(app.getHttpServer()).get("/api/v1/users/me").set("Authorization", "Bearer adult-token").expect(200);
    expect(me.body.profile.dateOfBirth).toBe(dateYearsAgo(30));
  });

  it("sending the same date again is a harmless no-op (a retry after a later step failed)", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: dateYearsAgo(30) })
      .expect(204);
  });

  it("never lets an existing date be replaced, and never deletes the account for trying", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: dateYearsAgo(8) })
      .expect(409);

    const [stillThere] = await db.select().from(users).where(eq(users.email, adultEmail));
    expect(stillThere).toBeDefined();
  });

  it("does not let a profile edit clear the date of birth or make it underage", async () => {
    await request(app.getHttpServer())
      .patch("/api/v1/users/me/profile")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch("/api/v1/users/me/profile")
      .set("Authorization", "Bearer adult-token")
      .send({ dateOfBirth: dateYearsAgo(10) })
      .expect(400);
  });

  it("an under-16 answer deletes the account and the upstream login, and says why", async () => {
    const response = await request(app.getHttpServer())
      .put("/api/v1/users/me/date-of-birth")
      .set("Authorization", "Bearer young-token")
      .send({ dateOfBirth: dateYearsAgo(15) })
      .expect(403);

    expect(response.body.code).toBe("underage");
    const [gone] = await db.select().from(users).where(eq(users.email, youngEmail));
    expect(gone).toBeUndefined();
    expect(fakeAuth.deletedExternalIds).toContain(youngExternalId);
    expect(fakeAuth.deletedExternalIds).not.toContain(adultExternalId);
  });
});
