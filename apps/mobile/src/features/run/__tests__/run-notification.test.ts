// 12A-3. The live run notice on Android (approved replica v2, 2026-10-03), through an injected slice of
// expo-notifications so no native module is needed: a quiet channel, one ongoing notice updated in
// place, Pause/Resume acting without opening the app and Finish opening it, nothing left after the run.
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), AndroidImportance: { LOW: 4 } }));

import {
  RUN_NOTIFICATION_ID,
  createRunNotifier,
  dismissStaleRunNotice,
  foregroundPresentation,
  type RunNotificationApi,
} from '../run-notification';

const content = { header: 'Run', title: '24:31 · 4.82 km', body: 'Avg pace 5:05 /km', category: 'run-running' as const };

function fakeApi(over: Partial<RunNotificationApi> = {}) {
  let responseListener: ((response: { actionIdentifier: string; notification: { request: { identifier: string } } }) => void) | null = null;
  const api: RunNotificationApi = {
    platform: 'android',
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
    scheduleNotificationAsync: jest.fn().mockResolvedValue(RUN_NOTIFICATION_ID),
    dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
    addNotificationResponseReceivedListener: jest.fn((listener) => {
      responseListener = listener;
      return { remove: jest.fn() };
    }),
    ...over,
  };
  const tap = (actionIdentifier: string, identifier = RUN_NOTIFICATION_ID) =>
    responseListener?.({ actionIdentifier, notification: { request: { identifier } } });
  return { api, tap };
}

describe('run notifier (12A-3)', () => {
  it('sets up a quiet channel and the two action sets once ready', async () => {
    const { api } = fakeApi();

    await expect(createRunNotifier(api).ensureReady()).resolves.toBe(true);

    expect(api.setNotificationChannelAsync).toHaveBeenCalledWith('run-live', expect.objectContaining({ importance: 4, sound: null, enableVibrate: false }));
    expect(api.setNotificationCategoryAsync).toHaveBeenCalledWith('run-running', [
      { identifier: 'pause', buttonTitle: 'Pause', options: { opensAppToForeground: false } },
      { identifier: 'finish', buttonTitle: 'Finish', options: { opensAppToForeground: true } },
    ]);
    expect(api.setNotificationCategoryAsync).toHaveBeenCalledWith('run-paused', [
      { identifier: 'resume', buttonTitle: 'Resume', options: { opensAppToForeground: false } },
      { identifier: 'finish', buttonTitle: 'Finish', options: { opensAppToForeground: true } },
    ]);
  });

  it('asks for notification permission only when undecided, and works without it', async () => {
    const { api } = fakeApi({
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: true }),
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
    });

    await expect(createRunNotifier(api).ensureReady()).resolves.toBe(false);

    expect(api.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never asks again once refused', async () => {
    const { api } = fakeApi({ getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: false }) });

    await createRunNotifier(api).ensureReady();

    expect(api.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('shows one ongoing notice, in place, with the approved text and the FORJD header', async () => {
    const { api } = fakeApi();
    const notifier = createRunNotifier(api);
    await notifier.ensureReady();

    await notifier.show(content);

    expect(api.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: RUN_NOTIFICATION_ID,
      content: {
        title: '24:31 · 4.82 km',
        body: 'Avg pace 5:05 /km',
        subtitle: 'Run',
        categoryIdentifier: 'run-running',
        sticky: true,
        autoDismiss: false,
        color: '#E9712F',
        priority: 'low',
        data: { forjdOngoing: true },
      },
      trigger: { channelId: 'run-live' },
    });
  });

  it('shows nothing without permission, and nothing on iPhone (a Live Activity there, Phase 11)', async () => {
    const refused = fakeApi({ getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: false }) });
    const iphone = fakeApi({ platform: 'ios' });

    for (const { api } of [refused, iphone]) {
      const notifier = createRunNotifier(api);
      await notifier.ensureReady();
      await notifier.show(content);
      expect(api.scheduleNotificationAsync).not.toHaveBeenCalled();
    }
  });

  it('routes Pause, Resume and Finish to the run, and ignores other notifications and a plain tap', async () => {
    const { api, tap } = fakeApi();
    const notifier = createRunNotifier(api);
    await notifier.ensureReady();
    const handler = jest.fn();
    notifier.onAction(handler);

    tap('pause');
    tap('resume');
    tap('finish');
    tap('pause', 'rest-ends');
    tap('expo.modules.notifications.actions.DEFAULT');

    expect(handler.mock.calls).toEqual([['pause'], ['resume'], ['finish']]);
  });

  it('a refresh still in flight when the notice is cleared does not bring it back', async () => {
    let finishSchedule: () => void = () => undefined;
    const { api } = fakeApi({
      scheduleNotificationAsync: jest.fn(
        () => new Promise<string>((resolve) => (finishSchedule = () => resolve(RUN_NOTIFICATION_ID))),
      ),
    });
    const notifier = createRunNotifier(api);
    await notifier.ensureReady();

    const showing = notifier.show(content);
    await notifier.clear();
    finishSchedule();
    await showing;

    expect(api.dismissNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('shows nothing after it is cleared, until made ready again for the next run', async () => {
    const { api } = fakeApi();
    const notifier = createRunNotifier(api);
    await notifier.ensureReady();
    await notifier.clear();

    await notifier.show(content);

    expect(api.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('removes the notice', async () => {
    const { api } = fakeApi();
    const notifier = createRunNotifier(api);

    await notifier.clear();

    expect(api.dismissNotificationAsync).toHaveBeenCalledWith(RUN_NOTIFICATION_ID);
  });

  it('never throws into the run', async () => {
    const { api } = fakeApi({
      setNotificationChannelAsync: jest.fn().mockRejectedValue(new Error('boom')),
      scheduleNotificationAsync: jest.fn().mockRejectedValue(new Error('boom')),
      dismissNotificationAsync: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const notifier = createRunNotifier(api);

    await expect(notifier.ensureReady()).resolves.toBe(false);
    await expect(notifier.show(content)).resolves.toBeUndefined();
    await expect(notifier.clear()).resolves.toBeUndefined();
  });
});

describe('foregroundPresentation', () => {
  it('keeps the ongoing run notice silent and out of the banner while the app is open', () => {
    expect(foregroundPresentation({ forjdOngoing: true })).toEqual({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: true,
    });
  });

  it('still shows and sounds every other notification, such as rest complete', () => {
    expect(foregroundPresentation({})).toEqual({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    });
  });
});

// Emulator walk finding 12: a run notice is sticky, so when the app was killed mid-run it stayed in the status bar,
// its Pause and Finish doing nothing, next to the next run's. At app start no run is live yet (a run picked back up
// posts its own), so a leftover one is taken down.
describe('dismissStaleRunNotice', () => {
  it('takes down a run notice left by an app that was closed mid-run', async () => {
    const { api } = fakeApi();

    await dismissStaleRunNotice(api);

    expect(api.dismissNotificationAsync).toHaveBeenCalledWith(RUN_NOTIFICATION_ID);
  });

  it('never throws when there is nothing to take down', async () => {
    const { api } = fakeApi({ dismissNotificationAsync: jest.fn().mockRejectedValue(new Error('none')) });

    await expect(dismissStaleRunNotice(api)).resolves.toBeUndefined();
  });

  it('leaves a running notifier able to post afterwards', async () => {
    const { api } = fakeApi();
    const notifier = createRunNotifier(api);
    await notifier.ensureReady();

    await dismissStaleRunNotice(api);
    await notifier.show(content);

    expect(api.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
