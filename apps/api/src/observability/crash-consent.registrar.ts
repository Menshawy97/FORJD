import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrivacyService } from '../privacy/privacy.service';
import { registerCrashConsentLookup } from './crash-subject';

/**
 * Hands the crash reporter a way to read a user's crash-diagnostics choice. Sentry is
 * initialised before Nest exists (`instrument.ts`), so it cannot be injected there; this
 * registers the lookup once `PrivacyService` is built and withdraws it on shutdown.
 *
 * The choice is read live, only when a crash actually happens, never cached: turning crash
 * diagnostics off is true for the very next crash.
 */
@Injectable()
export class CrashConsentRegistrar implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly privacyService: PrivacyService) {}

  onModuleInit(): void {
    registerCrashConsentLookup(async (userId) => (await this.privacyService.get(userId)).crashDiagnostics);
  }

  onModuleDestroy(): void {
    registerCrashConsentLookup(null);
  }
}
