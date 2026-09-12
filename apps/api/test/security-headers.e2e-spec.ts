import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { AUTH_PROVIDER } from "../src/auth/providers/auth-provider.interface";
import { configureApp } from "../src/bootstrap";
import { Database, DRIZZLE } from "../src/database/database.module";
import { exercises } from "../src/database/schema/exercises.schema";
import { users } from "../src/database/schema/users.schema";
import { FakeAuthProvider } from "./support/fake-auth-provider";

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-security-headers-${suiteId}@example.com`;
const ownerExternalId = randomUUID();
const marker = `sec${suiteId.replace(/[^a-z0-9]/gi, "")}`;

/**
 * R9 / H14 part 1. `apps/api`'s bootstrap had no `helmet()` (missing security headers), no
 * `compression()` (every JSON response, including the ~1,700-row exercise catalogue, shipped
 * uncompressed on free-tier egress), no environment-variable validation (an empty
 * `SUPABASE_SERVICE_ROLE_KEY` failed open at the first request that needed it rather than at
 * boot), and no global `ValidationPipe` safety net behind the per-route `ZodValidationPipe`s.
 */
describe("API bootstrap hardening (e2e)", () => {
  describe("helmet + compression, over real HTTP", () => {
    let app: INestApplication;
    let db: Database;
    const createdExerciseIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AUTH_PROVIDER)
        .useValue(
          new FakeAuthProvider({
            accounts: [{ email: ownerEmail, externalId: ownerExternalId, tokens: ["owner-token"] }],
            signIn: "disabled",
          }),
        )
        .overrideGuard(ThrottlerGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = moduleRef.createNestApplication();
      app.setGlobalPrefix("api/v1");
      configureApp(app);
      await app.init();
      db = app.get<Database>(DRIZZLE);

      await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({ email: ownerEmail, password: "Str0ngPass!" })
        .expect(201);

      // Enough rows, with long enough field values, to push the response past compression's
      // default 1 KB threshold -- the point being to prove a genuinely large payload (stand-in
      // for the ~1,700-row exercise catalogue) is actually gzipped, not just any response.
      for (let i = 0; i < 40; i += 1) {
        const [row] = await db
          .insert(exercises)
          .values({
            ownerUserId: null,
            name: `${marker} Exercise ${i}`,
            slug: `${marker}-exercise-${i}`,
            category: "strength",
            goal: "hypertrophy",
            measure: "weight",
            primaryMuscles: ["chest", "triceps", "shoulders"],
            secondaryMuscles: ["core"],
            equipment: ["barbell", "bench"],
            force: "push",
            level: "beginner",
            mechanic: "compound",
            instructions: [
              "Lie back on a flat bench.",
              "Grip the bar slightly wider than shoulder width.",
              "Lower the bar to your chest under control.",
              "Press the bar back up to full extension.",
            ],
            imageKeys: [],
            description: `${marker} filler description padding out the payload for suite ${i}.`,
            source: "e2e",
            sourceId: `${marker}-exercise-${i}`,
          })
          .returning();
        if (row) createdExerciseIds.push(row.id);
      }
    });

    afterAll(async () => {
      if (createdExerciseIds.length > 0) {
        await db.delete(exercises).where(inArray(exercises.id, createdExerciseIds));
      }
      await db.delete(users).where(eq(users.email, ownerEmail));
      await app.close();
    });

    it("carries the helmet security-header set on an ordinary response", async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/exercises?q=${marker}&limit=1`)
        .set("Authorization", "Bearer owner-token")
        .expect(200);

      // A representative subset, not every header helmet sets -- asserting all of them would
      // make this test brittle against helmet's own version changes.
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-dns-prefetch-control"]).toBe("off");
      expect(response.headers["x-download-options"]).toBe("noopen");
      expect(response.headers).toHaveProperty("cross-origin-resource-policy");
    });

    it("gzip-compresses a large JSON response when the client accepts it", async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/exercises?q=${marker}&limit=100`)
        .set("Authorization", "Bearer owner-token")
        .set("Accept-Encoding", "gzip")
        .expect(200);

      expect(response.headers["content-encoding"]).toBe("gzip");
      expect(response.body.items.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe("environment-variable validation at boot", () => {
    /**
     * `ConfigModule.forRoot({ validate: ... })` is called once, synchronously, the moment
     * `AppModule`'s `@Module({ imports: [...] })` decorator is evaluated -- which happens
     * when `app.module.ts` is first `require`d by the process, not when `.compile()` runs.
     * The statically-imported `AppModule` at the top of this file was therefore already
     * validated against the *original* environment before this test ever runs; mutating
     * `process.env` afterwards and reusing that same `AppModule` reference would prove
     * nothing. `jest.resetModules()` plus a fresh `require` after the mutation forces the
     * decorator (and therefore `validateEnv`) to re-evaluate against the broken environment,
     * matching how a real process boots: env is read once, at startup.
     */
    it("throws at module-compile time when SUPABASE_SERVICE_ROLE_KEY is empty, naming the variable", async () => {
      const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "";
      jest.resetModules();

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const freshAppModule = require("../src/app.module") as typeof import("../src/app.module");

        await expect(
          Test.createTestingModule({ imports: [freshAppModule.AppModule] }).compile(),
        ).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
      } finally {
        if (original === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = original;
        jest.resetModules();
      }
    });
  });

  describe("global ValidationPipe safety net", () => {
    /**
     * Every route in this codebase already validates its body with its own
     * `ZodValidationPipe`, and a bare `z.object()` schema strips unknown keys by default
     * (Zod's "strip" mode) with no configuration needed -- so hitting an existing Zod-validated
     * route with an extra body key proves nothing about whether the *global* pipe is wired in;
     * the Zod pipe alone already produces the same observable result. The global
     * `ValidationPipe({ whitelist: true })` is a safety net for a route that someday forgets
     * its Zod pipe, so the faithful test is that it is actually registered, not a behavioral
     * diff against a route that would pass either way. See the PR body for the full reasoning.
     */
    it("registers a global ValidationPipe configured with whitelist: true", () => {
      const useGlobalPipes = jest.fn();
      const app = { use: jest.fn(), useGlobalPipes } as unknown as INestApplication;

      configureApp(app);

      expect(useGlobalPipes).toHaveBeenCalledTimes(1);
      const [pipe] = useGlobalPipes.mock.calls[0] as [ValidationPipe];
      expect(pipe).toBeInstanceOf(ValidationPipe);
      expect((pipe as unknown as { validatorOptions: { whitelist: boolean } }).validatorOptions.whitelist).toBe(
        true,
      );
    });
  });
});
