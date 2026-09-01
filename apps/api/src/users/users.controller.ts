import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  updatePrivacyRequestSchema,
  updateProfileRequestSchema,
  type AvatarUploadResponse,
  type MeResponse,
  type PrivacySettingsResponse,
  type ProfileResponse,
  type UpdatePrivacyRequest,
  type UpdateProfileRequest,
} from '@forjd/contracts';

import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AvatarUploadService, MAX_AVATAR_BYTES, UploadedAvatarFile } from './avatar-upload.service';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarUploadService: AvatarUploadService,
  ) {}

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
  /**
   * `avatars` is a public bucket (ADR-019), so the response is the URL itself, not a signed
   * one -- consistent with `exercise-media` (ADR-018). `limits.fileSize` rejects an oversized
   * part during multer's own parsing, before it is fully buffered into memory -- catching it
   * only in `AvatarUploadService` (still done, as a defense-in-depth belt-and-braces check)
   * would mean the whole oversized body was already buffered by the time it's rejected.
   */
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES } }))
  uploadAvatar(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedAvatarFile,
  ): Promise<AvatarUploadResponse> {
    return this.avatarUploadService.upload(request.user, file);
  }

  /**
   * There is deliberately no matching GET. Privacy rides along on GET /users/me, so the
   * settings screen is one read and one source of truth.
   */
  @Patch('me/privacy')
  updatePrivacy(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updatePrivacyRequestSchema)) body: UpdatePrivacyRequest,
  ): Promise<PrivacySettingsResponse> {
    return this.usersService.updatePrivacy(request.user, body);
  }
}
