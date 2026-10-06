import type { ForgeResponse, ProgramResponse, WorkoutSessionSummary } from '@forjd/contracts';
import { DEFAULT_NOTIFICATION_PREFERENCES, type PlannedLocalNotification } from '@forjd/domain';

import { buildLocalNotificationPlan, type PlanInputSources } from '../local-notification-plan-input';

// Phase 12E-2. Gathers what the pure planner needs from the phone's own copies and the API, and runs it. A
// failed read answers `null` ("leave the schedule as it is"), never an empty plan, because an empty plan would
// cancel every reminder just because the phone was offline.

const NOW = new Date(2026, 9, 5, 12, 0); // Monday 5 Oct 2026, local noon

function session(daysAgo: number, hour: number, minute = 0, status: WorkoutSessionSummary['status'] = 'completed'): WorkoutSessionSummary {
  const startedAt = new Date(2026, 9, 5 - daysAgo, hour, minute).toISOString();
  return { id: `s-${daysAgo}`, name: 'Push', activity: 'strength', status, startedAt, endedAt: null, durationSeconds: 3600, perceivedEffort: null };
}

// The Forge week that starts Saturday 3 Oct 2026 and closes Friday 9 Oct, with one ladder `progress` of the way.
function forgeWeek(progress: number): ForgeResponse {
  return {
    weekStart: '2026-10-03',
    daysLeft: 5,
    timeZone: 'UTC',
    ladders: [{ ladder: 'consistency', target: 100, total: progress * 100 }],
  } as ForgeResponse;
}

const allOn = { ...DEFAULT_NOTIFICATION_PREFERENCES };
const allOff = { ...DEFAULT_NOTIFICATION_PREFERENCES, workout: false, weekly: false };
const enrollment = {
  enrollment: { id: 'e', programId: 'p', programSlug: 'mine', programName: 'Mine', programVersion: 1, startedAt: NOW.toISOString() },
};

function sources(overrides: Partial<PlanInputSources> = {}): PlanInputSources {
  return {
    loadPreferences: jest.fn(async () => allOn),
    listSessions: jest.fn(async () => ({ items: [], nextCursor: null })),
    getEnrollment: jest.fn(async () => ({ enrollment: null })),
    getProgram: jest.fn(),
    listNutritionLog: jest.fn(async () => ({ items: [] })),
    loadFlags: jest.fn(async () => ['weekly_forge'] as readonly string[]),
    getForge: jest.fn(async () => forgeWeek(0.5)),
    listScans: jest.fn(async () => ({ scans: [] })),
    getWeighInSince: jest.fn(async (today: string) => today),
    forgetWeighInSince: jest.fn(async () => undefined),
    getStats: jest.fn(async () => ({ weekStreak: 0 }) as Awaited<ReturnType<PlanInputSources['getStats']>>),
    ...overrides,
  } as PlanInputSources;
}

const withSessions = (items: WorkoutSessionSummary[]) => jest.fn(async () => ({ items, nextCursor: null }));
const ids = (plan: PlannedLocalNotification[] | null) => (plan ?? []).map((entry) => entry.id);

