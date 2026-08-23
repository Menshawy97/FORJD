import { BadRequestException } from '@nestjs/common';
import { PrivacySettings } from '@forjd/domain';

import { PrivacyDecision, PrivacyPatch, PrivacyRepository } from './privacy.repository';
import { PrivacyService } from './privacy.service';

/**
 * Carries a 100% coverage threshold (see apps/api/package.json). Every branch here is a
 * consent decision, and the untested branch in a consent decision is the one that silently
 * grants something.
 */
describe('PrivacyService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  const allOff: PrivacySettings = {
    userId,
    publicProfile: false,
    leaderboardOptIn: false,
    locationForLeaderboard: false,
    aiFeaturesConsent: false,
    aiFeaturesConsentAt: null,
    crashDiagnostics: false,
  };

  let privacyRepository: { findOrCreate: jest.Mock; updateLocked: jest.Mock };
  let service: PrivacyService;
  /** What the decide callback returned for the locked row. */
  let decision: PrivacyDecision | null;

  const lastPatch = (): PrivacyPatch => decision?.patch ?? {};
  const lastAudit = (): PrivacyDecision['audit'] => decision?.audit ?? null;

  const given = (current: Partial<PrivacySettings>): void => {
    privacyRepository.findOrCreate.mockResolvedValue({ ...allOff, ...current });
  };

  beforeEach(() => {
    decision = null;
    privacyRepository = {
      findOrCreate: jest.fn().mockResolvedValue(allOff),
      // Stands in for the locked read-decide-write. The callback is run against whatever
      // findOrCreate was told the stored row is, which is what the real transaction does.
      updateLocked: jest
        .fn()
        .mockImplementation(async (_id: string, decide: (c: PrivacySettings) => PrivacyDecision) => {
          const current = (await privacyRepository.findOrCreate(_id)) as PrivacySettings;
          decision = decide(current);
          return { ...current, ...decision.patch };
        }),
    };

    service = new PrivacyService(privacyRepository as unknown as PrivacyRepository);
  });

  describe('get', () => {
    it('returns the stored settings', async () => {
      given({ publicProfile: true });

      await expect(service.get(userId)).resolves.toMatchObject({ publicProfile: true });
    });

    it('creates an all-off row rather than failing when none exists', async () => {
      await expect(service.get(userId)).resolves.toEqual(allOff);
      expect(privacyRepository.findOrCreate).toHaveBeenCalledWith(userId);
    });
  });

  describe('the leaderboard/location dependency', () => {
    /**
     * Location is meaningless without the leaderboard it feeds. Turning the parent off must
     * take the child with it, or the account keeps a stored "yes" to sharing location for a
     * feature it has left — which would read as consent to anything that later looks at the
     * flag on its own.
     */
    it('cascades location off when the leaderboard is turned off', async () => {
      given({ leaderboardOptIn: true, locationForLeaderboard: true });

      await service.update(userId, { leaderboardOptIn: false });

      expect(lastPatch()).toMatchObject({
        leaderboardOptIn: false,
        locationForLeaderboard: false,
      });
    });

    it('does not touch location when the leaderboard was already off', async () => {
      given({ leaderboardOptIn: false, locationForLeaderboard: false });

      await service.update(userId, { publicProfile: true });

      expect(lastPatch().locationForLeaderboard).toBeUndefined();
    });

    /**
     * The opposite direction is a 400, not a silent coercion. Quietly ignoring the field
     * would hide a client bug behind a 200 — on a location setting, where the user would
     * reasonably believe they had turned something on.
     */
    it('rejects turning location on without its parent', async () => {
      given({ leaderboardOptIn: false });

      await expect(service.update(userId, { locationForLeaderboard: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // The refusal is raised from inside the locked transaction, so nothing is decided and
      // nothing is written — the throw is what rolls the transaction back.
      expect(decision).toBeNull();
    });

    it('accepts turning both on in the same request', async () => {
      given({ leaderboardOptIn: false });

      await service.update(userId, {
        leaderboardOptIn: true,
        locationForLeaderboard: true,
      });

      expect(lastPatch()).toMatchObject({
        leaderboardOptIn: true,
        locationForLeaderboard: true,
      });
    });

    it('accepts location on when the parent is already on', async () => {
      given({ leaderboardOptIn: true });

      await service.update(userId, { locationForLeaderboard: true });

      expect(lastPatch().locationForLeaderboard).toBe(true);
    });

    /**
     * Turning the parent off and the child on in one request is contradictory. It is refused
     * rather than resolved by ordering, because either resolution would be a guess about
     * which half the caller meant.
     */
    it('rejects a request that turns the parent off and the child on at once', async () => {
      given({ leaderboardOptIn: true, locationForLeaderboard: false });

      await expect(
        service.update(userId, { leaderboardOptIn: false, locationForLeaderboard: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('the AI consent transition', () => {
    it('stamps the timestamp and audits when consent is granted', async () => {
      given({ aiFeaturesConsent: false });

      await service.update(userId, { aiFeaturesConsent: true });

      expect(lastPatch().aiFeaturesConsentAt).toBeInstanceOf(Date);
      expect(lastAudit()).toMatchObject({ action: 'privacy.ai_consent_granted' });
    });

    it('clears the timestamp and audits when consent is withdrawn', async () => {
      given({ aiFeaturesConsent: true, aiFeaturesConsentAt: new Date('2026-01-01T00:00:00Z') });

      await service.update(userId, { aiFeaturesConsent: false });

      expect(lastPatch().aiFeaturesConsentAt).toBeNull();
      expect(lastAudit()).toMatchObject({ action: 'privacy.ai_consent_withdrawn' });
    });

    /**
     * The reason the transition is compared against stored state rather than just written.
     * A client that re-sends the whole settings object on every save — which is exactly what
     * the design's Save button does — would otherwise manufacture a fresh consent record and
     * a fresh timestamp on each tap, destroying the real date consent was given.
     */
    it('does not re-stamp or re-audit when consent is already granted', async () => {
      const originalDate = new Date('2026-01-01T00:00:00Z');
      given({ aiFeaturesConsent: true, aiFeaturesConsentAt: originalDate });

      await service.update(userId, { aiFeaturesConsent: true });

      expect(lastPatch().aiFeaturesConsentAt).toBeUndefined();
      expect(lastAudit()).toBeNull();
    });

    it('does not audit when consent is already withdrawn', async () => {
      given({ aiFeaturesConsent: false });

      await service.update(userId, { aiFeaturesConsent: false });

      expect(lastAudit()).toBeNull();
    });

    it('does not audit when the request never mentions consent', async () => {
      given({ aiFeaturesConsent: true, aiFeaturesConsentAt: new Date() });

      await service.update(userId, { publicProfile: true });

      expect(lastAudit()).toBeNull();
      expect(lastPatch().aiFeaturesConsentAt).toBeUndefined();
    });
  });

  describe('update', () => {
    it('passes the remaining flags through untouched', async () => {
      await service.update(userId, { publicProfile: true, crashDiagnostics: true });

      expect(lastPatch()).toMatchObject({ publicProfile: true, crashDiagnostics: true });
    });

    it('returns the updated settings', async () => {
      await expect(service.update(userId, { publicProfile: true })).resolves.toMatchObject({
        publicProfile: true,
      });
    });

    /**
     * findOrCreate guarantees a row, so a null from update means it vanished between the two
     * statements. Failing loudly beats returning a shape that claims every flag is off.
     */
    it('throws rather than inventing settings when the row disappears mid-update', async () => {
      privacyRepository.updateLocked.mockResolvedValue(null);

      await expect(service.update(userId, { publicProfile: true })).rejects.toThrow();
    });
  });
});
