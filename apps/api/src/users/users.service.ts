import { Injectable, NotFoundException } from '@nestjs/common';
import type { MeResponse, ProfileResponse, UpdateProfileRequest } from '@forjd/contracts';
import { Profile, UnitSystem, User } from '@forjd/domain';

import { ProfilePatch, UsersRepository } from './users.repository';

/**
 * What each `unitSystem` preset writes. Energy is absent on purpose and not by omission:
 * `kJ` is the norm in markets that are otherwise fully metric, so neither energy unit is the
 * "imperial" one, and any mapping from a system to an energy unit would be invented rather
 * than derived. That asymmetry is the reason the three units are real preferences and
 * `unitSystem` is only a convenience over two of them. See ADR-016.
 */
const UNIT_SYSTEM_PRESETS = {
  metric: { weightUnit: 'kg', distanceUnit: 'km' },
  imperial: { weightUnit: 'lb', distanceUnit: 'mi' },
} as const satisfies Record<UnitSystem, Pick<ProfilePatch, 'weightUnit' | 'distanceUnit'>>;

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

  async updateProfile(user: User, request: UpdateProfileRequest): Promise<ProfileResponse> {
    const updated = await this.usersRepository.updateProfile(user.id, this.toPatch(request));

    if (!updated) {
      throw new NotFoundException('Profile not found');
    }

    return this.toProfileResponse(updated);
  }

  /**
   * Turns a validated request into a repository patch, resolving `unitSystem` against the
   * three real unit fields. Three rules, and the asymmetry between them is deliberate:
   *
   * 1. A preset expands into weight and distance — and never energy.
   * 2. An explicit unit in the same request **wins** over the preset that contradicts it.
   *    The alternative, rejecting the combination, would fail a request whose intent is
   *    perfectly clear ("imperial, but weigh me in kg").
   * 3. Explicit units **never** back-derive the preset. There is no honest value to write:
   *    `kg` with `mi` belongs to no system, so a derived answer would report a preset the
   *    user never chose. `unitSystem` is therefore only ever what someone actually sent.
   */
  private toPatch(request: UpdateProfileRequest): ProfilePatch {
    const preset = request.unitSystem ? UNIT_SYSTEM_PRESETS[request.unitSystem] : undefined;

    // Rule 2 is the layering: the preset lands first, the request's own fields land on top.
    //
    // The request's fields are copied one at a time rather than spread, because a spread
    // would let a *present-but-undefined* key win. Zod's `.partial()` keeps such a key in its
    // output — an omitted `weightUnit` is absent, but an explicitly-undefined one is present
    // with the value `undefined` — so `{ ...preset, ...request }` would silently cancel the
    // preset for that field. JSON cannot express `undefined`, so no HTTP client can trigger
    // it; an in-process caller can, and it would fail quietly.
    //
    // Fields the request genuinely omitted stay absent, which the repository reads as "leave
    // this column alone" rather than "clear it" — the distinction `updateProfile` relies on.
    const patch: ProfilePatch = { ...preset };

    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }

    return patch;
  }

  private toProfileResponse(profile: Profile): ProfileResponse {
    // Every field is named explicitly rather than spread. A spread would put adding a column
    // to `Profile` one keystroke away from publishing it — which is exactly how `city` would
    // reach the wire before the phase that decides what it means.
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      dateOfBirth: profile.dateOfBirth,
      sex: profile.sex,
      heightCm: profile.heightCm,
      unitSystem: profile.unitSystem,
      weightUnit: profile.weightUnit,
      distanceUnit: profile.distanceUnit,
      energyUnit: profile.energyUnit,
      trainingGoals: profile.trainingGoals,
      activities: profile.activities,
      avatarUrl: profile.avatarUrl,
    };
  }
}
