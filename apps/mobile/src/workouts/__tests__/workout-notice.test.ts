// 12B-2 and 12B-2b (ADR-063, ADR-061, ADR-026). The workout's lock-screen notice: what each card says,
// how the controller follows the active workout, and how a tap on its buttons is routed back into it.
// The active workout, the native module and the rest-complete alert are injected fakes; the Kotlin is
// walked on a phone.
import type { NoticeActionEvent, OngoingNoticeOptions } from '@/integrations/notifications/ongoing-notice';

import type { ActiveWorkoutListener, ActiveWorkoutState } from '../active-workout';
import { completeSet, startSession, type LiveSession, type LiveSessionChange } from '../live-session';
import { workoutNoticeContent } from '../workout-notice-content';
import { WORKOUT_NOTICE_ID, createWorkoutNotice, type WorkoutNoticeDeps } from '../workout-notice';

const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);
const STARTED = NOW - 600_000;

function makeSession(over: Partial<LiveSession> = {}): LiveSession {
  return {
    ...startSession({
      id: 'session-1',
      templateId: null,
      name: 'Push Day',
      activity: 'strength',
      startedAt: new Date(STARTED),
      exercises: [
        {
          exerciseId: 'bench',
          name: 'Bench Press',
          measure: 'weight',
          sets: [
            { weightKg: 82.5, reps: 6 },
            { weightKg: 82.5, reps: 6 },
            { weightKg: 80, reps: 8 },
            { weightKg: 80, reps: 8 },
          ],
        },
        {
          exerciseId: 'plank',
          name: 'Plank',
          measure: 'time',
          sets: [{ durationSeconds: 45 }],
        },
      ],
    }),
    ...over,
  };
}

/** The same session with its first `count` bench sets ticked. */
function withBenchDone(session: LiveSession, count: number): LiveSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise, index) =>
      index === 0
        ? { ...exercise, sets: exercise.sets.map((set, i) => ({ ...set, isCompleted: i < count })) }
        : exercise,
    ),
  };
}

type Units = Record<string, 'kg' | 'lb' | 'm' | 'mi'>;

const input = (session: LiveSession, extra: { pausedMs?: number; units?: Units } = {}) => ({
  session,
  pausedMs: extra.pausedMs ?? 0,
  units: extra.units ?? {},
});