describe('buildLocalNotificationPlan', () => {
  it('plans the weekly recap even with no history, and stays quiet about workouts', async () => {
    const plan = await buildLocalNotificationPlan(sources(), NOW);

    // Two Saturdays fall inside the 14 days from Monday 5 Oct.
    expect(ids(plan)).toEqual(['forjd-local:weekly:2026-10-10', 'forjd-local:weekly:2026-10-17']);
  });

  it('turns sessions into local weekdays and start minutes (a Wednesday habit)', async () => {
    // Wednesdays 30 Sep (5 days before) and 23 Sep (12 days before), both at 18:00.
    const plan = await buildLocalNotificationPlan(sources({ listSessions: withSessions([session(5, 18), session(12, 18)]) }), NOW);

    const reminder = plan!.find((entry) => entry.id === 'forjd-local:workout:2026-10-07');
    expect(reminder?.minute).toBe(17 * 60 + 30);
  });

  it('ignores sessions that were not completed', async () => {
    const items = [session(5, 18, 0, 'cancelled'), session(12, 18, 0, 'in_progress')];
    const plan = await buildLocalNotificationPlan(sources({ listSessions: withSessions(items) }), NOW);

    expect(ids(plan).some((id) => id.includes(':workout:'))).toBe(false);
  });

  it('uses a custom program weekdays and workout names, but not a preset', async () => {
    const program = (isOwn: boolean): ProgramResponse => ({
      id: 'p',
      slug: 'mine',
      name: 'Mine',
      category: 'strength',
      level: 'beginner',
      daysPerWeek: 1,
      durationWeeks: 4,
      description: null,
      isOwn,
      workoutCount: 1,
      version: 1,
      workouts: [{ templateId: 't', name: 'Leg day', activity: 'strength', orderIndex: 0, dayOfWeek: 1, exerciseNames: [] }],
    });
    const forProgram = (isOwn: boolean) =>
      sources({
        listSessions: withSessions([session(5, 18)]),
        getEnrollment: jest.fn(async () => enrollment),
        getProgram: jest.fn(async () => program(isOwn)),
      });

    const custom = await buildLocalNotificationPlan(forProgram(true), NOW);
    const preset = await buildLocalNotificationPlan(forProgram(false), NOW);

    // Custom: the Monday program day wins, with its workout name.
    expect(custom!.find((entry) => entry.kind === 'workout')?.body).toBe('Leg day is next.');
    // Preset: no weekdays prescribed, and one Wednesday in four weeks is not a habit, so no workout reminder.
    expect(ids(preset).some((id) => id.includes(':workout:'))).toBe(false);
  });

  it('respects the switches from the device copy', async () => {
    const plan = await buildLocalNotificationPlan(sources({ loadPreferences: jest.fn(async () => allOff) }), NOW);

    expect(plan).toEqual([]);
  });

  it('answers null, leaving the schedule alone, when the sessions cannot be read', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({
        listSessions: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan).toBeNull();
  });

  it('answers null when the program cannot be read', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({
        getEnrollment: jest.fn(async () => enrollment),
        getProgram: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan).toBeNull();
  });

  it('does not touch the network when both switches are off', async () => {
    const s = sources({ loadPreferences: jest.fn(async () => allOff) });

    await buildLocalNotificationPlan(s, NOW);

    expect(s.listSessions).not.toHaveBeenCalled();
    expect(s.getEnrollment).not.toHaveBeenCalled();
  });
});

