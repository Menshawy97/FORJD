import type { PlannedLocalNotification } from '@forjd/domain';

import {
  cancelLocalNotifications,
  ensureLocalNotificationPermission,
  LOCAL_NOTIFICATION_ID_PREFIX,
  readNotificationPermission,
  reconcileLocalNotifications,
  routeForLocalNotificationTap,
  type LocalNotificationApi,
} from '../local-notifications';

// Phase 12E-2 (ADR-064). The reconciler cancels what FORJD planned before and schedules the plan again,
// behind an injected `expo-notifications` seam (ADR-026), so it is proven here with a fake that behaves like a
// phone: scheduling an identifier that already exists replaces it. Whether the OS then *delivers* is the
// device walk's job (ADR-026), not Jest's.

interface Pending {
  identifier: string;
  content: { title?: string | null; body?: string | null; data?: Record<string, unknown> };
  trigger: { type?: string; date?: Date | number; channelId?: string };
}

function fakeApi(overrides: Partial<LocalNotificationApi> = {}, initial: Pending[] = []) {
  const pending = new Map<string, Pending>(initial.map((entry) => [entry.identifier, entry]));
  const channels: string[] = [];
  const api: LocalNotificationApi = {
    platform: 'android',
    getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setNotificationChannelAsync: jest.fn(async (id: string) => {
      channels.push(id);
    }),
    getAllScheduledNotificationsAsync: jest.fn(async () => [...pending.values()].map((entry) => ({ identifier: entry.identifier }))),
    scheduleNotificationAsync: jest.fn(async (input) => {
      const identifier = input.identifier ?? 'generated';
      pending.set(identifier, { identifier, content: input.content, trigger: input.trigger as Pending['trigger'] });
      return identifier;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (identifier: string) => {
      pending.delete(identifier);
    }),
    installForegroundHandler: jest.fn(),
    addResponseListener: jest.fn(() => ({ remove: jest.fn() })),
    getLastResponse: jest.fn(async () => null),
    ...overrides,
  };
  return { api, pending, channels };
}

const planOf = (plan: PlannedLocalNotification[] | null) => async () => plan;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const workout: PlannedLocalNotification = {
  id: 'forjd-local:workout:2026-10-07',
  kind: 'workout',
  date: '2026-10-07',
  minute: 17 * 60 + 30,
  title: 'Workout in 30 minutes',
  body: 'You usually start around 18:00.',
  route: '/train',
};
const weekly: PlannedLocalNotification = {
  id: 'forjd-local:weekly:2026-10-10',
  kind: 'weekly',
  date: '2026-10-10',
  minute: 9 * 60,
  title: 'Your week is ready',
  body: 'See how it went.',
  route: '/progress',
};

describe('reconcileLocalNotifications', () => {
  it('schedules each planned notification at its local date and time, on the Reminders channel', async () => {
    const { api, pending, channels } = fakeApi();

    const result = await reconcileLocalNotifications(planOf([workout, weekly]), api);

    expect(result).toEqual({ scheduled: 2 });
    expect(channels).toEqual(['reminders']);
    const first = pending.get(workout.id)!;
    expect(first.content).toMatchObject({ title: workout.title, body: workout.body, data: { route: '/train' } });
    expect(first.trigger.type).toBe('date');
    expect(first.trigger.channelId).toBe('reminders');
    // Built from the local calendar parts, so 17:30 stays 17:30 whatever the process zone.
    const when = first.trigger.date as Date;
    expect([when.getFullYear(), when.getMonth() + 1, when.getDate(), when.getHours(), when.getMinutes()]).toEqual([
      2026, 10, 7, 17, 30,
    ]);
  });

  it('cancels what it scheduled before and leaves every other notification alone', async () => {
    const stale: Pending = {
      identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`,
      content: {},
      trigger: {},
    };
    const runNotice: Pending = { identifier: 'forjd-run-live', content: {}, trigger: {} };
    const rest: Pending = { identifier: 'some-rest-timer-id', content: {}, trigger: {} };
    const { api, pending } = fakeApi({}, [stale, runNotice, rest]);

    await reconcileLocalNotifications(planOf([workout]), api);

    expect([...pending.keys()].sort()).toEqual([workout.id, 'forjd-run-live', 'some-rest-timer-id'].sort());
  });

  it('is idempotent: running it twice leaves the same notifications scheduled', async () => {
    const { api, pending } = fakeApi();

    await reconcileLocalNotifications(planOf([workout, weekly]), api);
    await reconcileLocalNotifications(planOf([workout, weekly]), api);

    expect([...pending.keys()].sort()).toEqual([weekly.id, workout.id].sort());
  });

  it('schedules nothing, and does not ask, when the phone has not allowed notifications, but still clears its own', async () => {
    const stale: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`, content: {}, trigger: {} };
    const { api, pending } = fakeApi({ getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })) }, [stale]);

    const result = await reconcileLocalNotifications(planOf([workout]), api);

    expect(result).toEqual({ scheduled: 0 });
    expect(pending.size).toBe(0);
    expect(api.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('keeps going when one notification fails to schedule', async () => {
    const { api, pending } = fakeApi();
    (api.scheduleNotificationAsync as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const result = await reconcileLocalNotifications(planOf([workout, weekly]), api);

    expect(result).toEqual({ scheduled: 1 });
    expect([...pending.keys()]).toEqual([weekly.id]);
  });

  it('never throws, even when the phone API fails outright', async () => {
    const { api } = fakeApi({
      getPermissionsAsync: jest.fn(async () => {
        throw new Error('native module missing');
      }),
    });

    await expect(reconcileLocalNotifications(planOf([workout]), api)).resolves.toEqual({ scheduled: 0 });
  });

  it('runs concurrent reconciles one after the other, so a later one never cancels the earlier one half-way', async () => {
    const { api, pending } = fakeApi();

    await Promise.all([
      reconcileLocalNotifications(planOf([workout]), api),
      reconcileLocalNotifications(planOf([workout, weekly]), api),
    ]);

    expect([...pending.keys()].sort()).toEqual([weekly.id, workout.id].sort());
  });

  it('does not set the Android channel on iOS', async () => {
    const { api, channels } = fakeApi({ platform: 'ios' });

    await reconcileLocalNotifications(planOf([workout]), api);

    expect(channels).toEqual([]);
  });
});

describe('reconcile ordering and safety', () => {
  const letItRun = () => new Promise((resolve) => setImmediate(resolve));

  it('applies plans in the order they were asked, so a slow older read cannot overwrite a newer plan', async () => {
    const { api, pending } = fakeApi();
    const slow = deferred<PlannedLocalNotification[] | null>();

    const older = reconcileLocalNotifications(() => slow.promise, api);
    await letItRun();
    const newer = reconcileLocalNotifications(planOf([weekly]), api);
    slow.resolve([workout]);
    await Promise.all([older, newer]);

    // The newer request was asked last, so what it planned is what the phone ends up with.
    expect([...pending.keys()]).toEqual([weekly.id]);
  });

  it('does not even build a plan that a newer request has already superseded', async () => {
    const { api } = fakeApi();
    const blocker = deferred<PlannedLocalNotification[] | null>();
    const skipped = jest.fn(async () => [workout]);

    const first = reconcileLocalNotifications(() => blocker.promise, api);
    await letItRun();
    const second = reconcileLocalNotifications(skipped, api);
    const third = reconcileLocalNotifications(planOf([weekly]), api);
    blocker.resolve([]);
    await Promise.all([first, second, third]);

    expect(skipped).not.toHaveBeenCalled();
  });

  it('never schedules after a cancel that was asked later (signing out while a plan is being read)', async () => {
    const { api, pending } = fakeApi();
    const slow = deferred<PlannedLocalNotification[] | null>();

    const reconcile = reconcileLocalNotifications(() => slow.promise, api);
    await letItRun();
    const cancel = cancelLocalNotifications(api);
    slow.resolve([workout, weekly]);
    await Promise.all([reconcile, cancel]);

    expect(pending.size).toBe(0);
  });

  it('skips a reconcile queued before a cancel, so it cannot re-schedule after sign-out', async () => {
    const { api, pending } = fakeApi();
    const blocker = deferred<PlannedLocalNotification[] | null>();
    const queued = jest.fn(async () => [workout]);

    const first = reconcileLocalNotifications(() => blocker.promise, api);
    await letItRun();
    const second = reconcileLocalNotifications(queued, api);
    const cancel = cancelLocalNotifications(api);
    blocker.resolve(null);
    await Promise.all([first, second, cancel]);

    expect(queued).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });

  it('leaves the schedule exactly as it was when the plan could not be built (null)', async () => {
    const old: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`, content: {}, trigger: {} };
    const { api, pending } = fakeApi({}, [old]);

    const result = await reconcileLocalNotifications(planOf(null), api);

    expect(result).toEqual({ scheduled: 0 });
    expect([...pending.keys()]).toEqual([old.identifier]);
  });

  it('schedules the new plan before cancelling stale ones, so a failure part-way never leaves it with nothing', async () => {
    const stale: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`, content: {}, trigger: {} };
    const { api, pending } = fakeApi({}, [stale]);
    (api.scheduleNotificationAsync as jest.Mock).mockImplementation(async () => {
      throw new Error('scheduler down');
    });

    await reconcileLocalNotifications(planOf([workout]), api);

    // Nothing could be scheduled, so the earlier reminder stays rather than being wiped.
    expect(pending.has(stale.identifier)).toBe(true);
  });

  it('keeps an already-scheduled reminder that is still in the plan, and drops one that is not', async () => {
    const stillWanted: Pending = { identifier: workout.id, content: {}, trigger: {} };
    const noLonger: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`, content: {}, trigger: {} };
    const { api, pending } = fakeApi({}, [stillWanted, noLonger]);

    await reconcileLocalNotifications(planOf([workout]), api);

    expect([...pending.keys()]).toEqual([workout.id]);
  });

  it('keeps cancelling when one cancel fails', async () => {
    const a: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`, content: {}, trigger: {} };
    const b: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-08`, content: {}, trigger: {} };
    const { api, pending } = fakeApi({}, [a, b]);
    (api.cancelScheduledNotificationAsync as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('already gone');
    });

    await cancelLocalNotifications(api);

    expect([...pending.keys()]).toEqual([a.identifier]);
  });
});

describe('cancelLocalNotifications', () => {
  it('cancels every FORJD-planned notification and nothing else (signing out)', async () => {
    const mine: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}weekly:2026-10-10`, content: {}, trigger: {} };
    const other: Pending = { identifier: 'forjd-run-live', content: {}, trigger: {} };
    const { api, pending } = fakeApi({}, [mine, other]);

    await cancelLocalNotifications(api);

    expect([...pending.keys()]).toEqual(['forjd-run-live']);
  });

  it('never throws', async () => {
    const { api } = fakeApi({
      getAllScheduledNotificationsAsync: jest.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(cancelLocalNotifications(api)).resolves.toBeUndefined();
  });
});

describe('routeForLocalNotificationTap', () => {
  const tap = (identifier: string, route: unknown) => ({
    notification: { request: { identifier, content: { data: { route } } } },
  });

  it('opens the screen a FORJD reminder names', () => {
    expect(routeForLocalNotificationTap(tap(workout.id, '/train'))).toBe('/train');
    expect(routeForLocalNotificationTap(tap(weekly.id, '/progress'))).toBe('/progress');
    expect(routeForLocalNotificationTap(tap('forjd-local:meals:2026-10-07', '/nutrition'))).toBe('/nutrition');
  });

  it('ignores a notification that is not one of the planned FORJD ones', () => {
    expect(routeForLocalNotificationTap(tap('forjd-run-live', '/train'))).toBeNull();
  });

  it('ignores a route that is not on the list, so a notification can never send the app somewhere new', () => {
    expect(routeForLocalNotificationTap(tap(workout.id, '/delete-account'))).toBeNull();
    expect(routeForLocalNotificationTap(tap(workout.id, undefined))).toBeNull();
  });
});

describe('notification permission (12E-4)', () => {
  const answering = (granted: boolean, canAskAgain: boolean) =>
    fakeApi({ getPermissionsAsync: jest.fn(async () => ({ granted, canAskAgain })) }).api;

  it('reads allowed, not yet asked, and refused apart, so the screen can show its note only for a refusal', async () => {
    await expect(readNotificationPermission(answering(true, true))).resolves.toBe('granted');
    await expect(readNotificationPermission(answering(false, true))).resolves.toBe('undetermined');
    await expect(readNotificationPermission(answering(false, false))).resolves.toBe('denied');
  });

  it('treats a permission read that fails as not asked, never as an error', async () => {
    const api = fakeApi({
      getPermissionsAsync: jest.fn(async () => {
        throw new Error('native module missing');
      }),
    }).api;

    await expect(readNotificationPermission(api)).resolves.toBe('undetermined');
  });

  it('does not ask again when the phone already allows notifications', async () => {
    const api = answering(true, true);

    await expect(ensureLocalNotificationPermission(api)).resolves.toBe(true);

    expect(api.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks once while it is still undecided, and answers what the person chose', async () => {
    const api = fakeApi({
      getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
      requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
    }).api;

    await expect(ensureLocalNotificationPermission(api)).resolves.toBe(false);

    expect(api.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not ask after a refusal the phone will not let it repeat', async () => {
    const api = answering(false, false);

    await expect(ensureLocalNotificationPermission(api)).resolves.toBe(false);

    expect(api.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const api = fakeApi({
      getPermissionsAsync: jest.fn(async () => {
        throw new Error('boom');
      }),
    }).api;

    await expect(ensureLocalNotificationPermission(api)).resolves.toBe(false);
  });

  // Android 13 and later show the permission dialog only once a notification channel exists, so the channel is
  // made before the first ask. Without it the dialog never appears and the person looks like a refusal.
  it('creates the Reminders channel before asking on Android', async () => {
    const order: string[] = [];
    const { api } = fakeApi({
      getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
      setNotificationChannelAsync: jest.fn(async () => {
        order.push('channel');
      }),
      requestPermissionsAsync: jest.fn(async () => {
        order.push('request');
        return { granted: true };
      }),
    });

    await ensureLocalNotificationPermission(api);

    expect(order).toEqual(['channel', 'request']);
  });

  it('does not touch channels on iOS', async () => {
    const { api } = fakeApi({
      platform: 'ios',
      getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
    });

    await ensureLocalNotificationPermission(api);

    expect(api.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(api.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('still asks when the channel cannot be created', async () => {
    const { api } = fakeApi({
      getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
      setNotificationChannelAsync: jest.fn(async () => {
        throw new Error('no channel');
      }),
    });

    await expect(ensureLocalNotificationPermission(api)).resolves.toBe(true);
  });
});
