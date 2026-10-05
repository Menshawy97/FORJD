import type { ProgramResponse, WorkoutSessionSummary } from '@forjd/contracts';
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

  it('answers null, leaving the schedule alone, when the food log cannot be read', async () => {
    const plan = await buildLocalNotificationPlan(
      sources({
        loadPreferences: jest.fn(async () => mealsOn),
        listNutritionLog: jest.fn(async () => {
          throw new Error('offline');
        }),
      }),
      NOW,
    );

    expect(plan).toBeNull();
  });

  it('still reads nothing from the network when only meals is on and the other switches are off', async () => {
    const s = sources({ loadPreferences: jest.fn(async () => mealsOn) });

    await buildLocalNotificationPlan(s, NOW);

    expect(s.listSessions).not.toHaveBeenCalled();
    expect(s.getEnrollment).not.toHaveBeenCalled();
  });
});
