// ADR-041. The adapters must degrade, never crash, where the native module is missing (Expo Go
// does not bundle either SDK) or where Google has not been configured yet. Each case uses its own
// module registry so the adapters' lazy-load caches start clean.

describe('Google adapter without a usable SDK', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@react-native-google-signin/google-signin');
    jest.dontMock('expo-constants');
  });

  it('reports unavailable when the native module cannot be loaded (Expo Go)', async () => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: { googleWebClientId: 'web-client-id' } } },
    }));
    jest.doMock('@react-native-google-signin/google-signin', () => {
      throw new Error("TurboModuleRegistry.getEnforcing(...): 'RNGoogleSignin' could not be found.");
    });

    const { signInWithGoogle } = require('../google');

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'unavailable' });
  });

  it('reports unavailable, without loading the SDK at all, when no web client ID is configured', async () => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: { extra: { googleWebClientId: '' } } },
    }));
    const factory = jest.fn(() => ({}));
    jest.doMock('@react-native-google-signin/google-signin', factory);

    const { signInWithGoogle, isGoogleSignInConfigured } = require('../google');

    expect(isGoogleSignInConfigured()).toBe(false);
    await expect(signInWithGoogle()).resolves.toEqual({ status: 'unavailable' });
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('Apple adapter without a usable SDK', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-apple-authentication');
  });

  it('reports unavailable when the native module cannot be loaded', async () => {
    jest.doMock('expo-apple-authentication', () => {
      throw new Error('Cannot find native module ExpoAppleAuthentication');
    });

    const { signInWithApple } = require('../apple');

    await expect(signInWithApple()).resolves.toEqual({ status: 'unavailable' });
  });
});
