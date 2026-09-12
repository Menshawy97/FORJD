import { AccountExportService } from './account-export.service';

/**
 * R4 (H2) -- GDPR Art. 15 & 20. `GET /users/me` returned only profile and privacy; there was
 * no way for an athlete to get a full copy of everything else FORJD holds about them.
 *
 * Every repository here is a plain fake, not a mock of a real DB -- the real cascading/scoping
 * proof against Postgres is `test/users-export.e2e-spec.ts`, which needs the real tables this
 * unit suite cannot see. What this suite proves is the service's own assembly and scoping
 * logic: every section is present, every query is called with the requesting user's id (never
 * a stray constant or another user's id), health observations keep their `source`, and no
 * WHOOP token material ever reaches the returned shape.
 */
describe('AccountExportService', () => {
  const userId = 'user-1';
  const email = 'ada@example.com';

  function build(overrides: Record<string, unknown> = {}) {
    const usersRepository = {
      findProfile: jest.fn().mockResolvedValue(null),
      ...((overrides.usersRepository as object) ?? {}),
    };

    const privacyService = {
      get: jest.fn().mockResolvedValue({
        publicProfile: false,
        leaderboardOptIn: false,
        locationForLeaderboard: false,
        aiFeaturesConsent: false,
        aiFeaturesConsentAt: null,
        crashDiagnostics: false,
      }),
      ...((overrides.privacyService as object) ?? {}),
    };

    const subscriptionService = {
      getPlan: jest.fn().mockResolvedValue('free'),
      ...((overrides.subscriptionService as object) ?? {}),
    };

    const healthDataRepository = {
      getAllObservationsForExport: jest.fn().mockResolvedValue([]),
      ...((overrides.healthDataRepository as object) ?? {}),
    };

    const bodyRepository = {
      listScansForUser: jest.fn().mockResolvedValue([]),
      ...((overrides.bodyRepository as object) ?? {}),
    };

    const nutritionRepository = {
      listAllForUserForExport: jest.fn().mockResolvedValue([]),
      ...((overrides.nutritionRepository as object) ?? {}),
    };

    const workoutsRepository = {
      listOwnTemplateIdsForUser: jest.fn().mockResolvedValue([]),
      listSessionIdsForUser: jest.fn().mockResolvedValue([]),
      findByIdForUser: jest.fn(),
      findSessionByIdForUser: jest.fn(),
      ...((overrides.workoutsRepository as object) ?? {}),
    };

    const programsRepository = {
      listForUser: jest.fn().mockResolvedValue([]),
      findActiveEnrollment: jest.fn().mockResolvedValue(null),
      ...((overrides.programsRepository as object) ?? {}),
    };

    const whoopConnections = {
      findByUserId: jest.fn().mockResolvedValue(null),
      ...((overrides.whoopConnections as object) ?? {}),
    };

    const service = new AccountExportService(
      usersRepository as never,
      privacyService as never,
      subscriptionService as never,
      healthDataRepository as never,
      bodyRepository as never,
      nutritionRepository as never,
      workoutsRepository as never,
      programsRepository as never,
      whoopConnections as never,
    );

    return {
      service,
      usersRepository,
      privacyService,
      subscriptionService,
      healthDataRepository,
      bodyRepository,
      nutritionRepository,
      workoutsRepository,
      programsRepository,
      whoopConnections,
    };
  }

  it('scopes every repository read to the requesting user id', async () => {
    const deps = build();

    await deps.service.exportAccount(userId, email);

    expect(deps.usersRepository.findProfile).toHaveBeenCalledWith(userId);
    expect(deps.privacyService.get).toHaveBeenCalledWith(userId);
    expect(deps.subscriptionService.getPlan).toHaveBeenCalledWith(userId);
    expect(deps.healthDataRepository.getAllObservationsForExport).toHaveBeenCalledWith(userId);
    expect(deps.bodyRepository.listScansForUser).toHaveBeenCalledWith(userId);
    expect(deps.nutritionRepository.listAllForUserForExport).toHaveBeenCalledWith(userId);
    expect(deps.workoutsRepository.listOwnTemplateIdsForUser).toHaveBeenCalledWith(userId);
    expect(deps.workoutsRepository.listSessionIdsForUser).toHaveBeenCalledWith(userId);
    expect(deps.programsRepository.listForUser).toHaveBeenCalledWith({ userId, scope: 'mine' });
    expect(deps.programsRepository.findActiveEnrollment).toHaveBeenCalledWith(userId);
    expect(deps.whoopConnections.findByUserId).toHaveBeenCalledWith(userId);
  });

  it('carries the account id/email and a version marker', async () => {
    const { service } = build();

    const result = await service.exportAccount(userId, email);

    expect(result.version).toBe(1);
    expect(result.account).toEqual({ id: userId, email });
    expect(typeof result.exportedAt).toBe('string');
  });

  it('includes health observations, keeping every source field intact (rule 10)', async () => {
    const { service } = build({
      healthDataRepository: {
        getAllObservationsForExport: jest.fn().mockResolvedValue([
          {
            metricType: 'hrv',
            value: 55,
            unit: 'ms',
            startTime: new Date('2026-09-01T00:00:00.000Z'),
            endTime: new Date('2026-09-01T00:05:00.000Z'),
            source: 'whoop',
          },
          {
            metricType: 'hrv',
            value: 58,
            unit: 'ms',
            startTime: new Date('2026-09-02T00:00:00.000Z'),
            endTime: new Date('2026-09-02T00:05:00.000Z'),
            source: 'manual',
          },
        ]),
      },
    });

    const result = await service.exportAccount(userId, email);

    expect(result.healthObservations).toEqual([
      expect.objectContaining({ source: 'whoop' }),
      expect.objectContaining({ source: 'manual' }),
    ]);
  });

  it('includes body scans with their measurements', async () => {
    const { service } = build({
      bodyRepository: {
        listScansForUser: jest.fn().mockResolvedValue([
          {
            id: 'scan-1',
            measuredAt: new Date('2026-08-20T08:00:00.000Z'),
            source: 'inbody',
            measurements: [{ metric: 'weight_kg', value: 84.6, unit: 'kg', confidence: 0.97 }],
          },
        ]),
      },
    });

    const result = await service.exportAccount(userId, email);

    expect(result.bodyScans).toEqual([
      expect.objectContaining({
        id: 'scan-1',
        measurements: [{ metric: 'weight_kg', value: 84.6, unit: 'kg', confidence: 0.97 }],
      }),
    ]);
  });

  it('includes nutrition log entries, workout templates and sessions, and privacy settings', async () => {
    const { service } = build({
      nutritionRepository: {
        listAllForUserForExport: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            foodId: 'food-1',
            loggedDate: '2026-08-31',
            slot: 'breakfast',
            servingLabel: '1 Banana',
            grams: 115,
            kcal: 112.7,
            protein: 0.85,
            carbs: 26.45,
            fat: 0.33,
            groupId: null,
            groupName: null,
          },
        ]),
      },
      workoutsRepository: {
        listOwnTemplateIdsForUser: jest.fn().mockResolvedValue(['template-1']),
        listSessionIdsForUser: jest.fn().mockResolvedValue(['session-1']),
        findByIdForUser: jest.fn().mockResolvedValue({
          id: 'template-1',
          ownerUserId: userId,
          name: 'Upper Push',
          activity: 'strength',
          basedOnTemplateId: null,
          notes: null,
          estimatedDurationMinutes: 52,
          blocks: [],
        }),
        findSessionByIdForUser: jest.fn().mockResolvedValue({
          id: 'session-1',
          templateId: null,
          name: 'Upper Push',
          activity: 'strength',
          status: 'completed',
          startedAt: new Date('2026-09-02T09:00:00.000Z'),
          endedAt: new Date('2026-09-02T09:52:00.000Z'),
          durationSeconds: 3120,
          perceivedEffort: 'solid',
          notes: null,
          city: null,
          citySlug: null,
          isLiveTracked: false,
          exercises: [],
        }),
      },
    });

    const result = await service.exportAccount(userId, email);

    expect(result.nutritionLogEntries).toEqual([expect.objectContaining({ id: 'entry-1' })]);
    expect(result.workoutTemplates).toEqual([expect.objectContaining({ id: 'template-1', isCustom: true })]);
    expect(result.workoutSessions).toEqual([expect.objectContaining({ id: 'session-1' })]);
    expect(result.privacy).toEqual(
      expect.objectContaining({ publicProfile: false, aiFeaturesConsent: false }),
    );
  });

  it('includes owned programs and the active enrollment', async () => {
    const { service } = build({
      programsRepository: {
        listForUser: jest.fn().mockResolvedValue([
          {
            id: 'program-1',
            slug: 'my-program',
            name: 'My Program',
            category: 'strength',
            level: 'beginner',
            daysPerWeek: 3,
            durationWeeks: 8,
            description: null,
            version: 1,
            isOwn: true,
            workoutCount: 3,
          },
        ]),
        findActiveEnrollment: jest.fn().mockResolvedValue({
          id: 'enrollment-1',
          programId: 'program-2',
          programSlug: 'preset-program',
          programName: 'Preset Program',
          programVersion: 1,
          startedAt: new Date('2026-09-01T08:30:00.000Z'),
        }),
      },
    });

    const result = await service.exportAccount(userId, email);

    expect(result.programs.owned).toEqual([expect.objectContaining({ id: 'program-1', isOwn: true })]);
    expect(result.programs.enrollment).toEqual(expect.objectContaining({ id: 'enrollment-1' }));
  });

  it('never includes an encrypted WHOOP access or refresh token in the export', async () => {
    const { service } = build({
      whoopConnections: {
        findByUserId: jest.fn().mockResolvedValue({
          id: 'connection-1',
          userId,
          status: 'connected',
          externalUserId: 'whoop-user-1',
          encryptedAccessToken: 'super-secret-access-token',
          encryptedRefreshToken: 'super-secret-refresh-token',
          tokenKeyVersion: 1,
          expiresAt: null,
          scopes: null,
          lastSyncAt: new Date('2026-09-08T06:15:00.000Z'),
        }),
      },
    });

    const result = await service.exportAccount(userId, email);

    expect(result.externalConnections).toEqual([
      {
        provider: 'whoop',
        status: 'connected',
        externalUserId: 'whoop-user-1',
        lastSyncAt: '2026-09-08T06:15:00.000Z',
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-access-token');
    expect(serialized).not.toContain('super-secret-refresh-token');
    expect(serialized).not.toContain('encryptedAccessToken');
    expect(serialized).not.toContain('encryptedRefreshToken');
  });

  it('does not leak another user\'s rows -- every id passed downstream is the requesting user\'s own', async () => {
    const otherUserId = 'user-2';
    const { service, workoutsRepository } = build({
      workoutsRepository: {
        listOwnTemplateIdsForUser: jest.fn().mockImplementation(async (id: string) => {
          if (id !== userId) throw new Error('must only be called with the requesting user id');
          return [];
        }),
        listSessionIdsForUser: jest.fn().mockImplementation(async (id: string) => {
          if (id !== userId) throw new Error('must only be called with the requesting user id');
          return [];
        }),
        findByIdForUser: jest.fn(),
        findSessionByIdForUser: jest.fn(),
      },
    });

    await service.exportAccount(userId, email);

    expect(workoutsRepository.listOwnTemplateIdsForUser).not.toHaveBeenCalledWith(otherUserId);
  });
});
