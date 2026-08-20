import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client SupabaseAuthProvider speaks through, bound separately from the
 * adapter itself so tests can substitute a stub.
 *
 * The adapter used to call `createClient` in its own constructor, which left its
 * enumeration defence and its weak-password passthrough verifiable only by hand against a
 * live project (ADR-011). Injecting the client is the whole of the fix: construction is
 * still centralised here, and this file stays inside the one directory the architecture
 * conformance check allows the Supabase SDK to be imported from (rule 11, ADR-008).
 */
export const SUPABASE_AUTH_CLIENT = Symbol('SUPABASE_AUTH_CLIENT');

export const supabaseAuthClientProvider: Provider = {
  provide: SUPABASE_AUTH_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SupabaseClient =>
    createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
};