describe('buildLocalNotificationPlan: log your meals (12E-5)', () => {
  const mealsOn = { ...DEFAULT_NOTIFICATION_PREFERENCES, workout: false, weekly: false, meals: true };
  const entry = { id: 'e1' } as unknown as Awaited<ReturnType<PlanInputSources['listNutritionLog']>>['items'][number];

  it('plans the evening reminder when the switch is on and nothing is logged today', async () => {
    const plan = await buildLocalNotificationPlan(sources({ loadPreferences: jest.fn(async () => mealsOn) }), NOW);

    expect(ids(plan)[0]).toBe('forjd-local:meals:2026-10-05');
    expect(plan).toHaveLength(14);
  });

  it('asks for today in the phone local calendar, and drops only today when food is already logged', async () => {
    const listNutritionLog = jest.fn(async () => ({ items: [entry] }));

    const plan = await buildLocalNotificationPlan(sources({ loadPreferences: jest.fn(async () => mealsOn), listNutritionLog }), NOW);

    expect(listNutritionLog).toHaveBeenCalledWith('2026-10-05');
    expect(plan).toHaveLength(13);
    expect(ids(plan)[0]).toBe('forjd-local:meals:2026-10-06');
  });

  it('does not read the food log when the meals switch is off', async () => {
    const s = sources();

    await buildLocalNotificationPlan(s, NOW);

    expect(s.listNutritionLog).not.toHaveBeenCalled();
  });

  it('drops only today when the food log cannot be read, and still plans the other kinds', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({
        loadPreferences: jest.fn(async () => ({ ...mealsOn, weekly: true })),
        listNutritionLog: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    // Unknown is treated as logged, so a reminder is never sent for food that may already be in; later days stay.
    expect(ids(plan)).toContain('forjd-local:weekly:2026-10-10');
    expect(ids(plan)).not.toContain('forjd-local:meals:2026-10-05');
    expect(ids(plan)).toContain('forjd-local:meals:2026-10-06');
  });

  it('still reads nothing from the network when only meals is on and the other switches are off', async () => {
    const s = sources({ loadPreferences: jest.fn(async () => mealsOn) });

    await buildLocalNotificationPlan(s, NOW);

    expect(s.listSessions).not.toHaveBeenCalled();
    expect(s.getEnrollment).not.toHaveBeenCalled();
  });
});

describe('buildLocalNotificationPlan: no workout yet this week (12E-6)', () => {
  const noWorkoutOn = { ...DEFAULT_NOTIFICATION_PREFERENCES, workout: false, weekly: false, noWorkout: true };
  const stats = (weekStreak: number) => jest.fn(async () => ({ weekStreak }) as Awaited<ReturnType<PlanInputSources['getStats']>>);
  // NOW is Monday 5 Oct 2026: this week is Saturday 3 Oct to Friday 9 Oct, so its Thursday is 8 Oct.
  const noWorkoutIds = (plan: PlannedLocalNotification[] | null) => ids(plan).filter((id) => id.includes(':noWorkout:'));

  it('plans Thursday, naming the streak the server counts', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({ loadPreferences: jest.fn(async () => noWorkoutOn), getStats: stats(4) }),
      NOW,
    );

    expect(noWorkoutIds(plan)).toEqual(['forjd-local:noWorkout:2026-10-08', 'forjd-local:noWorkout:2026-10-15']);
    expect(plan?.[0]?.body).toBe('Keep your 4-week streak.');
  });

  it('drops this week when a completed session is already in it', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({ loadPreferences: jest.fn(async () => noWorkoutOn), listSessions: withSessions([session(1, 18)]) }),
      NOW,
    );

    expect(noWorkoutIds(plan)).toEqual(['forjd-local:noWorkout:2026-10-15']);
  });

  it('still plans, without a streak, when the stats cannot be read', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({
        loadPreferences: jest.fn(async () => noWorkoutOn),
        getStats: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan?.[0]?.body).toBe('Fit one in before the week closes.');
  });

  it('answers null, leaving the schedule alone, when the sessions cannot be read', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({
        loadPreferences: jest.fn(async () => noWorkoutOn),
        listSessions: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan).toBeNull();
  });

  it('stays quiet about a week the custom program the person follows leaves without a workout on Thursday or Friday', async () => {
    const enrollment = {
      enrollment: { id: 'e', programId: 'p', programSlug: 'mine', programName: 'Mine', programVersion: 1, startedAt: NOW.toISOString() },
    };
    const program = (dayOfWeek: number): ProgramResponse => ({
      id: 'p',
      slug: 'mine',
      name: 'Mine',
      category: 'strength',
      level: 'beginner',
      daysPerWeek: 1,
      durationWeeks: 4,
      description: null,
      isOwn: true,
      workoutCount: 1,
      version: 1,
      workouts: [{ templateId: 't', name: 'Push', activity: 'strength', orderIndex: 0, dayOfWeek, exerciseNames: [] }],
    });
    const follow = (dayOfWeek: number) =>
      sources({
        loadPreferences: jest.fn(async () => noWorkoutOn),
        getEnrollment: jest.fn(async () => enrollment),
        getProgram: jest.fn(async () => program(dayOfWeek)),
      });

    // A Tuesday-only program has nothing left by Thursday; a Friday one still does.
    expect(noWorkoutIds(await buildLocalNotificationPlan(follow(2), NOW))).toEqual([]);
    expect(noWorkoutIds(await buildLocalNotificationPlan(follow(5), NOW))).toHaveLength(2);
  });

  it('reads neither sessions nor stats when the switch is off', async () => {
    const s = sources({ loadPreferences: jest.fn(async () => ({ ...noWorkoutOn, noWorkout: false, weekly: true })) });

    await buildLocalNotificationPlan(s, NOW);

    expect(s.getStats).not.toHaveBeenCalled();
    expect(s.listSessions).not.toHaveBeenCalled();
  });
});

