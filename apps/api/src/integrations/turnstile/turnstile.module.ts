import { Module } from "@nestjs/common";

import { TURNSTILE_CLIENT, turnstileClientProvider } from "./turnstile-client";

/**
 * Provides the Turnstile verifier to whichever module needs to check a challenge token. It is
 * not imported by `AppModule` yet: the waitlist module that will use it arrives in W3b, and an
 * integration nothing consumes has no reason to be in the boot graph.
 */
@Module({
  providers: [turnstileClientProvider],
  exports: [TURNSTILE_CLIENT],
})
export class TurnstileModule {}
