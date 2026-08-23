import { NotFoundException } from '@nestjs/common';
import type { UpdateProfileRequest } from '@forjd/contracts';
import { PrivacySettings, Profile, User } from '@forjd/domain';

import { PrivacyService } from '../privacy/privacy.service';
import { ProfilePatch, UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * A unit test, unlike the repository's — the behaviour under test is the precedence between
 * `unitSystem` and the three unit fields, which is entirely in this service. A real database
 * would only slow down a decision Postgres has no part in.
 */
describe('UsersService', () => {
  const user: User = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const profile: Profile = {
    userId: user.id,
    displayName: 'Ada Lovelace',
    dateOfBirth: '1990-07-04',
    sex: 'female',
    heightCm: 172.5,
    unitSystem: 'metric',
    weightUnit: 'kg',
    distanceUnit: 'km',
    energyUnit: 'kcal',
    trainingGoals: ['get_stronger'],
    activities: ['strength'],
    city: null,
    citySlug: null,
    avatarUrl: null,
  };

  /** What every account starts as, and what the opt-in decision means. */
  const allOffPrivacy: PrivacySettings = {
    userId: user.id,
    publicProfile: false,
    leaderboardOptIn: false,
    locationForLeaderboard: false,
    aiFeaturesConsent: false,
    aiFeaturesConsentAt: null,
    crashDiagnostics: false,
  };

  let repository: { findProfile: jest.Mock; updateProfile: jest.Mock };
  let privacyService: { get: jest.Mock; update: jest.Mock };
  let service: UsersService;

  /** The patch the service handed the repository for a given request. */
  const patchFor = async (request: UpdateProfileRequest): Promise<ProfilePatch> => {
    await service.updateProfile(user, request);
    return repository.updateProfile.mock.calls.at(-1)?.[1] as ProfilePatch;
  };

  beforeEach(() => {
    repository = {
      findProfile: jest.fn().mockResolvedValue(profile),
      updateProfile: jest.fn().mockResolvedValue(profile),
    };
    privacyService = {
      get: jest.fn().mockResolvedValue(allOffPrivacy),
      update: jest.fn().mockResolvedValue(allOffPrivacy),
    };
    service = new UsersService(
      repository as unknown as UsersRepository,
      privacyService as unknown as PrivacyService,
    );
  });

  describe('getMe', () => {
    it('returns the profile fields, including the new unit and list fields', async () => {
      await expect(service.getMe(user)).resolves.toEqual({
        id: user.id,
        email: user.email,
        profile: {
          userId: user.id,
          displayName: 'Ada Lovelace',
          dateOfBirth: '1990-07-04',
          sex: 'female',
          heightCm: 172.5,
          unitSystem: 'metric',
          weightUnit: 'kg',
          distanceUnit: 'km',
          energyUnit: 'kcal',
          trainingGoals: ['get_stronger'],
          activities: ['strength'],
          avatarUrl: null,
        },
        privacy: {
          publicProfile: false,
          leaderboardOptIn: false,
          locationForLeaderboard: false,
          aiFeaturesConsent: false,
          aiFeaturesConsentAt: null,
          crashDiagnostics: false,
        },
      });
    });

    /**
     * The settings screen must be one read. A second endpoint for privacy would be a second
     * source for one truth, free to disagree with this one — which is why there is no
     * `GET /users/me/privacy`.
     */
    it('returns privacy alongside the profile, in one read', async () => {
      await service.getMe(user);

      expect(privacyService.get).toHaveBeenCalledWith(user.id);
    });

    it('serialises the consent timestamp as an ISO string, not a Date', async () => {
      privacyService.get.mockResolvedValue({
        ...allOffPrivacy,
        aiFeaturesConsent: true,
        aiFeaturesConsentAt: new Date('2026-03-04T05:06:07.000Z'),
      });

      const me = await service.getMe(user);

      expect(me.privacy.aiFeaturesConsentAt).toBe('2026-03-04T05:06:07.000Z');
    });

    /**
     * Privacy is present even when the profile is not — the row is created with the account,
     * so a client must never treat it as optional the way it treats `profile`.
     */
    it('still returns privacy when the profile row is missing', async () => {
      repository.findProfile.mockResolvedValue(null);

      const me = await service.getMe(user);

      expect(me.profile).toBeNull();
      expect(me.privacy).toMatchObject({ publicProfile: false });
    });

    /** The nested response must not leak the id — the caller already knows whose it is. */
    it('does not echo userId inside the privacy object', async () => {
      const me = await service.getMe(user);

      expect(me.privacy).not.toHaveProperty('userId');
    });
  });

  describe('updatePrivacy', () => {
    it('delegates to the privacy service and returns the wire shape', async () => {
      privacyService.update.mockResolvedValue({ ...allOffPrivacy, publicProfile: true });

      const result = await service.updatePrivacy(user, { publicProfile: true });

      expect(privacyService.update).toHaveBeenCalledWith(user.id, { publicProfile: true });
      expect(result).toEqual({
        publicProfile: true,
        leaderboardOptIn: false,
        locationForLeaderboard: false,
        aiFeaturesConsent: false,
        aiFeaturesConsentAt: null,
        crashDiagnostics: false,
      });
    });

    it('returns a null profile rather than failing when the row is missing', async () => {
      repository.findProfile.mockResolvedValue(null);

      await expect(service.getMe(user)).resolves.toMatchObject({ profile: null });
    });

    /**
     * `city` belongs to phase E and the public projection, and must not appear on the
     * owner's response until the phase that designs it lands. Asserted explicitly because
     * "a field nobody added on purpose" is exactly what a spread would introduce silently.
     */
    it('does not yet expose city on the wire', async () => {
      const me = await service.getMe(user);

      expect(me.profile).not.toHaveProperty('city');
      expect(me.profile).not.toHaveProperty('citySlug');
    });
  });

  describe('updateProfile', () => {
    it('throws NotFound when there is no profile to update', async () => {
      repository.updateProfile.mockResolvedValue(null);

      await expect(service.updateProfile(user, { displayName: 'Ada' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('passes ordinary fields straight through', async () => {
      const patch = await patchFor({ displayName: 'Ada', heightCm: 172.5 });

      expect(patch).toMatchObject({ displayName: 'Ada', heightCm: 172.5 });
    });

    /**
     * The preset. `unitSystem` survives only because removing it would break /api/v1
     * (rule 7); it is a convenience that writes two of the three real preferences.
     */
    it('expands a metric preset into weight and distance', async () => {
      const patch = await patchFor({ unitSystem: 'metric' });

      expect(patch.weightUnit).toBe('kg');
      expect(patch.distanceUnit).toBe('km');
    });

    it('expands an imperial preset into weight and distance', async () => {
      const patch = await patchFor({ unitSystem: 'imperial' });

      expect(patch.weightUnit).toBe('lb');
      expect(patch.distanceUnit).toBe('mi');
    });

    /**
     * Energy is the reason the preset cannot be the model. Neither `kcal` nor `kJ` is the
     * imperial choice — kJ is metric-adjacent and is the norm in markets that are otherwise
     * fully metric — so any mapping from `unitSystem` to energy would be invented, not
     * derived. The preset therefore leaves it alone.
     */
    it('never touches energy when applying a preset', async () => {
      const metric = await patchFor({ unitSystem: 'metric' });
      const imperial = await patchFor({ unitSystem: 'imperial' });

      expect(metric.energyUnit).toBeUndefined();
      expect(imperial.energyUnit).toBeUndefined();
    });

    it('lets an explicit unit win over the preset it contradicts', async () => {
      const patch = await patchFor({ unitSystem: 'metric', weightUnit: 'lb' });

      expect(patch.weightUnit).toBe('lb');
      // The preset still applies to the field the request did not speak about.
      expect(patch.distanceUnit).toBe('km');
      expect(patch.unitSystem).toBe('metric');
    });

    /**
     * The other direction is deliberately not symmetrical. `kg` with `mi` belongs to no
     * system, so there is no honest value to write; back-deriving would have to pick one and
     * would then report a preset the user never chose.
     */
    it('never back-derives the preset from explicit units', async () => {
      const patch = await patchFor({ weightUnit: 'lb', distanceUnit: 'mi', energyUnit: 'kJ' });

      expect(patch.unitSystem).toBeUndefined();
      expect(patch.weightUnit).toBe('lb');
      expect(patch.distanceUnit).toBe('mi');
      expect(patch.energyUnit).toBe('kJ');
    });

    /**
     * A key that is present but explicitly `undefined` must not cancel the preset.
     *
     * Zod's `.partial()` keeps such a key in its output — verified, not assumed — so a plain
     * `{ ...preset, ...request }` spread lets `undefined` win and the preset silently fails
     * to apply to that one field. JSON cannot express `undefined`, so this is unreachable
     * over HTTP today; it is reachable from any in-process caller, and the failure is silent
     * rather than loud, which is what makes it worth pinning.
     */
    it('ignores a present-but-undefined field instead of letting it cancel the preset', async () => {
      const patch = await patchFor({ unitSystem: 'imperial', weightUnit: undefined });

      expect(patch.weightUnit).toBe('lb');
      expect(patch.distanceUnit).toBe('mi');
    });

    /**
     * The counterpart to the test above, and the reason it filters `undefined` specifically
     * rather than anything falsy. `null` is a real instruction — "clear this field" — and
     * dropping it would turn every clear into a silent no-op.
     */
    it('passes null through so a field can still be cleared', async () => {
      const patch = await patchFor({ displayName: null, heightCm: null, sex: null });

      expect(patch.displayName).toBeNull();
      expect(patch.heightCm).toBeNull();
      expect(patch.sex).toBeNull();
    });

    it('leaves every unit field untouched when the request mentions none of them', async () => {
      const patch = await patchFor({ displayName: 'Ada' });

      expect(patch.unitSystem).toBeUndefined();
      expect(patch.weightUnit).toBeUndefined();
      expect(patch.distanceUnit).toBeUndefined();
      expect(patch.energyUnit).toBeUndefined();
    });

    it('passes the goal and activity lists through, including an empty one', async () => {
      const patch = await patchFor({
        trainingGoals: ['get_stronger', 'feel_better'],
        activities: [],
      });

      expect(patch.trainingGoals).toEqual(['get_stronger', 'feel_better']);
      // Clearing every chip is a real choice, not a missing field — the columns are NOT NULL
      // with an empty-array default precisely so the two are the same state.
      expect(patch.activities).toEqual([]);
    });
  });
});