describe('buildLocalNotificationPlan: Weekly Forge closing (12E-7)', () => {
  const forgeOn = { ...DEFAULT_NOTIFICATION_PREFERENCES, workout: false, weekly: false, forgeClosing: true };
  const forgeIds = (plan: PlannedLocalNotification[] | null) => ids(plan).filter((id) => id.includes(':forgeClosing:'));
  const withForge = (over: Partial<PlanInputSources> = {}) => sources({ loadPreferences: jest.fn(async () => forgeOn), ...over });

  it('plans the Friday nudge when the feature is on and a ladder is close', async () => {
    const plan = await buildLocalNotificationPlan(withForge({ getForge: jest.fn(async () => forgeWeek(0.8)) }), NOW);

    expect(forgeIds(plan)).toEqual(['forjd-local:forgeClosing:2026-10-09']);
  });

  it('stays quiet when no ladder is close', async () => {
    const plan = await buildLocalNotificationPlan(withForge({ getForge: jest.fn(async () => forgeWeek(0.3)) }), NOW);

    expect(forgeIds(plan)).toEqual([]);
  });

  it('does not read the Forge at all while its feature flag is off', async () => {
    const s = withForge({ loadFlags: jest.fn(async () => []) });

    const plan = await buildLocalNotificationPlan(s, NOW);

    expect(s.getForge).not.toHaveBeenCalled();
    expect(forgeIds(plan)).toEqual([]);
  });

  it('treats a 404 from the server (the feature is switched off) as nothing to remind about', async () => {
    const plan = await buildLocalNotificationPlan(
      withForge({
        getForge: jest.fn(async () => {
          throw { response: { status: 404 } };
        }),
      }),
      NOW,
    );

    expect(plan).toEqual([]);
  });

  it('answers null, leaving the schedule alone, when the Forge cannot be read for another reason', async () => {
    const plan = await buildLocalNotificationPlan(
      withForge({
        getForge: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan).toBeNull();
  });

  it('reads neither the flags nor the Forge when the switch is off', async () => {
    const s = sources();

    await buildLocalNotificationPlan(s, NOW);

    expect(s.loadFlags).not.toHaveBeenCalled();
    expect(s.getForge).not.toHaveBeenCalled();
  });
});

describe('buildLocalNotificationPlan: monthly weigh-in or scan (12E-8)', () => {
  const weighInOn = { ...DEFAULT_NOTIFICATION_PREFERENCES, workout: false, weekly: false, weighIn: true };
  const weighInIds = (plan: PlannedLocalNotification[] | null) => ids(plan).filter((id) => id.includes(':weighIn:'));
  const scanOn = (day: number, month = 8) =>
    ({ id: 's', measuredAt: new Date(2026, month, day, 9).toISOString(), source: 'inbody', weightKg: 80, bodyFatPercent: 15 }) as never;
  const withWeighIn = (over: Partial<PlanInputSources> = {}) => sources({ loadPreferences: jest.fn(async () => weighInOn), ...over });

  it('counts 30 days from the latest scan, in the phone local calendar', async () => {
    // Scans on 1 Sep and 9 Sep: the latest is 9 Sep, so the reminder is 9 Oct.
    const plan = await buildLocalNotificationPlan(
      withWeighIn({ listScans: jest.fn(async () => ({ scans: [scanOn(1), scanOn(9)] })) }),
      NOW,
    );

    expect(weighInIds(plan)).toEqual(['forjd-local:weighIn:2026-10-09']);
  });

  it('with no scan, counts from the day the switch was turned on', async () => {
    const getWeighInSince = jest.fn(async () => '2026-09-09');

    const plan = await buildLocalNotificationPlan(withWeighIn({ getWeighInSince }), NOW);

    expect(getWeighInSince).toHaveBeenCalledWith('2026-10-05');
    expect(weighInIds(plan)).toEqual(['forjd-local:weighIn:2026-10-09']);
  });

  it('does not read the stored day when there is a scan to count from', async () => {
    const s = withWeighIn({ listScans: jest.fn(async () => ({ scans: [scanOn(9)] })) });

    await buildLocalNotificationPlan(s, NOW);

    expect(s.getWeighInSince).not.toHaveBeenCalled();
  });

  it('answers null, leaving the schedule alone, when the scans cannot be read', async () => {
    const plan = await buildLocalNotificationPlan(
      withWeighIn({
        listScans: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan).toBeNull();
  });

  it('reads nothing when the switch is off, and forgets the start day so turning it on again starts a new month', async () => {
    const s = sources();

    await buildLocalNotificationPlan(s, NOW);

    expect(s.listScans).not.toHaveBeenCalled();
    expect(s.getWeighInSince).not.toHaveBeenCalled();
    expect(s.forgetWeighInSince).toHaveBeenCalled();
  });

  it('keeps the start day while the switch is on', async () => {
    const s = withWeighIn();

    await buildLocalNotificationPlan(s, NOW);

    expect(s.forgetWeighInSince).not.toHaveBeenCalled();
  });

  it('ignores a scan dated in the future, so one typo does not silence the reminder', async () => {
    // A scan on 9 Sep and a mistaken one in 2027: the real latest scan counts.
    const typo = { id: 's2', measuredAt: new Date(2027, 8, 9, 9).toISOString(), source: 'manual', weightKg: 80, bodyFatPercent: null } as never;
    const plan = await buildLocalNotificationPlan(
      withWeighIn({ listScans: jest.fn(async () => ({ scans: [scanOn(9), typo] })) }),
      NOW,
    );

    expect(weighInIds(plan)).toEqual(['forjd-local:weighIn:2026-10-09']);
  });
});
