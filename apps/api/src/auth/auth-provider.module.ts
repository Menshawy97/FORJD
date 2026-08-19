import { Module } from '@nestjs/common';

import { AUTH_PROVIDER } from './providers/auth-provider.interface';
import { SupabaseAuthProvider } from './providers/supabase-auth.provider';

/**
 * Holds the single binding between the AuthProvider interface and its vendor implementation
 * (ADR-008). Kept separate from AuthModule so both the auth and users modules can depend on
 * it without depending on each other — the guard needs UsersRepository, and AuthService
 * needs the guard's module, which would otherwise be a cycle.
 */
@Module({
  providers: [{ provide: AUTH_PROVIDER, useClass: SupabaseAuthProvider }],
  exports: [AUTH_PROVIDER],
})
export class AuthProviderModule {}