describe('workoutNoticeContent', () => {
  it('draws the set card: the exercise, the set count, the load and a Done button', () => {
    const card = workoutNoticeContent({ ...input(withBenchDone(makeSession(), 2)), rest: null });

    expect(card).toMatchObject({
      id: WORKOUT_NOTICE_ID,
      title: 'Bench Press',
      text: 'Set 3 of 4 · 80 kg × 8',
      subText: 'Push Day',
      color: '#E9712F',
      chronometer: { countUpFromMs: STARTED },
    });
    expect(card?.actions).toEqual([expect.objectContaining({ title: 'Done' })]);
    expect(card?.actions?.[0]?.opensApp).toBeFalsy();
  });

  it('counts the elapsed time from the start plus the time spent paused', () => {
    const card = workoutNoticeContent({ ...input(makeSession(), { pausedMs: 90_000 }), rest: null });

    expect(card?.chronometer).toEqual({ countUpFromMs: STARTED + 90_000 });
  });

  it('shows no ticking time while paused, and says so', () => {
    const card = workoutNoticeContent({ ...input(makeSession({ status: 'paused' })), rest: null });

    expect(card?.chronometer).toBeUndefined();
    expect(card?.subText).toBe('Push Day · Paused');
  });

  it('shows the load in the unit the exercise is read in on the live screen', () => {
    const card = workoutNoticeContent({ ...input(makeSession(), { units: { bench: 'lb' } }), rest: null });

    // 82.5 kg is 181.88 lb, rounded to the nearest half pound by the same helper the live screen uses.
    expect(card?.text).toBe('Set 1 of 4 · 182 lb × 6');
  });

  it('describes a bodyweight set by its reps alone', () => {
    const session = startSession({
      id: 's',
      templateId: null,
      name: 'Pull Day',
      activity: 'strength',
      startedAt: new Date(STARTED),
      exercises: [{ exerciseId: 'chin', name: 'Chin-up', measure: 'weight', sets: [{ reps: 10 }] }],
    });

    expect(workoutNoticeContent({ ...input(session), rest: null })?.text).toBe('Set 1 of 1 · 10 reps');
  });

  it('opens the app for a timed set instead of ticking it silently', () => {
    const session = withBenchDone(makeSession(), 4);
    const card = workoutNoticeContent({ ...input(session), rest: null });

    expect(card).toMatchObject({ title: 'Plank', text: 'Set 1 of 1 · 45 s' });
    expect(card?.actions).toEqual([expect.objectContaining({ title: 'Start timer', opensApp: true })]);
  });

  it('draws the rest card: a countdown, what is next and Skip rest, with the next set waiting behind it', () => {
    const session = withBenchDone(makeSession(), 1);
    const card = workoutNoticeContent({ ...input(session), rest: { endsAt: NOW + 90_000 } });

    expect(card).toMatchObject({
      title: 'REST',
      text: 'Next · Bench Press · 82.5 kg × 6',
      subText: 'Push Day',
      chronometer: { countDownToMs: NOW + 90_000 },
    });
    expect(card?.actions).toEqual([expect.objectContaining({ title: 'Skip rest' })]);
    expect(card?.then).toMatchObject({
      title: 'Bench Press',
      text: 'Set 2 of 4 · 82.5 kg × 6',
      chronometer: { countUpFromMs: STARTED },
    });
    expect(card?.then?.actions).toEqual([expect.objectContaining({ title: 'Done' })]);
  });

  it('says every set is done, and offers no button, when nothing is left', () => {
    const base = makeSession();
    const done = {
      ...base,
      exercises: base.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({ ...set, isCompleted: true })),
      })),
    };

    const idle = workoutNoticeContent({ ...input(done), rest: null });
    expect(idle).toMatchObject({ title: 'All sets complete', text: 'Open FORJD to finish your workout' });
    expect(idle?.actions ?? []).toEqual([]);

    const rest = workoutNoticeContent({ ...input(done), rest: { endsAt: NOW + 90_000 } });
    expect(rest?.text).toBe('Next · All sets complete');
    expect(rest?.then?.title).toBe('All sets complete');
  });

  it('draws nothing for a finished workout', () => {
    expect(workoutNoticeContent({ ...input(makeSession({ status: 'completed' })), rest: null })).toBeNull();
  });

  it('puts only training values in the text (ADR-061)', () => {
    const card = workoutNoticeContent({ ...input(makeSession()), rest: { endsAt: NOW + 1000 } });

    expect(JSON.stringify(card)).not.toMatch(/heart|hrv|sleep|calorie|body ?fat/i);
  });
});

interface FakeWorkout {
  getState: () => ActiveWorkoutState;
  subscribe: (listener: ActiveWorkoutListener) => () => void;
  apply: jest.Mock<void, [LiveSessionChange]>;
  /** Puts a session (and its paused total) into the active workout, as any change to it would. */
  show: (session: LiveSession | null, pausedMs?: number) => void;
}

function fakeWorkout(): FakeWorkout {
  let state: ActiveWorkoutState = {
    session: null,
    pausedMs: 0,
    pausedSince: null,
    isLogging: true,
    logFailures: 0,
    resumed: false,
  };
  const listeners = new Set<ActiveWorkoutListener>();
  const emit = (change: LiveSessionChange | null) => listeners.forEach((listener) => listener(state, change));
  const apply = jest.fn((change: LiveSessionChange) => {
    state = { ...state, session: change.session };
    emit(change);
  });
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply,
    show: (session, pausedMs = 0) => {
      state = { ...state, session, pausedMs };
      emit(null);
    },
  };
}

