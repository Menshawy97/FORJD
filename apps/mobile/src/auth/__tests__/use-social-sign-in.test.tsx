// ADR-041. The orchestration behind the two buttons: adapter -> POST /auth/social -> saved
// session -> into the app. The adapters and the API are mocked at their boundaries.
import { act, renderHook } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    canDismiss: () => true,
    dismissAll: () => mockDismissAll(),
  },
}));

const mockExtra: Record<string, unknown> = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

jest.mock('@/auth/apiClient', () => ({ socialSignIn: jest.fn() }));
jest.mock('@/auth/secureStorage', () => ({ saveSession: jest.fn() }));
jest.mock('@/integrations/auth/google', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('@/integrations/auth/apple', () => ({ signInWithApple: jest.fn() }));

import { AxiosError } from 'axios';
import { socialSignIn } from '@/auth/apiClient';
import { saveSession } from '@/auth/secureStorage';
import { signInWithApple } from '@/integrations/auth/apple';
import { signInWithGoogle } from '@/integrations/auth/google';

import { useSocialSignIn } from '../use-social-sign-in';

const SESSION = { accessToken: 'a', refreshToken: 'r', expiresAt: '2026-01-01T00:00:00.000Z', isNewUser: true };

describe('useSocialSignIn', () => {
  const toast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    delete mockExtra.appleSignInEnabled;
    (socialSignIn as jest.Mock).mockResolvedValue(SESSION);
    (saveSession as jest.Mock).mockResolvedValue(undefined);
  });

  it('signs in with Google: exchanges the token, saves the session and enters the app', async () => {
    (signInWithGoogle as jest.Mock).mockResolvedValue({ status: 'success', idToken: 'google-id-token-123456' });
    const { result } = await renderHook(() => useSocialSignIn(toast));

    await act(async () => {
      await result.current.google();
    });

    expect(socialSignIn).toHaveBeenCalledWith({ provider: 'google', idToken: 'google-id-token-123456' });
    expect(saveSession).toHaveBeenCalledWith(SESSION);
    expect(mockDismissAll).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('does nothing when the person backs out of the Google sheet', async () => {
    (signInWithGoogle as jest.Mock).mockResolvedValue({ status: 'cancelled' });
    const { result } = await renderHook(() => useSocialSignIn(toast));

    await act(async () => {
      await result.current.google();
    });

    expect(socialSignIn).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('says the app build is needed where the native module is missing (Expo Go)', async () => {
    (signInWithGoogle as jest.Mock).mockResolvedValue({ status: 'unavailable' });
    const { result } = await renderHook(() => useSocialSignIn(toast));

    await act(async () => {
      await result.current.google();
    });

    expect(toast).toHaveBeenCalledWith('Google sign-in needs the FORJD app build. It is not available in Expo Go.');
    expect(socialSignIn).not.toHaveBeenCalled();
  });

  it('reports a failed Google sheet without touching the server', async () => {
    (signInWithGoogle as jest.Mock).mockResolvedValue({ status: 'failed' });
    const { result } = await renderHook(() => useSocialSignIn(toast));

    await act(async () => {
      await result.current.google();
    });

    expect(toast).toHaveBeenCalledWith('Could not sign in with Google. Please try again.');
    expect(socialSignIn).not.toHaveBeenCalled();
  });

  it('says so, and stays signed out, when the server rejects the token', async () => {
    (signInWithGoogle as jest.Mock).mockResolvedValue({ status: 'success', idToken: 'google-id-token-123456' });
    (socialSignIn as jest.Mock).mockRejectedValue(
      new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, { status: 401 } as never),
    );
    const { result } = await renderHook(() => useSocialSignIn(toast));

    await act(async () => {
      await result.current.google();
    });

    expect(toast).toHaveBeenCalledWith('Could not sign in with Google. Please try again.');
    expect(saveSession).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('reports a connection problem, not a rejected account, when the server cannot be reached', async () => {
    (signInWithGoogle as jest.Mock).mockResolvedValue({ status: 'success', idToken: 'google-id-token-123456' });
    (socialSignIn as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));
    const { result } = await renderHook(() => useSocialSignIn(toast));

    await act(async () => {
      await result.current.google();
    });

    expect(toast).toHaveBeenCalledWith('Cannot reach FORJD. Check your connection and try again.');
  });

  it('keeps Apple as "coming soon" until it is switched on, and never opens the sheet', async () => {
    const { result } = await renderHook(() => useSocialSignIn(toast));

    expect(result.current.appleEnabled).toBe(false);
    await act(async () => {
      await result.current.apple();
    });

    expect(toast).toHaveBeenCalledWith('Apple sign-in is coming soon.');
    expect(signInWithApple).not.toHaveBeenCalled();
  });

  it('signs in with Apple, sending the nonce, once it is switched on', async () => {
    mockExtra.appleSignInEnabled = true;
    (signInWithApple as jest.Mock).mockResolvedValue({ status: 'success', idToken: 'apple-id-token-123456', nonce: 'raw-nonce-1234' });
    const { result } = await renderHook(() => useSocialSignIn(toast));

    expect(result.current.appleEnabled).toBe(true);
    await act(async () => {
      await result.current.apple();
    });

    expect(socialSignIn).toHaveBeenCalledWith({
      provider: 'apple',
      idToken: 'apple-id-token-123456',
      nonce: 'raw-nonce-1234',
    });
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('ignores a second tap while one sign-in is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    (signInWithGoogle as jest.Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = await renderHook(() => useSocialSignIn(toast));

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.google();
      await result.current.google();
    });
    release({ status: 'cancelled' });
    await act(async () => {
      await first;
    });

    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });
});
