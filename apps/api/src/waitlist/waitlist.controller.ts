import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  waitlistSignupRequestSchema,
  WaitlistSignupRequest,
  WaitlistSignupResponse,
} from '@forjd/contracts';
import type { Request } from 'express';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WaitlistService } from './waitlist.service';

/**
 * `POST /api/v1/waitlist` (ADR-051), the getforjd.com sign-up form's endpoint. Public --
 * no `@UseGuards` -- because there is no user account to authenticate at this point; the
 * Turnstile token inside the body is what stands in for a login here.
 *
 * The limit (5 per 10 minutes) is tighter than the global default and keyed by the caller's
 * address, same as every other unauthenticated write in this codebase (`AuthController`).
 * `req.ip` is trustworthy despite that: `configureTrustProxy` (`trust-proxy.ts`) tells
 * Express to trust exactly the one hop Cloud Run's Front End adds, so a client-supplied
 * `X-Forwarded-For` entry cannot spoof it.
 */
@Controller('waitlist')
@Throttle({ default: { limit: 5, ttl: 600_000 } })
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  signUp(
    @Body(new ZodValidationPipe(waitlistSignupRequestSchema)) body: WaitlistSignupRequest,
    @Req() request: Request,
  ): Promise<WaitlistSignupResponse> {
    return this.waitlistService.signUp(body, request.ip);
  }
}
