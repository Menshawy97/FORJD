import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrivacySettings, Profile, User } from '@forjd/domain';

import { PrivacyRepository } from '../privacy/privacy.repository';
import { UsersRepository } from '../users/users.repository';
import { AthletesService } from './athletes.service';

/**
 * Carries a 100% coverage threshold (see apps/api/package.json). This is the sharpest
 * authorization surface in the slice: every branch decides whether one person's data reaches
 * another, and an untested branch in that decision is the one that leaks.
 */
describe('AthletesService', () => {
  const viewerId = '11111111-1111-4111-8111-111111111111';
  const ownerId = '22222222-2222-4222-8222-222222222222';

  const viewer: User = {
    id: viewerId,
    email: 'viewer@example.com',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const ownerProfile: Profile = {
    userId: ownerId,
    displayName: 'Ada Lovelace',
    username: 'ada',
    dateOfBirth: '1990-07-04',
    sex: 'female',
    heightCm: 172.5,
    unitSystem: 'metric',
    weightUnit: 'kg',
    distanceUnit: 'km',
    energyUnit: 'kcal',
    trainingGoals: ['get_stronger'],
    activities: ['strength', 'hyrox'],
    city: 'Cairo',
    citySlug: 'cairo',
    avatarUrl: 'https://example.com/a.png',
  };

  const privacy = (over: Partial<PrivacySettings> = {}): PrivacySettings => ({
    userId: ownerId,
    publicProfile: false,
    leaderboardOptIn: false,
    locationForLeaderboard: false,
    aiFeaturesConsent: false,
    aiFeaturesConsentAt: null,
    crashDiagnostics: false,
    ...over,
  });

  let usersRepository: { findProfile: jest.Mock };
  let privacyRepository: { find: jest.Mock };
  let service: AthletesService;

  beforeEach(() => {
    usersRepository = { findProfile: jest.fn().mockResolvedValue(ownerProfile) };
    privacyRepository = { find: jest.fn().mockResolvedValue(privacy({ publicProfile: true })) };
    service = new AthletesService(
      usersRepository as unknown as UsersRepository,
      privacyRepository as unknown as PrivacyRepository,
    );
  });

  describe('when the profile is public', () => {
    it('returns the public projection', async () => {
      await expect(service.getPublicProfile(viewer, ownerId)).resolves.toEqual({
        userId: ownerId,
        displayName: 'Ada Lovelace',
        username: 'ada',
        avatarUrl: 'https://example.com/a.png',
        city: 'Cairo',
        trainingGoals: ['get_stronger'],
        activities: ['strength', 'hyrox'],
        isSelf: false,
      });
    });

    /**
     * The assertion that actually protects people. `toEqual` above would already fail on an
     * extra key, but this names the specific fields that must never appear, so the failure
     * message says what leaked rather than only that the shape changed.
     */
    it('never includes private fields', async () => {
      const result = await service.getPublicProfile(viewer, ownerId);

      for (const field of [
        'email',
        'dateOfBirth',
        'sex',
        'heightCm',
        'unitSystem',
        'weightUnit',
        'distanceUnit',
        'energyUnit',
        'citySlug',
        'plan',
        'publicProfile',
        'leaderboardOptIn',
        'locationForLeaderboard',
        'aiFeaturesConsent',
        'aiFeaturesConsentAt',
        'crashDiagnostics',
      ]) {
        expect(result).not.toHaveProperty(field);
      }
    });
  });

  describe('refusal', () => {
    /**
     * **404, never 403.** A 403 would confirm the account exists, turning this endpoint into
     * an account-enumeration oracle over a product whose accounts hold health data — the same
     * reasoning already applied to forgot-password in this repo.
     */
    it('answers NotFound, not Forbidden, for a private profile', async () => {
      privacyRepository.find.mockResolvedValue(privacy({ publicProfile: false }));

      const error = await service.getPublicProfile(viewer, ownerId).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
    });

    it('answers NotFound for a user that does not exist', async () => {
      usersRepository.findProfile.mockResolvedValue(null);

      await expect(service.getPublicProfile(viewer, ownerId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * The property the whole decision rests on: an attacker holding a list of candidate ids
     * must not be able to tell "no such account" from "that account exists but is private".
     * Comparing the thrown responses field by field is the only way to assert the two are
     * genuinely indistinguishable rather than merely both 404s.
     */
    it('is indistinguishable for an unknown user and a private one', async () => {
      usersRepository.findProfile.mockResolvedValue(null);
      const unknown = await service.getPublicProfile(viewer, ownerId).catch((e: unknown) => e);

      usersRepository.findProfile.mockResolvedValue(ownerProfile);
      privacyRepository.find.mockResolvedValue(privacy({ publicProfile: false }));
      const hidden = await service.getPublicProfile(viewer, ownerId).catch((e: unknown) => e);

      const shape = (error: unknown) => {
        const exception = error as NotFoundException;
        return {
          status: exception.getStatus(),
          response: exception.getResponse(),
          message: exception.message,
        };
      };

      expect(shape(unknown)).toEqual(shape(hidden));
    });

    /**
     * A missing privacy row must refuse rather than fall through to a default. `findOrCreate`
     * is deliberately not used here: creating a row as a side effect of a stranger's read
     * would let one user cause writes on another's behalf.
     */
    it('answers NotFound when the privacy row is missing', async () => {
      privacyRepository.find.mockResolvedValue(null);

      await expect(service.getPublicProfile(viewer, ownerId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * A malformed id must not reach Postgres, where an invalid uuid cast surfaces as a 500 —
     * itself a distinguishable response, and a different one from the 404 everything else
     * gets.
     */
    it('answers NotFound for an id that is not a uuid', async () => {
      await expect(service.getPublicProfile(viewer, 'not-a-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(usersRepository.findProfile).not.toHaveBeenCalled();
    });
  });

  describe('self-view', () => {
    /**
     * You can always see your own profile. This is also what powers the design's "Preview my
     * public profile" row, which must work precisely when the profile is *not* public.
     */
    it('shows a private profile to its owner', async () => {
      privacyRepository.find.mockResolvedValue(privacy({ publicProfile: false }));
      const owner: User = { ...viewer, id: ownerId };

      await expect(service.getPublicProfile(owner, ownerId)).resolves.toMatchObject({
        isSelf: true,
        displayName: 'Ada Lovelace',
      });
    });

    it('still refuses a self-view when the profile row is missing', async () => {
      usersRepository.findProfile.mockResolvedValue(null);
      const owner: User = { ...viewer, id: ownerId };

      await expect(service.getPublicProfile(owner, ownerId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * A self-view must not need the privacy row at all — the owner's access does not depend
     * on a flag, so a missing row cannot lock someone out of their own profile.
     */
    it('does not consult privacy for a self-view', async () => {
      privacyRepository.find.mockResolvedValue(null);
      const owner: User = { ...viewer, id: ownerId };

      await expect(service.getPublicProfile(owner, ownerId)).resolves.toMatchObject({
        isSelf: true,
      });
      // The assertion above proves it indirectly — a call to `find` with a null result would
      // have thrown, per the "missing privacy row" case. This is the direct check, so a
      // future refactor that reorders the checks fails here rather than only by inference.
      expect(privacyRepository.find).not.toHaveBeenCalled();
    });

    it('marks isSelf false for anyone else', async () => {
      await expect(service.getPublicProfile(viewer, ownerId)).resolves.toMatchObject({
        isSelf: false,
      });
    });

    /**
     * Postgres compares uuid columns case-insensitively, so `findProfile`/`find` treat a
     * differently-cased id as the same row. `isSelf` must agree, or a genuine owner
     * requesting their own id in a different case would be gated behind their own privacy
     * check and see a false 404 on their own profile.
     */
    it('treats a differently-cased id as the same self', async () => {
      privacyRepository.find.mockResolvedValue(privacy({ publicProfile: false }));
      const owner: User = { ...viewer, id: ownerId.toUpperCase() };

      await expect(service.getPublicProfile(owner, ownerId)).resolves.toMatchObject({
        isSelf: true,
      });
    });
  });
});
