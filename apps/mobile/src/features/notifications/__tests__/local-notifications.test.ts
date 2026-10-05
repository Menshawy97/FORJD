import type { PlannedLocalNotification } from '@forjd/domain';

import {
  cancelLocalNotifications,
  LOCAL_NOTIFICATION_ID_PREFIX,
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
    getPermissionsAsync: jest.fn(async () => ({ granted: true })),
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

    const result = await reconcileLocalNotifications([workout, weekly], api);

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

    await reconcileLocalNotifications([workout], api);

    expect([...pending.keys()].sort()).toEqual([workout.id, 'forjd-run-live', 'some-rest-timer-id'].sort());
  });

  it('is idempotent: running it twice leaves the same notifications scheduled', async () => {
    const { api, pending } = fakeApi();

    await reconcileLocalNotifications([workout, weekly], api);
    await reconcileLocalNotifications([workout, weekly], api);

    expect([...pending.keys()].sort()).toEqual([weekly.id, workout.id].sort());
  });

  it('schedules nothing, and does not ask, when the phone has not allowed notifications, but still clears its own', async () => {
    const stale: Pending = { identifier: `${LOCAL_NOTIFICATION_ID_PREFIX}workout:2026-10-06`, content: {}, trigger: {} };
    const { api, pending } = fakeApi({ getPermissionsAsync: jest.fn(async () => ({ granted: false })) }, [stale]);

    const result = await reconcileLocalNotifications([workout], api);

    expect(result).toEqual({ scheduled: 0 });
    expect(pending.size).toBe(0);
    expect(api.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('keeps going when one notification fails to schedule', async () => {
    const { api, pending } = fakeApi();
    (api.scheduleNotificationAsync as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('boom');
    });

    const result = await reconcileLocalNotifications([workout, weekly], api);

    expect(result).toEqual({ scheduled: 1 });
    expect([...pending.keys()]).toEqual([weekly.id]);
  });

  it('never throws, even when the phone API fails outright', async () => {
    const { api } = fakeApi({
      getPermissionsAsync: jest.fn(async () => {
        throw new Error('native module missing');
      }),
    });

    await expect(reconcileLocalNotifications([workout], api)).resolves.toEqual({ scheduled: 0 });
  });

  it('runs concurrent reconciles one after the other, so a later one never cancels the earlier one half-way', async () => {
    const { api, pending } = fakeApi();

    await Promise.all([
      reconcileLocalNotifications([workout], api),
      reconcileLocalNotifications([workout, weekly], api),
    ]);

    expect([...pending.keys()].sort()).toEqual([weekly.id, workout.id].sort());
  });

  it('does not set the Android channel on iOS', async () => {
    const { api, channels } = fakeApi({ platform: 'ios' });

    await reconcileLocalNotifications([workout], api);

    expect(channels).toEqual([]);
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
  });

  it('ignores a notification that is not one of the planned FORJD ones', () => {
    expect(routeForLocalNotificationTap(tap('forjd-run-live', '/train'))).toBeNull();
  });

  it('ignores a route that is not on the list, so a notification can never send the app somewhere new', () => {
    expect(routeForLocalNotificationTap(tap(workout.id, '/delete-account'))).toBeNull();
    expect(routeForLocalNotificationTap(tap(workout.id, undefined))).toBeNull();
  });
});
