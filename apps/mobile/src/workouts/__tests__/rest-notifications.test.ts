// Phase 3H, slice H4 -- the rest-timer notification (ADR-026).
//
// `expo-notifications` has no JS implementation under Jest, which is exactly why this module
// takes its scheduler injected: every case below runs against a fake, and the rest screen stays
// renderable in a test. The real `defaultScheduler` is the one thing here that cannot be
// covered by Jest at all -- it is what the mandatory device walk is for.
import {
  cancelRestEndNotification,
  ensureRestNotificationPermission,
  scheduleRestEndNotification,
  type NotificationScheduler,
} from '../rest-notifications';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
}));

function fakeScheduler(overrides: Partial<NotificationScheduler> = {}): jest.Mocked<NotificationScheduler> {
  return {
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    scheduleNotificationAsync: jest.fn().mockResolvedValue('notification-1'),
    cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<NotificationScheduler>;
}

describe('permission', () => {
  it('does not prompt again once permission is already granted', async () => {
    const scheduler = fakeScheduler();

    await expect(ensureRestNotificationPermission(scheduler)).resolves.toBe(true);
    expect(scheduler.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks once when permission has not been decided yet', async () => {
    const scheduler = fakeScheduler({
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: true }),
    });

    await expect(ensureRestNotificationPermission(scheduler)).resolves.toBe(true);
    expect(scheduler.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never re-prompts a user who has already refused at the OS level', async () => {
    const scheduler = fakeScheduler({
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: false }),
    });

    await expect(ensureRestNotificationPermission(scheduler)).resolves.toBe(false);
    expect(scheduler.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('treats a permissions failure as "no", rather than throwing into the rest screen', async () => {
    const scheduler = fakeScheduler({
      getPermissionsAsync: jest.fn().mockRejectedValue(new Error('no notification manager')),
    });

    await expect(ensureRestNotificationPermission(scheduler)).resolves.toBe(false);
  });
});

describe('scheduling', () => {
  it('schedules for the end of the rest period and returns its identifier', async () => {
    const scheduler = fakeScheduler();

    await expect(scheduleRestEndNotification(90, scheduler)).resolves.toBe('notification-1');
    expect(scheduler.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Rest complete', body: 'Time for your next set.', sound: true },
      trigger: { seconds: 90 },
    });
  });

  it('schedules nothing when the athlete refused notifications', async () => {
    const scheduler = fakeScheduler({
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: false }),
    });

    await expect(scheduleRestEndNotification(90, scheduler)).resolves.toBeNull();
    expect(scheduler.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing for a rest that has already elapsed', async () => {
    const scheduler = fakeScheduler();

    await expect(scheduleRestEndNotification(0, scheduler)).resolves.toBeNull();
    // Not even a permission prompt -- there is nothing to ask for.
    expect(scheduler.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the OS refuses to schedule', async () => {
    const scheduler = fakeScheduler({
      scheduleNotificationAsync: jest.fn().mockRejectedValue(new Error('too many pending')),
    });

    await expect(scheduleRestEndNotification(90, scheduler)).resolves.toBeNull();
  });
});

describe('cancelling', () => {
  it('cancels the notification it was given', async () => {
    const scheduler = fakeScheduler();

    await cancelRestEndNotification('notification-1', scheduler);

    expect(scheduler.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
  });

  it('does nothing when there is nothing scheduled', async () => {
    const scheduler = fakeScheduler();

    await cancelRestEndNotification(null, scheduler);

    expect(scheduler.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('swallows a failure, because an already-fired notification is not recoverable', async () => {
    const scheduler = fakeScheduler({
      cancelScheduledNotificationAsync: jest.fn().mockRejectedValue(new Error('unknown identifier')),
    });

    await expect(cancelRestEndNotification('notification-1', scheduler)).resolves.toBeUndefined();
  });
});
