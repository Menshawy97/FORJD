// Phase 12F slice 4. A tap on a notification opens the screen it names: FORJD's own planned local ones by their route
// (12E), and now a server push by its kind and id. The push's data is never trusted (`push-tap.test.ts` proves the
// validation); what is proven here is that the shared tap listener uses it, and that anything else opens nothing.
import { renderHook } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

const mockAddResponseListener = jest.fn();
const mockGetLastResponse = jest.fn();
jest.mock('../local-notification-plan-input', () => ({ buildLocalNotificationPlan: jest.fn() }));
jest.mock('../local-notifications', () => ({
  ...jest.requireActual('../local-notifications'),
  reconcileLocalNotifications: jest.fn().mockResolvedValue({ scheduled: 0 }),
  cancelLocalNotifications: jest.fn().mockResolvedValue(undefined),
  defaultLocalNotificationApi: {
    addResponseListener: (...args: unknown[]) => mockAddResponseListener(...args),
    getLastResponse: (...args: unknown[]) => mockGetLastResponse(...args),
  },
}));

import { useLocalNotifications } from '../use-local-notifications';

const tap = (data: unknown, identifier = 'expo-push-1') => ({
  notification: { request: { identifier, content: { data } } },
});
const SESSION = '3f2b8c1e-9d4a-4c11-8a55-0b7e6d5c4a99';

describe('useLocalNotifications taps', () => {
  let listener: ((response: unknown) => void) | null = null;

  beforeEach(() => {
    mockPush.mockReset();
    listener = null;
    mockAddResponseListener.mockReset().mockImplementation((handler: (response: unknown) => void) => {
      listener = handler;
      return { remove: jest.fn() };
    });
    mockGetLastResponse.mockReset().mockResolvedValue(null);
  });

  it('opens the session a PR push is about, and the Rank tab for a leaderboard push', async () => {
    await renderHook(() => useLocalNotifications(true, true));

    listener?.(tap({ type: 'pr', sessionId: SESSION }));
    listener?.(tap({ type: 'rank', weekStart: '2026-10-10' }));

    expect(mockPush).toHaveBeenNthCalledWith(1, `/workout/${SESSION}`);
    expect(mockPush).toHaveBeenNthCalledWith(2, '/rank');
  });

  it('still opens the screen a planned local notification names', async () => {
    await renderHook(() => useLocalNotifications(true, true));

    listener?.(tap({ route: '/progress' }, 'forjd-local:weekly:2026-10-10'));

    expect(mockPush).toHaveBeenCalledWith('/progress');
  });

  it('opens nothing for a push it does not understand, or one with a crafted id', async () => {
    await renderHook(() => useLocalNotifications(true, true));

    listener?.(tap({ type: 'pr', sessionId: '../../delete-account' }));
    listener?.(tap({ type: 'recovery' }));
    listener?.(tap(undefined));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the screen of the push that launched the app from closed, once', async () => {
    mockGetLastResponse.mockResolvedValue(tap({ type: 'rank' }));

    await renderHook(() => useLocalNotifications(true, true));
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPush).toHaveBeenCalledWith('/rank');
  });
});