interface Harness {
  controller: ReturnType<typeof createWorkoutNotice>;
  notice: jest.Mocked<WorkoutNoticeDeps['notice']>;
  alerts: jest.Mocked<WorkoutNoticeDeps['alerts']>;
  workout: FakeWorkout;
  clock: { now: number };
  tap: (actionId: string, noticeId?: string) => void;
  unbind: () => void;
  unsubscribeTaps: jest.Mock;
  /** The away timer, captured: call `fire` to simulate the three hours passing. */
  away: { fire: () => void; armed: () => boolean; delay: () => number | null };
  shown: () => OngoingNoticeOptions[];
  lastShown: () => OngoingNoticeOptions;
}

function harness(): Harness {
  let handler: ((event: NoticeActionEvent) => void) | null = null;
  const unsubscribeTaps = jest.fn();
  const notice = {
    show: jest.fn().mockResolvedValue(true),
    dismiss: jest.fn().mockResolvedValue(undefined),
    onAction: jest.fn((next: (event: NoticeActionEvent) => void) => {
      handler = next;
      return unsubscribeTaps;
    }),
  } as unknown as jest.Mocked<WorkoutNoticeDeps['notice']>;
  const alerts = {
    ensurePermission: jest.fn().mockResolvedValue(true),
    schedule: jest.fn().mockResolvedValue('alert-1'),
    cancel: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WorkoutNoticeDeps['alerts']>;
  const clock = { now: NOW };
  const workout = fakeWorkout();
  let armedFn: (() => void) | null = null;
  let armedDelay: number | null = null;
  const controller = createWorkoutNotice({
    notice,
    alerts,
    workout,
    now: () => clock.now,
    after: (fn, ms) => {
      armedFn = fn;
      armedDelay = ms;
      return () => {
        armedFn = null;
        armedDelay = null;
      };
    },
  });
  const unbind = controller.bind();
  return {
    controller,
    notice,
    alerts,
    workout,
    clock,
    unbind,
    unsubscribeTaps,
    away: {
      fire: () => {
        const fn = armedFn;
        armedFn = null;
        armedDelay = null;
        fn?.();
      },
      armed: () => armedFn !== null,
      delay: () => armedDelay,
    },
    tap: (actionId, noticeId = WORKOUT_NOTICE_ID) => handler?.({ noticeId, actionId }),
    shown: () => notice.show.mock.calls.map((call) => call[0]),
    lastShown: () => notice.show.mock.calls[notice.show.mock.calls.length - 1]![0],
  };
}

/** Lets the controller's awaited permission check and show calls finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function sync(h: Harness, session: LiveSession, extra: { pausedMs?: number; units?: Units } = {}) {
  if (extra.units) h.controller.setUnits(extra.units);
  h.workout.show(session, extra.pausedMs ?? 0);
  await settle();
}

/** A rest of `seconds` begins with `session` as the workout. */
async function startRest(h: Harness, session: LiveSession, seconds: number) {
  h.workout.show(session);
  h.controller.beginRest(seconds);
  await settle();
}

describe('the workout notice controller: showing', () => {
  it('asks for notification permission once, then shows the set card', async () => {
    const h = harness();
    await sync(h, makeSession());
    await sync(h, withBenchDone(makeSession(), 1));

    expect(h.alerts.ensurePermission).toHaveBeenCalledTimes(1);
    expect(h.shown()[0]).toMatchObject({ title: 'Bench Press', text: 'Set 1 of 4 · 82.5 kg × 6' });
  });

  it('does not repost a card that has not changed', async () => {
    const h = harness();
    await sync(h, makeSession());
    await sync(h, makeSession());

    expect(h.notice.show).toHaveBeenCalledTimes(1);
  });

  it('updates the card when a weight is edited', async () => {
    const h = harness();
    await sync(h, makeSession());
    const edited = makeSession();
    edited.exercises[0]!.sets[0]!.weightKg = 85;
    await sync(h, edited);

    expect(h.lastShown().text).toBe('Set 1 of 4 · 85 kg × 6');
  });

  it('updates the card when the unit is flipped', async () => {
    const h = harness();
    await sync(h, makeSession());
    h.controller.setUnits({ bench: 'lb' });
    await settle();

    expect(h.lastShown().text).toBe('Set 1 of 4 · 182 lb × 6');
  });

  it('shows nothing when notifications are refused, and never breaks the workout', async () => {
    const h = harness();
    h.alerts.ensurePermission.mockResolvedValue(false);
    h.notice.show.mockRejectedValue(new Error('boom'));

    await expect(sync(h, makeSession())).resolves.toBeUndefined();
  });

  it('shows a workout that already exists when it starts following', async () => {
    const h = harness();
    h.unbind();
    h.workout.show(makeSession());

    h.controller.bind();
    await settle();

    expect(h.lastShown().title).toBe('Bench Press');
  });
});

describe('the workout notice controller: rest', () => {
  const afterFirstSet = () => withBenchDone(makeSession(), 1);

  it('starts the rest: owns the end time, schedules the rest-complete alert and shows the countdown', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);

    expect(h.controller.getRest()).toMatchObject({ endsAt: NOW + 90_000, totalSeconds: 90 });
    expect(h.alerts.schedule).toHaveBeenCalledWith(90);
    expect(h.lastShown()).toMatchObject({ title: 'REST', chronometer: { countDownToMs: NOW + 90_000 } });
  });

  it('starts the rest when a completed set says one began, whichever screen did it', async () => {
    const h = harness();
    await sync(h, makeSession());

    h.workout.apply(completeSet(makeSession(), 0, 0, new Date(NOW)));
    await settle();

    expect(h.controller.getRest()).toMatchObject({ totalSeconds: 90 });
    expect(h.alerts.schedule).toHaveBeenCalledWith(90);
    expect(h.lastShown().title).toBe('REST');
  });

  it('works with no workout at all (the rest screen opened on its own)', async () => {
    const h = harness();
    h.controller.beginRest(60);
    await settle();

    expect(h.controller.getRest()?.endsAt).toBe(NOW + 60_000);
    expect(h.alerts.schedule).toHaveBeenCalledWith(60);
    expect(h.notice.show).not.toHaveBeenCalled();
  });

  it('skipping rest cancels the alert, shows the next set and tells the rest screen', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    const listener = jest.fn();
    h.controller.subscribeRest(listener);

    h.controller.skipRest();
    await settle();

    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.controller.getRest()).toBeNull();
    expect(h.lastShown()).toMatchObject({ title: 'Bench Press', text: 'Set 2 of 4 · 82.5 kg × 6' });
    expect(listener).toHaveBeenCalled();
  });

  it('a Skip tap on the notice does the same as the Skip button on the rest screen', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    const skipId = h.lastShown().actions![0]!.id;

    h.tap(skipId);
    await settle();

    expect(h.controller.getRest()).toBeNull();
    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
  });

  it('drops a Skip for a rest that has since been adjusted', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    const oldSkip = h.lastShown().actions![0]!.id;
    h.clock.now = NOW + 1000;
    h.controller.adjustRest(30);
    await settle();

    h.tap(oldSkip);

    expect(h.controller.getRest()).not.toBeNull();
  });

  it('drops a Skip that arrives after the rest is over', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    const skipId = h.lastShown().actions![0]!.id;
    h.clock.now = NOW + 120_000;
    h.notice.show.mockClear();

    h.tap(skipId);
    await settle();

    expect(h.notice.show).not.toHaveBeenCalled();
    expect(h.controller.getRest()).toBeNull();
  });

  it('adjusting moves the end, re-schedules the alert and re-posts the countdown', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    h.clock.now = NOW + 10_000;
    h.alerts.schedule.mockResolvedValue('alert-2');

    h.controller.adjustRest(30);
    await settle();

    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.alerts.schedule).toHaveBeenLastCalledWith(110);
    expect(h.controller.getRest()).toMatchObject({ endsAt: NOW + 120_000, totalSeconds: 110 });
    expect(h.lastShown().chronometer).toEqual({ countDownToMs: NOW + 120_000 });
  });

  it('shortening below zero ends the countdown at now, never before', async () => {
    const h = harness();
    h.controller.beginRest(10);
    await settle();

    h.controller.adjustRest(-15);

    expect(h.controller.getRest()?.endsAt ?? NOW).toBeGreaterThanOrEqual(NOW);
  });

  it('ending a rest cancels its alert and clears it', async () => {
    const h = harness();
    h.controller.beginRest(90);
    await settle();

    h.controller.skipRest();
    await settle();

    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.controller.getRest()).toBeNull();
  });

  it('cancels an alert that was scheduled after its rest had already ended', async () => {
    const h = harness();
    let resolve: (id: string | null) => void = () => undefined;
    h.alerts.schedule.mockReturnValue(new Promise<string | null>((done) => (resolve = done)));
    h.controller.beginRest(90);
    await settle();

    h.controller.skipRest();
    resolve('late-alert');
    await settle();

    expect(h.alerts.cancel).toHaveBeenCalledWith('late-alert');
  });

  it('a refused permission leaves the countdown and the card working, with no alert', async () => {
    const h = harness();
    h.alerts.schedule.mockResolvedValue(null);
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    h.controller.skipRest();
    await settle();

    expect(h.alerts.cancel).not.toHaveBeenCalled();
  });

  it('an expired rest is dropped on the next change, so the set card and its Done come back', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);
    h.clock.now = NOW + 120_000;

    await sync(h, afterFirstSet());

    expect(h.controller.getRest()).toBeNull();
    expect(h.lastShown().title).toBe('Bench Press');
  });

  it('starting another workout drops the rest that belonged to the old one', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, afterFirstSet(), 90);

    await sync(h, makeSession({ id: 'session-2' }));

    expect(h.controller.getRest()).toBeNull();
    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.lastShown().title).toBe('Bench Press');
  });
});

