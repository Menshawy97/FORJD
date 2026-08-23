import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  MeResponse,
  PrivacySettingsResponse,
  ProfileResponse,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from '@forjd/contracts';
import { Plan, PrivacySettings, Profile, UnitSystem, User } from '@forjd/domain';
import * as Sentry from '@sentry/nestjs';

import { applyCrashDiagnosticsConsent } from '../observability/sentry-scrub';
import { PrivacyService } from '../privacy/privacy.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { slugifyCity } from './city-slug';
import { ProfilePatch, UsersRepository } from './users.repository';

/**
 * `userId` is deliberately dropped: the caller already knows whose settings these are, and
 * echoing an id into a nested object invites a client to key off it.
 */
function toPrivacyResponse(settings: PrivacySettings): PrivacySettingsResponse {
  return {
    publicProfile: settings.publicProfile,
    leaderboardOptIn: settings.leaderboardOptIn,
    locationForLeaderboard: settings.locationForLeaderboard,
    aiFeaturesConsent: settings.aiFeaturesConsent,
    aiFeaturesConsentAt: settings.aiFeaturesConsentAt?.toISOString() ?? null,
    crashDiagnostics: settings.crashDiagnostics,
  };
}

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
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly privacyService: PrivacyService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Reads profile, privacy and plan together. Privacy rides along rather than living behind
   * its own `GET /users/me/privacy`, so the settings screen is one request and there is one
   * source for one truth — two endpoints would be two answers free to disagree. Plan is
   * fetched here rather than assumed, even though it is hardcoded today, because the point of
   * `SubscriptionService` as a seam is that every caller already asks it.
   *
   * When `profile` turns out to be null, the `plan` fetched here is discarded below. That is
   * a real wasted call once `getPlan` reads a billing table in Phase 10, not merely today
   * while it is a free in-memory constant — worth reconsidering then (e.g. skip the fetch, or
   * accept the cost since a missing profile is itself abnormal), not before.
   */
  async getMe(user: User): Promise<MeResponse> {
    const [profile, privacy, plan] = await Promise.all([
      this.usersRepository.findProfile(user.id),
      this.privacyService.get(user.id),
      this.subscriptionService.getPlan(user.id),
    ]);

    // The one point in a request that has genuinely read this user's diagnostics choice, so
    // it is where the crash reporter is told about it. Not cached: the tag is set from the
    // row that was just read.
    applyCrashDiagnosticsConsent(Sentry.getCurrentScope(), privacy.crashDiagnostics);

    return {
      id: user.id,
      email: user.email,
      profile: profile ? this.toProfileResponse(profile, plan) : null,
      privacy: toPrivacyResponse(privacy),
    };
  }

  async updatePrivacy(user: User, request: UpdatePrivacyRequest): Promise<PrivacySettingsResponse> {
    return toPrivacyResponse(await this.privacyService.update(user.id, request));
  }

  async updateProfile(user: User, request: UpdateProfileRequest): Promise<ProfileResponse> {
    const [updated, plan] = await Promise.all([
      this.usersRepository.updateProfile(user.id, this.toPatch(request)),
      this.subscriptionService.getPlan(user.id),
    ]);

    if (!updated) {
      throw new NotFoundException('Profile not found');
    }

    return this.toProfileResponse(updated, plan);
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

    // citySlug is derived here and only here. There is no such field on
    // `UpdateProfileRequest`, so nothing above could have set it from the request — this is
    // the sole place a ProfilePatch carrying citySlug is built. Deriving it from `city` rather
    // than trusting anything client-supplied is what keeps the two from disagreeing.
    if (request.city !== undefined) {
      patch.city = request.city;
      patch.citySlug = request.city === null ? null : slugifyCity(request.city);
    }

    return patch;
  }

  private toProfileResponse(profile: Profile, plan: Plan): ProfileResponse {
    // Every field is named explicitly rather than spread. A spread would put adding a column
    // to `Profile` one keystroke away from publishing it, and `plan` is not even a column —
    // it comes from the subscription seam, not from this object, so a spread could not have
    // produced it correctly anyway.
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
      city: profile.city,
      avatarUrl: profile.avatarUrl,
      plan,
    };
  }
}
