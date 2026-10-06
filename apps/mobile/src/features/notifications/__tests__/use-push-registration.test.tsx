// Phase 12F slice 4. The root layout keeps this install's push registration in step: once signed in at launch, on
// returning to the app, and when a push switch changes or the phone allows notifications. Signed out it does nothing
// (taking the token off the server needs the sign-in, so that is the log-out handler's job).
import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

const mockSync = jest.fn();
jest.mock('../push-registration', () => ({
  syncPushRegistration: (...args: unknown[]) => mockSync(...args),
}));

import { requestPushRegistrationSync, usePushRegistration } from '../use-push-registration';

describe('usePushRegistration', () => {
  let foregroundHandler: ((state: string) => void) | null = null;
  const remove = jest.fn();

  beforeEach(() => {
    mockSync.mockReset().mockResolvedValue('registered');
    remove.mockReset();
    foregroundHandler = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((event: string, handler: (state: string) => void) => {
      if (event === 'change') foregroundHandler = handler;
      return { remove };
    }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('syncs at launch once someone is signed in', async () => {
    await renderHook(() => usePushRegistration(true, true));

    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('does nothing before the sign-in check is done, or when signed out', async () => {
    await renderHook(() => usePushRegistration(false, true));
    await renderHook(() => usePushRegistration(true, false));

    expect(mockSync).not.toHaveBeenCalled();
  });

  it('syncs again when the app comes back to the front, and not when it goes to the background', async () => {
    await renderHook(() => usePushRegistration(true, true));
    mockSync.mockClear();

    foregroundHandler?.('background');
    foregroundHandler?.('active');

    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('syncs when something asks, and stops listening once it is unmounted or signed out', async () => {
    const { unmount } = await renderHook(() => usePushRegistration(true, true));
    mockSync.mockClear();

    requestPushRegistrationSync();
    expect(mockSync).toHaveBeenCalledTimes(1);

    await unmount();
    requestPushRegistrationSync();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
  });

  it('is a no-op to ask when no one is signed in', async () => {
    requestPushRegistrationSync();

    expect(mockSync).not.toHaveBeenCalled();
  });
});
