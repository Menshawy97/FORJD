import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RefreshRequest,
  type RegisterRequest,
  type RegisterResponse,
  type SessionResponse,
} from '@forjd/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Credential endpoints are unauthenticated and sit in front of a third-party auth service,
 * so they carry a tighter limit than the global default: enough for a person fumbling a
 * password, far short of a credential-stuffing sweep.
 */
@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): Promise<RegisterResponse> {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
  ): Promise<SessionResponse> {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
  ): Promise<SessionResponse> {
    return this.authService.refresh(body.refreshToken);
  }

  /**
   * 202, not 200-with-a-message: the honest meaning is "accepted — whether an email goes
   * out is deliberately not disclosed". The tighter limit is because each call sends real
   * mail, so the abuse here is bombarding someone else's mailbox rather than stuffing
   * credentials. Note the limit keys on IP, so it caps an origin, not an address; Supabase's
   * own per-address email limit is the backstop until a per-email tracker exists.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest,
  ): Promise<void> {
    await this.authService.requestPasswordReset(body.email);
  }

  /**
   * Behind the guard so the audit entry names a real user. The token is already being sent,
   * so requiring it costs the caller nothing and turns "someone logged out" into
   * "this person logged out".
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    const token = request.headers.authorization?.split(' ')[1];

    if (token) {
      await this.authService.logout(token, request.user.id);
    }
  }
}