describe('the workout notice controller: taps', () => {
  it('Done logs the open set exactly as ticking it on the live screen does', async () => {
    const h = harness();
    await sync(h, makeSession());
    const doneId = h.lastShown().actions![0]!.id;

    h.tap(doneId);

    expect(h.workout.apply).toHaveBeenCalledTimes(1);
    const change = h.workout.apply.mock.calls[0]![0];
    expect(change.events.map((event) => event.type)).toEqual(['set_completed', 'rest_started']);
    expect(change.events[0]!.payload).toMatchObject({ exerciseId: 'bench', setIndex: 0, weightKg: 82.5, reps: 6 });
    expect(change.restStartedSeconds).toBe(90);
  });

  it('a second tap on the same Done is dropped, even before any screen has re-rendered', async () => {
    const h = harness();
    await sync(h, makeSession());
    const doneId = h.lastShown().actions![0]!.id;

    h.tap(doneId);
    h.tap(doneId);

    expect(h.workout.apply).toHaveBeenCalledTimes(1);
  });

  it('drops a Done for a set that is no longer the open one, never applying it to the next', async () => {
    const h = harness();
    await sync(h, makeSession());
    const doneForSetOne = h.lastShown().actions![0]!.id;
    await sync(h, withBenchDone(makeSession(), 1));

    h.tap(doneForSetOne);

    expect(h.workout.apply).not.toHaveBeenCalled();
  });

  it('drops a tap that belongs to another workout', async () => {
    const h = harness();
    await sync(h, makeSession());
    const doneId = h.lastShown().actions![0]!.id;
    await sync(h, makeSession({ id: 'session-2' }));

    h.tap(doneId);

    expect(h.workout.apply).not.toHaveBeenCalled();
  });

  it('ignores taps on other notices and unreadable ids', async () => {
    const h = harness();
    await sync(h, makeSession());
    const doneId = h.lastShown().actions![0]!.id;

    h.tap(doneId, 'forjd-run-live');
    h.tap('garbage');
    h.tap('');

    expect(h.workout.apply).not.toHaveBeenCalled();
  });

  it('the Start timer button routes through the same reducer, which opens the set timer', async () => {
    const h = harness();
    await sync(h, withBenchDone(makeSession(), 4));
    const startId = h.lastShown().actions![0]!.id;

    h.tap(startId);

    const change = h.workout.apply.mock.calls[0]![0];
    expect(change.events).toEqual([]);
    expect(change.opensTimerFor).toMatchObject({ exerciseIndex: 1, setIndex: 0, seconds: 45 });
  });

  it('a Done for the next set, arriving as the rest ends, is accepted', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, withBenchDone(makeSession(), 1), 90);
    h.clock.now = NOW + 91_000;
    const nextDone = h.shown().find((card) => card.then)!.then!.actions![0]!.id;

    h.tap(nextDone);

    expect(h.workout.apply).toHaveBeenCalledTimes(1);
  });

  it('drops a Done that arrives after Finish, so no set is logged after workout_finished', async () => {
    const h = harness();
    await sync(h, makeSession());
    const doneId = h.lastShown().actions![0]!.id;
    h.workout.show(makeSession({ status: 'completed' }));

    h.tap(doneId);

    expect(h.workout.apply).not.toHaveBeenCalled();
  });

  it('keeps a tap made while the app was stopped until the workout is restored, then checks it', async () => {
    const h = harness();
    const done = (session: LiveSession) =>
      workoutNoticeContent({ ...input(session), rest: null })!.actions![0]!.id;
    const forSetOne = done(makeSession());
    const forSetTwo = done(withBenchDone(makeSession(), 1));

    // Two Dones for set 1 and one for set 2, delivered before any workout exists.
    h.tap(forSetOne);
    h.tap(forSetOne);
    h.tap(forSetTwo);
    expect(h.workout.apply).not.toHaveBeenCalled();

    await sync(h, makeSession());

    // Set 1 is ticked once; the repeat is dropped; set 2 then ticks because it became the open set.
    expect(h.workout.apply).toHaveBeenCalledTimes(2);
  });

  it('drops early taps that belong to a workout other than the one restored', async () => {
    const h = harness();
    const other = workoutNoticeContent({ ...input(makeSession({ id: 'old-session' })), rest: null })!.actions![0]!.id;

    h.tap(other);
    await sync(h, makeSession());

    expect(h.workout.apply).not.toHaveBeenCalled();
  });

  it('a Skip for a rest this process does not know leaves the set card showing, not the dead REST card', async () => {
    const h = harness();
    const skipId = workoutNoticeContent({
      ...input(withBenchDone(makeSession(), 1)),
      rest: { endsAt: NOW + 60_000 },
    })!.actions![0]!.id;

    // The process was restarted mid-rest: the tap arrives before the workout, and no rest exists.
    h.tap(skipId);
    await sync(h, withBenchDone(makeSession(), 1));

    expect(h.controller.getRest()).toBeNull();
    expect(h.lastShown()).toMatchObject({ title: 'Bench Press', text: 'Set 2 of 4 · 82.5 kg × 6' });
  });
});

