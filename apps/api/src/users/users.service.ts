import { Injectable, NotFoundException } from '@nestjs/common';
import type { MeResponse, ProfileResponse, UpdateProfileRequest } from '@forjd/contracts';
import { Profile, User } from '@forjd/domain';

import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getMe(user: User): Promise<MeResponse> {
    const profile = await this.usersRepository.findProfile(user.id);

    return {
      id: user.id,
      email: user.email,
      profile: profile ? this.toProfileResponse(profile) : null,
    };
  }

  async updateProfile(user: User, patch: UpdateProfileRequest): Promise<ProfileResponse> {
    const updated = await this.usersRepository.updateProfile(user.id, patch);

    if (!updated) {
      throw new NotFoundException('Profile not found');
    }

    return this.toProfileResponse(updated);
  }

  private toProfileResponse(profile: Profile): ProfileResponse {
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      dateOfBirth: profile.dateOfBirth,
      sex: profile.sex,
      heightCm: profile.heightCm,
      unitSystem: profile.unitSystem,
      avatarUrl: profile.avatarUrl,
    };
  }
}
