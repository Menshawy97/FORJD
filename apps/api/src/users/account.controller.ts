import { Controller, Delete, Get, HttpCode, HttpStatus, Req, UseGuards } from '@nestjs/common';
import type { AccountExportResponse } from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountDeletionService } from './account-deletion.service';
import { AccountExportService } from './account-export.service';

/**
 * A separate controller from `UsersController`, in the same `users` route namespace --
 * `AccountDeletionService` needs `BodyRepository` and the WHOOP providers, and importing
 * `BodyModule`/`WhoopModule` into `UsersModule` (which both of those already import) would be
 * circular. `AccountModule` sits above all three instead; the route path is unaffected.
 *
 * R4's export route lives here too, for the same reason: `AccountExportService` needs
 * `WorkoutsModule`/`ProgramsModule`/`NutritionModule`/`HealthDataModule` alongside everything
 * this controller already pulls in, and those modules import `UsersModule`, not the reverse.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly accountDeletionService: AccountDeletionService,
    private readonly accountExportService: AccountExportService,
  ) {}

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

  /**
   * R4 (H2), GDPR Art. 15 & 20: a full copy of everything FORJD holds about the authenticated
   * caller, scoped strictly to `request.user` -- never a client-supplied id, the same
   * discipline `deleteMe` holds above.
   */
  @Get('me/export')
  async exportMe(@Req() request: AuthenticatedRequest): Promise<AccountExportResponse> {
    return this.accountExportService.exportAccount(request.user.id, request.user.email);
  }
}