describe('the workout notice controller: every exit', () => {
  it('finishing the workout takes the card down and cancels a rest in progress', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, withBenchDone(makeSession(), 1), 90);
    h.notice.dismiss.mockClear();

    h.workout.show(makeSession({ status: 'completed' }));
    await settle();

    expect(h.notice.dismiss).toHaveBeenCalledWith(WORKOUT_NOTICE_ID);
    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.controller.getRest()).toBeNull();
  });

  it('discarding the workout (no workout left) does the same', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, withBenchDone(makeSession(), 1), 90);
    h.notice.dismiss.mockClear();

    h.workout.show(null);
    await settle();

    expect(h.notice.dismiss).toHaveBeenCalledWith(WORKOUT_NOTICE_ID);
    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.controller.getRest()).toBeNull();
  });

  it('dismisses once when the workout finishes, however many changes follow', async () => {
    const h = harness();
    await sync(h, makeSession());
    h.notice.dismiss.mockClear();

    await sync(h, makeSession({ status: 'completed' }));
    await sync(h, makeSession({ status: 'completed' }));

    expect(h.notice.dismiss).toHaveBeenCalledTimes(1);
  });

  it('unbinding takes everything down and stops listening', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, withBenchDone(makeSession(), 1), 90);
    h.notice.dismiss.mockClear();

    h.unbind();
    await settle();

    expect(h.notice.dismiss).toHaveBeenCalledWith(WORKOUT_NOTICE_ID);
    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.controller.getRest()).toBeNull();
    expect(h.unsubscribeTaps).toHaveBeenCalled();
  });

  it('a card still posting when the workout ends is taken down again', async () => {
    const h = harness();
    let finish: (shown: boolean) => void = () => undefined;
    h.notice.show.mockReturnValue(new Promise<boolean>((done) => (finish = done)));
    h.workout.show(makeSession());
    await settle();

    h.workout.show(null);
    finish(true);
    await settle();

    expect(h.notice.dismiss.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a card that was posting before a new workout began does not take down the newer card', async () => {
    const h = harness();
    let finishOld: (shown: boolean) => void = () => undefined;
    h.notice.show.mockReturnValueOnce(new Promise<boolean>((done) => (finishOld = done)));
    h.workout.show(makeSession());
    await settle();

    h.workout.show(null);
    h.notice.dismiss.mockClear();
    await sync(h, makeSession({ id: 'session-2' }));
    finishOld(true);
    await settle();

    expect(h.notice.dismiss).not.toHaveBeenCalled();
  });
});

