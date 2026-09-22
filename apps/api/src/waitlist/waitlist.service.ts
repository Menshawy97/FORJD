import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { WaitlistSignupRequest, WaitlistSignupResponse } from '@forjd/contracts';

import { TURNSTILE_CLIENT, TurnstileClient } from '../integrations/turnstile/turnstile-client';
import { WaitlistRepository } from './waitlist.repository';

/**
 * Verifies the Turnstile token first, then stores the address (ADR-051, plan step 4). A new
 * address and a repeat return the identical `{ status: 'accepted' }`, on purpose -- the
 * endpoint would otherwise leak who is already on the list to anyone willing to submit
 * addresses at it.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly repository: WaitlistRepository,
    @Inject(TURNSTILE_CLIENT) private readonly turnstile: TurnstileClient,
  ) {}

  async signUp(request: WaitlistSignupRequest, remoteIp?: string): Promise<WaitlistSignupResponse> {
    const verified = await this.turnstile.verify(request.turnstileToken, remoteIp);
    if (!verified) {
      throw new BadRequestException("We could not verify you're not a robot. Please try again.");
    }

    await this.repository.signUp(request.email);
    return { status: 'accepted' };
  }
}
