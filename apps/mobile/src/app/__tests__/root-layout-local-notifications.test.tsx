// Phase 12E-2. The root layout keeps the scheduled local notifications in step: reconcile at launch, on
// returning to the foreground and on request, clear them when no one is signed in, and open the right screen
// when one is tapped. The planner and the seam are proven on their own (`features/notifications/__tests__`);
// what is proven here is only the wiring.
import { act } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { renderApp } from './render-app';

const mockBuildPlan = jest.fn();
const mockReconcile = jest.fn();
const mockCancel = jest.fn();
const mockAddResponseListener = jest.fn();
const mockGetLastResponse = jest.fn();
const mockSync = jest.fn();

jest.mock('@/features/notifications/local-notification-plan-input', () => ({
  buildLocalNotificationPlan: (...args: unknown[]) => mockBuildPlan(...args),
}));

jest.mock('@/features/notifications/local-notifications', () => ({
  ...jest.requireActual('@/features/notifications/local-notifications'),
  reconcileLocalNotifications: (...args: unknown[]) => mockReconcile(...args),
  cancelLocalNotifications: (...args: unknown[]) => mockCancel(...args),
  defaultLocalNotificationApi: {
    addResponseListener: (...args: unknown[]) => mockAddResponseListener(...args),
    getLastResponse: (...args: unknown[]) => mockGetLastResponse(...args),
  },
}));

jest.mock('@/integrations/background/background-upload', () => ({
  registerBackgroundUpload: jest.fn().mockResolvedValue('registered'),
  unregisterBackgroundUpload: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/workouts/sync-sessions', () => ({
  syncPendingSessions: (...args: unknown[]) => mockSync(...args),
}));

jest.mock('@/auth/secureStorage', () => ({
  getAccountId: jest.fn().mockResolvedValue('account-a'),
  hasSession: jest.fn(),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(),
  consumeSessionExpired: jest.fn(() => false),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';
import { requestLocalNotificationReconcile } from '@/features/notifications/use-local-notifications';

const planned = [{ id: 'forjd-local:weekly:2026-10-10' }];
const signedIn = (value: boolean) => {
  (hasSession as jest.Mock).mockResolvedValue(value);
  (getCachedHasSession as jest.Mock).mockReturnValue(value);
};

async function waitForCalls(mock: jest.Mock, times: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (mock.mock.calls.length >= times) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(mock.mock.calls.length).toBeGreaterThanOrEqual(times);
}

describe('root layout local notifications', () => {
  beforeEach(() => {
    mockBuildPlan.mockReset().mockResolvedValue(planned);
    // Like the real seam, run the reader it is handed and report what came back.
    mockReconcile.mockReset().mockImplementation(async (readPlan: () => Promise<unknown>) => {
      await readPlan();
      return { scheduled: 1 };
    });
    mockCancel.mockReset().mockResolvedValue(undefined);
    mockAddResponseListener.mockReset().mockReturnValue({ remove: jest.fn() });
    mockGetLastResponse.mockReset().mockResolvedValue(null);
    mockSync.mockReset().mockResolvedValue({ uploaded: [], failed: [] });
  });

  it('plans and reconciles once someone is signed in', async () => {
    signedIn(true);

    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText('Home', {}, { timeout: 8000 });

    await waitForCalls(mockReconcile, 1);
    expect(mockBuildPlan).toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('clears the planned notifications when no one is signed in, and plans nothing', async () => {
    signedIn(false);

    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText(/Training\./);

    await waitForCalls(mockCancel, 1);
    expect(mockBuildPlan).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('reconciles again on request (a switch changed, a workout was finished)', async () => {
    signedIn(true);
    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText('Home', {}, { timeout: 8000 });
    await waitForCalls(mockReconcile, 1);

    requestLocalNotificationReconcile();

    await waitForCalls(mockReconcile, 2);
  });

  it('plans again once a finished workout has been uploaded', async () => {
    signedIn(true);
    mockSync.mockResolvedValue({ uploaded: ['session-1'], failed: [] });

    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText('Home', {}, { timeout: 8000 });

    // Once at launch, once more after the upload.
    await waitForCalls(mockReconcile, 2);
  });

  it('listens for taps on the notifications and checks whether one opened the app', async () => {
    signedIn(true);

    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText('Home', {}, { timeout: 8000 });

    await waitForCalls(mockAddResponseListener, 1);
    expect(mockGetLastResponse).toHaveBeenCalled();
  });

  // Last on purpose: it replaces AppState.addEventListener for its own run, which leaves the next test's
  // render with an error from the teardown.
  it('reconciles again when the app returns to the foreground', async () => {
    signedIn(true);
    // Capture every listener the layout registers for the app coming back.
    const handlers: Array<(state: string) => void> = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((event: string, handler: (state: string) => void) => {
      if (event === 'change') handlers.push(handler);
      return { remove: jest.fn() };
    }) as never);
    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText('Home', {}, { timeout: 8000 });
    await waitForCalls(mockReconcile, 1);

    // Other effects in the layout listen too (uploads, the workout notice) and their side effects are not under
    // test, so tell the listeners one at a time, newest first, and stop once the reconcile has run again.
    for (const handler of [...handlers].reverse()) {
      await act(async () => {
        handler('active');
      });
      if (mockReconcile.mock.calls.length >= 2) break;
    }

    await waitForCalls(mockReconcile, 2);
    spy.mockRestore();
  });
});
