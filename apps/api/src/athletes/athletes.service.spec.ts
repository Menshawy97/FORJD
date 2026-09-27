import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrivacySettings, Profile, User } from '@forjd/domain';

import type { CityResolverService } from '../cities/city-resolver.service';
import type { LeaderboardsService } from '../leaderboards/leaderboards.service';
import { PrivacyRepository } from '../privacy/privacy.repository';
import { UsersRepository } from '../users/users.repository';
import type { AthleteStatsRepository } from './athlete-stats.repository';
import { AthletesService } from './athletes.service';
import { ForgeService } from '../forge/forge.service';

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
    activityLevel: null,
    bodyGoal: null,
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
    healthDataConsent: false,
    healthDataConsentAt: null,
    crashDiagnostics: false,
    ...over,
  });

  let usersRepository: { findProfile: jest.Mock };
  let privacyRepository: { find: jest.Mock };
  let statsRepository: { personalRecords: jest.Mock; recentSessions: jest.Mock; weekStreak: jest.Mock };
  let leaderboards: { standingFor: jest.Mock };
  let cities: { findBySlug: jest.Mock };
  let forge: { publicForgeFor: jest.Mock };
  let service: AthletesService;

  const NOW = new Date('2026-09-23T12:00:00Z');

  beforeEach(() => {
    usersRepository = { findProfile: jest.fn().mockResolvedValue(ownerProfile) };
    privacyRepository = { find: jest.fn().mockResolvedValue(privacy({ publicProfile: true })) };
    statsRepository = {
      personalRecords: jest.fn().mockResolvedValue([]),
      recentSessions: jest.fn().mockResolvedValue([]),
      weekStreak: jest.fn().mockResolvedValue(0),
    };
    leaderboards = { standingFor: jest.fn().mockResolvedValue(null) };
    cities = { findBySlug: jest.fn().mockReturnValue({ timezone: 'Africa/Cairo' }) };
    forge = { publicForgeFor: jest.fn().mockResolvedValue(null) };
    service = new AthletesService(
      usersRepository as unknown as UsersRepository,
      privacyRepository as unknown as PrivacyRepository,
      statsRepository as unknown as AthleteStatsRepository,
      leaderboards as unknown as LeaderboardsService,
      cities as unknown as CityResolverService,
      forge as unknown as ForgeService,
    );
  });

  it('carries the public Forge block from ForgeService, and never builds one itself', async () => {
    const block = {
      ladders: [
        { ladder: 'volume' as const, band: 'ember' as const, level: 9, forgedStreak: 0, bestForgedStreak: 0, badges: ['ember' as const] },
      ],
    };
    forge.publicForgeFor.mockResolvedValue(block);

    const profile = await service.getPublicProfile(viewer, ownerId);

    expect(profile.forge).toBe(block);
    expect(forge.publicForgeFor).toHaveBeenCalledWith(ownerId);
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
        stats: null,
        personalRecords: [],
        recentSessions: [],
        forge: null,
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

  describe('the stats a profile carries (Phase 10N)', () => {
    const standing = {
      cityName: 'Cairo',
      citySlug: 'cairo-eg-360630',
      rank: 47,
      score: 92.7,
      periodLabel: 'Sep 2026',
    };

    it('shows the rank, score and streak when the athlete is ranked this month', async () => {
      leaderboards.standingFor.mockResolvedValue(standing);
      statsRepository.weekStreak.mockResolvedValue(6);

      const result = await service.getPublicProfile(viewer, ownerId, NOW);

      expect(result.stats).toEqual({
        cityName: 'Cairo',
        cityRank: 47,
        score: 92.7,
        streakWeeks: 6,
        periodLabel: 'Sep 2026',
      });
    });

    it('hides the whole tile row, streak included, for an athlete who is not ranked', async () => {
      leaderboards.standingFor.mockResolvedValue(null);

      const result = await service.getPublicProfile(viewer, ownerId, NOW);

      expect(result.stats).toBeNull();
      expect(statsRepository.weekStreak).not.toHaveBeenCalled();
    });

    it("asks for the standing of the profile's owner, not the viewer", async () => {
      await service.getPublicProfile(viewer, ownerId, NOW);

      expect(leaderboards.standingFor).toHaveBeenCalledWith(ownerId, NOW);
    });

    it("dates the streak in the ranked city's own calendar", async () => {
      leaderboards.standingFor.mockResolvedValue(standing);

      await service.getPublicProfile(viewer, ownerId, NOW);

      expect(cities.findBySlug).toHaveBeenCalledWith('cairo-eg-360630');
      expect(statsRepository.weekStreak).toHaveBeenCalledWith(ownerId, 'Africa/Cairo', NOW);
    });

    it('falls back to UTC for a city missing from the current dataset', async () => {
      leaderboards.standingFor.mockResolvedValue(standing);
      cities.findBySlug.mockReturnValue(null);

      await service.getPublicProfile(viewer, ownerId, NOW);

      expect(statsRepository.weekStreak).toHaveBeenCalledWith(ownerId, 'UTC', NOW);
    });

    it('lists the four best records and the last three sessions, as plain values', async () => {
      statsRepository.personalRecords.mockResolvedValue([
        { exerciseName: 'Deadlift', weightKg: 180 },
        { exerciseName: 'Back Squat', weightKg: 140 },
      ]);
      statsRepository.recentSessions.mockResolvedValue([
        { name: 'Upper Body Push', startedAt: new Date('2026-09-19T10:00:00Z'), volumeKg: 14200, durationSeconds: 3600 },
        { name: '5K Run', startedAt: new Date('2026-09-16T06:30:00Z'), volumeKg: 0, durationSeconds: null },
      ]);

      const result = await service.getPublicProfile(viewer, ownerId, NOW);

      expect(statsRepository.personalRecords).toHaveBeenCalledWith(ownerId, 4);
      expect(statsRepository.recentSessions).toHaveBeenCalledWith(ownerId, 3);
      expect(result.personalRecords).toEqual([
        { exerciseName: 'Deadlift', weightKg: 180 },
        { exerciseName: 'Back Squat', weightKg: 140 },
      ]);
      expect(result.recentSessions).toEqual([
        { name: 'Upper Body Push', startedAt: '2026-09-19T10:00:00.000Z', volumeKg: 14200, durationSeconds: 3600 },
        { name: '5K Run', startedAt: '2026-09-16T06:30:00.000Z', volumeKg: 0, durationSeconds: null },
      ]);
    });

    it('reads none of it for a profile the viewer may not see', async () => {
      privacyRepository.find.mockResolvedValue(privacy({ publicProfile: false }));

      await service.getPublicProfile(viewer, ownerId, NOW).catch(() => undefined);

      expect(leaderboards.standingFor).not.toHaveBeenCalled();
      expect(statsRepository.personalRecords).not.toHaveBeenCalled();
      expect(statsRepository.recentSessions).not.toHaveBeenCalled();
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

