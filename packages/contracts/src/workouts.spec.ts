import {
  createWorkoutTemplateRequestSchema,
  updateWorkoutTemplateRequestSchema,
  workoutBlockTypeSchema,
  workoutSessionListResponseSchema,
  workoutStatsQuerySchema,
  workoutStatsResponseSchema,
  workoutSessionResponseSchema,
  workoutSessionUploadRequestSchema,
  workoutSetTypeSchema,
  workoutTemplateListResponseSchema,
  workoutTemplateResponseSchema,
} from './index';

/**
 * Pins the deliberate decisions Phase 3's contracts make, mirroring exercises.spec.ts's own
 * pattern: the enums are built from @forjd/domain's tuples so an unknown value is rejected,
 * weight and distance are unit-less numbers because the unit is fixed by contract (kg and
 * metres, never sent alongside), and a session upload carries the client-generated id that
 * doubles as its sync idempotency key.
 */
describe('workout contracts', () => {
  describe('workoutBlockTypeSchema / workoutSetTypeSchema', () => {
    it('accepts every block type the domain package names, including the ones Phase 3 does not implement yet', () => {
      for (const type of ['straight_sets', 'superset', 'interval', 'amrap', 'time_based']) {
        expect(workoutBlockTypeSchema.safeParse(type).success).toBe(true);
      }
    });

    it('rejects an unknown block type', () => {
      expect(workoutBlockTypeSchema.safeParse('circuit').success).toBe(false);
    });

    it('rejects an unknown set type', () => {
      expect(workoutSetTypeSchema.safeParse('failure').success).toBe(false);
    });
  });

  describe('createWorkoutTemplateRequestSchema', () => {
    const validTemplate = {
      name: 'Upper Push',
      activity: 'strength' as const,
      blocks: [
        {
          type: 'straight_sets' as const,
          exercises: [
            {
              exerciseId: '11111111-1111-4111-8111-111111111111',
              setCount: 4,
              targetReps: 8,
              targetWeightKg: 80,
            },
          ],
        },
      ],
    };

    it('accepts a minimal valid template', () => {
      expect(createWorkoutTemplateRequestSchema.safeParse(validTemplate).success).toBe(true);
    });

    it('rejects an unknown block type inside blocks, closing the same gap workoutBlockTypeSchema closes on its own', () => {
      const result = createWorkoutTemplateRequestSchema.safeParse({
        ...validTemplate,
        blocks: [{ ...validTemplate.blocks[0], type: 'circuit' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a template with no blocks', () => {
      expect(
        createWorkoutTemplateRequestSchema.safeParse({ ...validTemplate, blocks: [] }).success,
      ).toBe(false);
    });

    it('rejects a block with no exercises', () => {
      expect(
        createWorkoutTemplateRequestSchema.safeParse({
          ...validTemplate,
          blocks: [{ type: 'straight_sets', exercises: [] }],
        }).success,
      ).toBe(false);
    });

    it("has no orderIndex field on a block or exercise -- position is the array's own index", () => {
      // orderIndex sent by a stale or malicious client is simply an unknown key, which zod's
      // default (non-strict) object schema strips rather than rejecting -- pinned here so a
      // future .strict() call is a deliberate choice, not an accidental behaviour change.
      const parsed = createWorkoutTemplateRequestSchema.parse({
        ...validTemplate,
        blocks: [{ ...validTemplate.blocks[0], orderIndex: 99 }],
      });
      expect(parsed.blocks[0]).not.toHaveProperty('orderIndex');
    });

    it('accepts an optional basedOnTemplateId -- client-supplied, server-validated (Phase G revision)', () => {
      const parsed = createWorkoutTemplateRequestSchema.parse({
        ...validTemplate,
        basedOnTemplateId: '22222222-2222-4222-8222-222222222222',
      });
      expect(parsed.basedOnTemplateId).toBe('22222222-2222-4222-8222-222222222222');
    });

    it('rejects a basedOnTemplateId that is not a UUID', () => {
      expect(
        createWorkoutTemplateRequestSchema.safeParse({
          ...validTemplate,
          basedOnTemplateId: 'not-a-uuid',
        }).success,
      ).toBe(false);
    });

    it('omits basedOnTemplateId entirely when the client does not send it -- a template built from scratch', () => {
      const parsed = createWorkoutTemplateRequestSchema.parse(validTemplate);
      expect(parsed.basedOnTemplateId).toBeUndefined();
    });

    it('accepts weight and distance targets as bare numbers -- kg and metres are fixed by contract, never a co-travelling unit field', () => {
      const parsed = createWorkoutTemplateRequestSchema.parse({
        ...validTemplate,
        blocks: [
          {
            type: 'straight_sets' as const,
            exercises: [
              {
                exerciseId: '11111111-1111-4111-8111-111111111111',
                targetWeightKg: 100,
                targetDistanceMeters: 2000,
              },
            ],
          },
        ],
      });
      expect(parsed.blocks[0]?.exercises[0]).not.toHaveProperty('targetWeightUnit');
      expect(parsed.blocks[0]?.exercises[0]?.targetWeightKg).toBe(100);
      expect(parsed.blocks[0]?.exercises[0]?.targetDistanceMeters).toBe(2000);
    });
  });

  describe('updateWorkoutTemplateRequestSchema', () => {
    it('accepts an empty object -- every field is optional on an update', () => {
      expect(updateWorkoutTemplateRequestSchema.safeParse({}).success).toBe(true);
    });

    it('still rejects an unknown block type when blocks are sent', () => {
      expect(
        updateWorkoutTemplateRequestSchema.safeParse({
          blocks: [
            { type: 'circuit', exercises: [{ exerciseId: '11111111-1111-4111-8111-111111111111' }] },
          ],
        }).success,
      ).toBe(false);
    });
  });

  describe('workoutTemplateResponseSchema / workoutTemplateListResponseSchema', () => {
    it('parses a full template with nested blocks and exercises', () => {
      const result = workoutTemplateResponseSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Upper Push',
        activity: 'strength',
        basedOnTemplateId: null,
        notes: null,
        estimatedDurationMinutes: 52,
        isCustom: true,
        blocks: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            type: 'straight_sets',
            orderIndex: 0,
            name: null,
            rounds: null,
            workSeconds: null,
            restSeconds: null,
            capSeconds: null,
            exercises: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                exerciseId: '44444444-4444-4444-8444-444444444444',
                orderIndex: 0,
                setCount: 4,
                targetReps: 8,
                targetRepsMax: null,
                targetWeightKg: 80,
                targetSeconds: null,
                targetDistanceMeters: null,
                restSeconds: 90,
                notes: null,
              },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('wraps the summary shape in the standard { items, nextCursor } list envelope', () => {
      const result = workoutTemplateListResponseSchema.safeParse({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Upper Push',
            activity: 'strength',
            estimatedDurationMinutes: 52,
            exerciseCount: 6,
            isCustom: true,
            basedOnTemplateId: null,
          },
        ],
        nextCursor: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('workoutSessionUploadRequestSchema', () => {
    const validSession = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Upper Push',
      activity: 'strength' as const,
      status: 'completed' as const,
      startedAt: '2026-09-02T09:00:00.000Z',
      durationSeconds: 1800,
      isLiveTracked: false,
      exercises: [
        {
          exerciseId: '22222222-2222-4222-8222-222222222222',
          sets: [{ type: 'working' as const, isCompleted: true, weightKg: 100, reps: 8 }],
        },
      ],
    };

    it('accepts a minimal valid session upload', () => {
      expect(workoutSessionUploadRequestSchema.safeParse(validSession).success).toBe(true);
    });

    it('carries its sync idempotency key -- id is required, not optional or server-assigned', () => {
      const withoutId: Record<string, unknown> = { ...validSession };
      delete withoutId.id;
      expect(workoutSessionUploadRequestSchema.safeParse(withoutId).success).toBe(false);
    });

    it('rejects an id that is not a UUID', () => {
      expect(
        workoutSessionUploadRequestSchema.safeParse({ ...validSession, id: 'not-a-uuid' }).success,
      ).toBe(false);
    });

    it('has no measure field on a session exercise -- the server snapshots it from the exercise it looks up, never from client input', () => {
      const parsed = workoutSessionUploadRequestSchema.parse({
        ...validSession,
        exercises: [{ ...validSession.exercises[0], measure: 'weight' }],
      });
      expect(parsed.exercises[0]).not.toHaveProperty('measure');
    });

    it("has no setIndex field on a set -- position is the array's own index", () => {
      const exercise = validSession.exercises[0]!;
      const parsed = workoutSessionUploadRequestSchema.parse({
        ...validSession,
        exercises: [{ ...exercise, sets: [{ ...exercise.sets[0]!, setIndex: 0 }] }],
      });
      expect(parsed.exercises[0]?.sets[0]).not.toHaveProperty('setIndex');
    });

    it('rejects an unknown session status', () => {
      expect(
        workoutSessionUploadRequestSchema.safeParse({ ...validSession, status: 'abandoned' })
          .success,
      ).toBe(false);
    });
  });

  describe('workoutSessionResponseSchema / workoutSessionListResponseSchema', () => {
    it('parses a full session with nested exercises and sets, weight and distance as bare numbers', () => {
      const result = workoutSessionResponseSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        templateId: null,
        name: 'Upper Push',
        activity: 'strength',
        status: 'completed',
        startedAt: '2026-09-02T09:00:00.000Z',
        endedAt: '2026-09-02T09:30:00.000Z',
        durationSeconds: 1800,
        perceivedEffort: 'solid',
        notes: null,
        city: null,
        citySlug: null,
        isLiveTracked: true,
        exercises: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            exerciseId: '33333333-3333-4333-8333-333333333333',
            orderIndex: 0,
            measure: 'weight',
            notes: null,
            sets: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                setIndex: 0,
                type: 'working',
                isCompleted: true,
                weightKg: 100,
                reps: 8,
                durationSeconds: null,
                distanceMeters: null,
                restSeconds: 90,
                completedAt: '2026-09-02T09:05:00.000Z',
              },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('wraps the summary shape in the standard { items, nextCursor } list envelope', () => {
      const result = workoutSessionListResponseSchema.safeParse({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Upper Push',
            activity: 'strength',
            status: 'completed',
            startedAt: '2026-09-02T09:00:00.000Z',
            endedAt: '2026-09-02T09:30:00.000Z',
            durationSeconds: 1800,
            perceivedEffort: 'solid',
          },
        ],
        nextCursor: null,
      });
      expect(result.success).toBe(true);
    });
  });
  // Phase 3J-c: Home's stat strip, "This week" and "Recent PR". These are aggregates over all
  // of a user's history, which the cursor-paginated session list cannot answer -- it has no
  // totals, and a personal record needs every set, not every session summary.
  describe('workoutStatsQuerySchema', () => {
    // Every figure here is a *local calendar* concept -- which month, which week, which day --
    // and the server has no idea what the device's calendar is. Passing the zone explicitly is
    // what stops "this month" from silently meaning "this month in UTC".
    it('accepts a real IANA time zone', () => {
      expect(workoutStatsQuerySchema.safeParse({ timeZone: 'Africa/Cairo' }).success).toBe(true);
      expect(workoutStatsQuerySchema.safeParse({ timeZone: 'America/New_York' }).success).toBe(true);
    });

    it('defaults to UTC when the client sends no zone', () => {
      const result = workoutStatsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.success && result.data.timeZone).toBe('UTC');
    });

    // The zone reaches a `date_trunc(... AT TIME ZONE $1)`. Postgres raises on an unknown zone
    // name, so an unvalidated one turns a typo into a 500 rather than a 400.
    it('rejects anything that is not a zone Postgres will recognise', () => {
      expect(workoutStatsQuerySchema.safeParse({ timeZone: 'Mars/Olympus_Mons' }).success).toBe(false);
      expect(workoutStatsQuerySchema.safeParse({ timeZone: 'not a zone' }).success).toBe(false);
      expect(workoutStatsQuerySchema.safeParse({ timeZone: '' }).success).toBe(false);
    });
  });

  describe('workoutStatsResponseSchema', () => {
    const valid = {
      totalSessions: 42,
      sessionsThisMonth: 6,
      weekStreak: 3,
      thisWeek: { sessionCount: 2, trainedWeekdays: [1, 3] },
      recentPersonalRecord: {
        exerciseId: '33333333-3333-4333-8333-333333333333',
        exerciseName: 'Bench Press',
        weightKg: 100,
        reps: 5,
        achievedAt: '2026-09-01T09:05:00.000Z',
      },
    };

    it('parses a full stats payload', () => {
      expect(workoutStatsResponseSchema.safeParse(valid).success).toBe(true);
    });

    // A user who has never lifted has no record. Null is the honest answer, and the client
    // renders its "No PR yet" empty state from it -- a zero-weight record would be a lie.
    it('allows a null personal record', () => {
      expect(
        workoutStatsResponseSchema.safeParse({ ...valid, recentPersonalRecord: null }).success,
      ).toBe(true);
    });

    it('parses the all-zero shape a brand new account produces', () => {
      const result = workoutStatsResponseSchema.safeParse({
        totalSessions: 0,
        sessionsThisMonth: 0,
        weekStreak: 0,
        thisWeek: { sessionCount: 0, trainedWeekdays: [] },
        recentPersonalRecord: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative counts, which no aggregate here can legitimately produce', () => {
      expect(workoutStatsResponseSchema.safeParse({ ...valid, totalSessions: -1 }).success).toBe(false);
      expect(workoutStatsResponseSchema.safeParse({ ...valid, weekStreak: -1 }).success).toBe(false);
    });

    // `trainedWeekdays` is indexed the way `Date#getDay()` is, so the client can compare it
    // against its own day index without a conversion step that could be got backwards.
    it('rejects a weekday index outside 0-6', () => {
      expect(
        workoutStatsResponseSchema.safeParse({
          ...valid,
          thisWeek: { sessionCount: 1, trainedWeekdays: [7] },
        }).success,
      ).toBe(false);
    });
  });
});
