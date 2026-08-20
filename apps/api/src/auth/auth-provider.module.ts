import { Module } from '@nestjs/common';

import { IdentityCache } from './guards/identity-cache';
import { AUTH_PROVIDER } from './providers/auth-provider.interface';
import { supabaseAuthClientProvider } from './providers/supabase-auth-client';
import { supabaseJwksProvider } from './providers/supabase-jwks';
import { SupabaseAuthProvider } from './providers/supabase-auth.provider';

/**
 * Holds the single binding between the AuthProvider interface and its vendor implementation
 * (ADR-008). Kept separate from AuthModule so both the auth and users modules can depend on
 * it without depending on each other — the guard needs UsersRepository, and AuthService
 * needs the guard's module, which would otherwise be a cycle.
 */
@Module({
  providers: [
    supabaseAuthClientProvider,
    supabaseJwksProvider,
    { provide: AUTH_PROVIDER, useClass: SupabaseAuthProvider },
    // Lives here, and is exported, because AuthModule and UsersModule each instantiate
    // their own JwtAuthGuard. A cache held as guard state would therefore be two caches;
    // one shared provider is a single memory of who is who.
    IdentityCache,
  ],
  exports: [AUTH_PROVIDER, IdentityCache],
})
export class AuthProviderModule {}
