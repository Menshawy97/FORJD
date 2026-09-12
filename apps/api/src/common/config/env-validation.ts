import { z } from 'zod';

/**
 * Environment variables that a provider reads via `ConfigService.getOrThrow` from a factory
 * that Nest constructs eagerly and unconditionally as part of the DI graph -- so an empty or
 * missing value here previously failed open at the first request that happened to touch that
 * provider, rather than failing at boot (R9 / H14 part 1). Sources, one per variable:
 *
 * - `DATABASE_URL` -- `database/database.module.ts`'s `PG_POOL` factory (`new Pool(...)`).
 * - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` -- both
 *   `auth/providers/supabase-auth-client.ts` and `storage/providers/supabase-storage-client.ts`
 *   call `createClient` with these in a `useFactory` bound in `AuthModule`/`StorageModule`.
 * - `OPENAI_API_KEY` -- `ai/providers/openai-vision-client.ts`'s client factory, bound in
 *   `AiModule`, the production vision vendor (ADR-032/ADR-033).
 *
 * Deliberately **not** required here, even though each is also read via `getOrThrow`
 * somewhere in `apps/api/src`:
 *
 * - `TOKEN_ENCRYPTION_KEY` (`common/crypto/token-cipher.provider.ts`) -- read lazily, inside
 *   `encrypt`/`decrypt`, not at factory construction. This is intentional (see that file's own
 *   docblock): the 7F merge that first registered `WhoopModule` unconditionally broke the
 *   staging boot by reading this eagerly, and `whoop-optional-config.e2e-spec.ts` pins that
 *   the app boots fine with it unset. Requiring it here would reintroduce that regression.
 * - `WHOOP_WEBHOOK_SECRET` (`integrations/whoop/whoop.controller.ts`) -- read lazily inside
 *   the webhook handler, once per request, not at boot. R11 replaces this call with
 *   `config.get(..., "")` plus a 401 instead of a 500; left alone here to avoid overlapping
 *   with that slice.
 * - `NVIDIA_API_KEY` (`ai/providers/nvidia-vision-client.ts`) -- the provider that reads it is
 *   not bound in `ai.module.ts` today (`AiModule` only wires the OpenAI vendor), so nothing in
 *   the DI graph constructs it; requiring it would fail boot in every environment that has
 *   never set a development-only, NVIDIA-specific key.
 */
const requiredEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPABASE_URL: z.string().min(1, 'SUPABASE_URL is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
});

/**
 * `ConfigModule.forRoot`'s `validate` option. Nest calls this once, synchronously, against
 * the raw merged environment during module resolution -- before any provider in the DI graph
 * is constructed -- so a thrown error here surfaces at `NestFactory.create()` /
 * `Test.createTestingModule(...).compile()`, not at the first request.
 *
 * Returns the input unchanged (rather than `result.data`) so every other environment
 * variable -- optional ones this schema does not model -- keeps flowing through
 * `ConfigService` exactly as before; only the presence of the four required values is being
 * asserted, not their shape reduced to this schema's keys.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const result = requiredEnvSchema.safeParse(config);

  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration -- missing or empty: ${missing}`);
  }

  return config;
}
