import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client SupabaseStorageProvider speaks through, bound separately from the
 * adapter itself so tests can substitute a stub -- same fix, same reasoning, as
 * `supabase-auth-client.ts` (ADR-011): a provider that calls `createClient` in its own
 * constructor is verifiable only by hand against a live project. Construction stays
 * centralised here, inside the one directory the architecture conformance check allows the
 * Supabase SDK to be imported from (rule 11, ADR-008).
 */
export const SUPABASE_STORAGE_CLIENT = Symbol('SUPABASE_STORAGE_CLIENT');

/**
 * Exported (not just used inline below) so `exercises:mirror-media` -- a script, not a Nest
 * provider, running outside the DI container -- can build the same client without importing
 * `@supabase/supabase-js` itself, which `check-architecture-conformance.sh` forbids outside
 * this directory (rule 11).
 */
export function createSupabaseStorageClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const supabaseStorageClientProvider: Provider = {
  provide: SUPABASE_STORAGE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SupabaseClient =>
    createSupabaseStorageClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    ),
};
