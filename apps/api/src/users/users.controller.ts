import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  updateProfileRequestSchema,
  type MeResponse,
  type ProfileResponse,
  type UpdateProfileRequest,
} from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() request: AuthenticatedRequest): Promise<MeResponse> {
    return this.usersService.getMe(request.user);
  }

  @Patch('me/profile')
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    return this.usersService.updateProfile(request.user, body);
  }
}
