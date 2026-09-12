import { Controller, Delete, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountDeletionService } from './account-deletion.service';

/**
 * A separate controller from `UsersController`, in the same `users` route namespace --
 * `AccountDeletionService` needs `BodyRepository` and the WHOOP providers, and importing
 * `BodyModule`/`WhoopModule` into `UsersModule` (which both of those already import) would be
 * circular. `AccountModule` sits above all three instead; the route path is unaffected.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly accountDeletionService: AccountDeletionService) {}

  /**
   * C1: erases the authenticated user's account -- every storage object, the WHOOP grant and
   * tokens, then the user row itself, whose cascades take every other table with it. See
   * `AccountDeletionService`'s own docblock for why that order.
   */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.accountDeletionService.deleteAccount(request.user.id);
  }
}
