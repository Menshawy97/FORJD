import { Test } from "@nestjs/testing";

import { AppModule } from "../src/app.module";

/**
 * The exact production bug this pins: `WhoopModule` (Phase 7F) is always part of
 * `AppModule`'s DI graph now, and its providers (`token-cipher.provider.ts`,
 * `whoop-client.ts`, `whoop-oauth.service.ts`) used to call `ConfigService.getOrThrow` at
 * eager module construction. Every real environment today (dev, staging, production) has no
 * `TOKEN_ENCRYPTION_KEY`/`WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`/`WHOOP_REDIRECT_URI`
 * configured yet (`docs/product/phase-7-plan.md` decision 1) -- the eager `getOrThrow` calls
 * threw during `NestFactory.create()`, which crashed the whole API's boot. This is what
 * broke the real staging Cloud Run deploy immediately after the 7F merge ("container failed
 * to start and listen on the port... within the allocated timeout").
 *
 * Deleting these four variables here is what actually reproduces "not configured in this
 * environment," rather than relying on CI's own placeholders being absent by coincidence.
 */
describe("API boot without WHOOP configuration (e2e)", () => {
  const WHOOP_ENV_KEYS = [
    "TOKEN_ENCRYPTION_KEY",
    "TOKEN_ENCRYPTION_KEY_VERSION",
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
    "WHOOP_REDIRECT_URI",
  ] as const;

  let savedValues: Partial<Record<(typeof WHOOP_ENV_KEYS)[number], string | undefined>>;

  beforeAll(() => {
    savedValues = Object.fromEntries(WHOOP_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of WHOOP_ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    for (const key of WHOOP_ENV_KEYS) {
      const value = savedValues[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("boots the full application successfully with no WHOOP or token-encryption config set", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();

    await expect(app.init()).resolves.not.toThrow();

    await app.close();
  });
});
