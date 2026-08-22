// Phase 4 groundwork: the root layout needs a session check to decide whether to redirect
// to /welcome. This is the minimal slice of secureStorage.ts phase 4 depends on; Phase 5
// adds saveSession/clearSession/getRefreshToken and the full conformance test (see
// auth/__tests__/secureStorage.test.ts).
//
// jest.isolateModules is used (rather than a plain top-level import + jest.resetModules) so
// the `expo-secure-store` automock instance requested inside the isolated block is the same
// instance secureStorage.ts itself resolves — a top-level `import` binds to the registry
// snapshot at file-load time, which drifts out of sync with anything reset/re-required later.
jest.mock('expo-secure-store');

describe('secureStorage - session check (Phase 4)', () => {
  it('hasSession resolves false when no access token is stored', () => {
    let hasSession: () => Promise<boolean>;

    jest.isolateModules(() => {
      const SecureStore = require('expo-secure-store');
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      ({ hasSession } = require('../secureStorage'));
    });

    return expect(hasSession!()).resolves.toBe(false);
  });

  it('hasSession resolves true when an access token is stored', () => {
    let hasSession: () => Promise<boolean>;

    jest.isolateModules(() => {
      const SecureStore = require('expo-secure-store');
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('a-real-token');
      ({ hasSession } = require('../secureStorage'));
    });

    return expect(hasSession!()).resolves.toBe(true);
  });
});
