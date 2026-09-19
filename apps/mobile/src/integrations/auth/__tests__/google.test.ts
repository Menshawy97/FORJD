// ADR-041. The Google adapter: the only file that may touch the native Google Sign-In SDK
// (CLAUDE.md rule 4 -- integrations are isolated). The SDK is mocked at its module boundary; what
// is proven here is the adapter's own behaviour: lazy loading (so Expo Go, which has no native
// module, degrades instead of crashing), configuration, and mapping every SDK outcome to one of
// three results the rest of the app understands.
const mockConfigure = jest.fn();
const mockHasPlayServices = jest.fn();
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
  isErrorWithCode: (error: unknown) => typeof error === 'object' && error !== null && 'code' in error,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS' },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { googleWebClientId: 'web-client-id.apps.googleusercontent.com' } } },
}));

import { signInWithGoogle, isGoogleSignInConfigured } from '../google';

describe('Google adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasPlayServices.mockResolvedValue(true);
  });

  it('configures the SDK with the public web client ID before the first sign-in', async () => {
    mockSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'the-id-token' } });

    await signInWithGoogle();

    expect(mockConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: 'web-client-id.apps.googleusercontent.com' }),
    );
  });

  it('returns the ID token on success', async () => {
    mockSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'the-id-token' } });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'success', idToken: 'the-id-token' });
  });

  it('reports a person backing out as cancelled, not as a failure', async () => {
    mockSignIn.mockResolvedValue({ type: 'cancelled', data: null });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports the SDK cancel error code as cancelled too', async () => {
    mockSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
  });

  it('treats a success with no ID token as a failure the caller can report', async () => {
    mockSignIn.mockResolvedValue({ type: 'success', data: { idToken: null } });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'failed' });
  });

  it('reports any other SDK error as a failure', async () => {
    mockSignIn.mockRejectedValue(new Error('DEVELOPER_ERROR'));

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'failed' });
  });

  it('is configured only when a web client ID is present', () => {
    expect(isGoogleSignInConfigured()).toBe(true);
  });
});