describe('the workout notice controller: away from the workout screen', () => {
  it('takes the card down after three hours away with nothing logged, but not the workout', async () => {
    const h = harness();
    await sync(h, makeSession());
    h.controller.setViewing(true);
    h.controller.setViewing(false);
    expect(h.away.delay()).toBe(3 * 60 * 60 * 1000);
    h.notice.dismiss.mockClear();

    h.away.fire();
    await settle();

    expect(h.notice.dismiss).toHaveBeenCalledWith(WORKOUT_NOTICE_ID);
    expect(h.workout.getState().session).not.toBeNull();
  });

  it('cancels a rest and its alert when the card is taken down', async () => {
    const h = harness();
    await sync(h, makeSession());
    await startRest(h, withBenchDone(makeSession(), 1), 90);

    h.controller.setViewing(false);
    h.away.fire();
    await settle();

    expect(h.alerts.cancel).toHaveBeenCalledWith('alert-1');
    expect(h.controller.getRest()).toBeNull();
  });

  it('restarts the three hours when the workout changes while away', async () => {
    const h = harness();
    await sync(h, makeSession());
    h.controller.setViewing(false);
    expect(h.away.armed()).toBe(true);
    const doneId = h.lastShown().actions![0]!.id;

    h.tap(doneId);
    await settle();

    expect(h.away.armed()).toBe(true);
  });

  it('opening the workout screen cancels the timer, and brings a removed card back', async () => {
    const h = harness();
    await sync(h, makeSession());
    h.controller.setViewing(false);
    h.away.fire();
    await settle();
    h.notice.show.mockClear();

    h.controller.setViewing(true);
    await settle();

    expect(h.away.armed()).toBe(false);
    expect(h.lastShown().title).toBe('Bench Press');
  });

  it('does not run the timer for a finished workout', async () => {
    const h = harness();
    await sync(h, makeSession());
    await sync(h, makeSession({ status: 'completed' }));

    h.controller.setViewing(false);

    expect(h.away.armed()).toBe(false);
  });

  it('a Done tapped on the lock screen while away is logged without any screen', async () => {
    const h = harness();
    await sync(h, makeSession());
    h.controller.setViewing(false);
    const doneId = h.lastShown().actions![0]!.id;

    h.tap(doneId);
    await settle();

    expect(h.workout.apply).toHaveBeenCalledTimes(1);
    expect(h.controller.getRest()).toMatchObject({ totalSeconds: 90 });
    expect(h.lastShown().title).toBe('REST');
  });
});
