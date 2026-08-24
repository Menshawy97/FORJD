// Phase 5 RED: the three(+one)-axios-client pattern ported from ADR-011's Dio design —
// public / refresh-only / authenticated-with-interceptor, plus an interceptor-free replay
// client. axios itself is mocked (no real network); `axios.create()` is replaced with a
// factory that hands back a fresh recording instance each call, so the test can inspect
// which instance got which interceptors and which instance received the refresh POST.
jest.mock('axios', () => {
  const instances: Array<{
    interceptors: {
      request: { handlers: unknown[]; use: (fn: unknown) => void };
      response: {
        handlers: Array<{ onFulfilled: unknown; onRejected: unknown }>;
        use: (onFulfilled: unknown, onRejected: unknown) => void;
      };
    };
    post: jest.Mock;
    get: jest.Mock;
    patch: jest.Mock;
    request: jest.Mock;
    defaults: { baseURL: string };
  }> = [];

  const createInstance = () => {
    const instance = {
      interceptors: {
        request: {
          handlers: [] as unknown[],
          use(fn: unknown) {
            instance.interceptors.request.handlers.push(fn);
          },
        },
        response: {
          handlers: [] as Array<{ onFulfilled: unknown; onRejected: unknown }>,
          use(onFulfilled: unknown, onRejected: unknown) {
            instance.interceptors.response.handlers.push({ onFulfilled, onRejected });
          },
        },
      },
      post: jest.fn(),
      get: jest.fn(),
      patch: jest.fn(),
      request: jest.fn(),
      defaults: { baseURL: 'http://test.local/api/v1' },
    };
    instances.push(instance);
    return instance;
  };

  const axiosMock = jest.fn(createInstance) as jest.Mock & {
    create: jest.Mock;
    __instances: typeof instances;
  };
  axiosMock.create = jest.fn(createInstance);
  axiosMock.__instances = instances;
  return { __esModule: true, default: axiosMock };
});

jest.mock('../secureStorage', () => ({
  getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

import axios from 'axios';

import * as secureStorage from '../secureStorage';

// The mocked axios.create() above returns a plain recording object shaped nothing like the
// real AxiosInstance type apiClient.ts imports — this local type describes what the mock
// actually looks like, so tests can inspect .interceptors.*.handlers / mock.calls without
// fighting the real axios types on every access.
interface MockAxiosInstance {
  interceptors: {
    request: {
      handlers: unknown[];
      use: jest.Mock;
    };
    response: {
      handlers: Array<{ onFulfilled: unknown; onRejected: unknown }>;
      use: jest.Mock;
    };
  };
  post: jest.Mock;
  request: jest.Mock;
  defaults: { baseURL: string };
}

function asMock(instance: unknown): MockAxiosInstance {
  return instance as MockAxiosInstance;
}

// Re-imported fresh per test via isolateModules so the module-level `inFlightRefresh`
// singleton and the axios.create() call count both start clean.
function loadApiClient() {
  let mod: typeof import('../apiClient');
  jest.isolateModules(() => {
    mod = require('../apiClient');
  });
  return mod!;
}

describe('apiClient - three(+one)-client construction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios as unknown as { __instances: unknown[] }).__instances.length = 0;
  });

  it('creates a public client with no interceptors', () => {
    const { publicClient } = loadApiClient();
    const mock = asMock(publicClient);
    expect(mock.interceptors.request.handlers).toHaveLength(0);
    expect(mock.interceptors.response.handlers).toHaveLength(0);
  });

  it('creates a refresh-only client with no interceptors', () => {
    const { refreshClient } = loadApiClient();
    const mock = asMock(refreshClient);
    expect(mock.interceptors.request.handlers).toHaveLength(0);
    expect(mock.interceptors.response.handlers).toHaveLength(0);
  });

  it('creates the authenticated client with a request and a response interceptor', () => {
    const { apiClient } = loadApiClient();
    const mock = asMock(apiClient);
    expect(mock.interceptors.request.handlers.length).toBeGreaterThan(0);
    expect(mock.interceptors.response.handlers.length).toBeGreaterThan(0);
  });

  it('never reads or writes tokens through anything but the secureStorage wrapper', () => {
    // Static guarantee: this module has no AsyncStorage import at all — asserted by
    // checking the module source never references it (mirrors the pattern used for the
    // expo-secure-store conformance check).
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../apiClient.ts'), 'utf8');
    expect(source).not.toMatch(/AsyncStorage/);
  });
});

describe('apiClient - authenticated request signing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios as unknown as { __instances: unknown[] }).__instances.length = 0;
  });

  it('attaches the access token from secureStorage on every request', async () => {
    (secureStorage.getAccessToken as jest.Mock).mockResolvedValue('token-abc');
    const { apiClient } = loadApiClient();

    const requestInterceptor = asMock(apiClient).interceptors.request.handlers[0] as (
      config: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    const result = await requestInterceptor({ headers: {} });

    expect((result.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
  });
});

describe('apiClient - in-flight refresh dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios as unknown as { __instances: unknown[] }).__instances.length = 0;
  });

  it('two concurrent 401s trigger exactly one refresh call, and both requests retry with the new token', async () => {
    (secureStorage.getRefreshToken as jest.Mock).mockResolvedValue('refresh-abc');
    (secureStorage.saveSession as jest.Mock).mockResolvedValue(undefined);

    const { apiClient } = loadApiClient();
    const instances = (axios as unknown as { __instances: Array<Record<string, unknown>> })
      .__instances;
    // Construction order in apiClient.ts: public, refresh, api, replay.
    const refreshInstance = instances[1] as { post: jest.Mock };
    const replayInstance = instances[3] as { request: jest.Mock };

    refreshInstance.post.mockResolvedValue({
      data: { accessToken: 'new-token', refreshToken: 'refresh-def', expiresAt: 'x' },
    });
    replayInstance.request.mockResolvedValue({ data: 'ok' });

    const onRejected = asMock(apiClient).interceptors.response.handlers[0].onRejected as (
      error: unknown,
    ) => Promise<unknown>;

    const config1 = { url: '/one', headers: {} };
    const config2 = { url: '/two', headers: {} };
    const error1 = { response: { status: 401 }, config: config1 };
    const error2 = { response: { status: 401 }, config: config2 };

    const [result1, result2] = await Promise.all([onRejected(error1), onRejected(error2)]);

    expect(refreshInstance.post).toHaveBeenCalledTimes(1);
    expect(refreshInstance.post).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: 'refresh-abc',
    });

    expect(replayInstance.request).toHaveBeenCalledTimes(2);
    for (const call of replayInstance.request.mock.calls) {
      expect((call[0].headers as Record<string, string>).Authorization).toBe(
        'Bearer new-token',
      );
    }
    expect(result1).toEqual({ data: 'ok' });
    expect(result2).toEqual({ data: 'ok' });
  });
});

// ADR-011: "A failed refresh clears the store, reports the loss, and propagates the
// *original* error." Note which half of that sentence is conditional — the clear is tied to
// the *refresh* failing, not to the retry path failing in general. A replay that fails for
// its own reasons (offline, 500, timeout) leaves a valid, just-refreshed session behind, and
// wiping it would sign the user out over a dropped packet.
describe('apiClient - what a failure on the retry path is allowed to destroy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios as unknown as { __instances: unknown[] }).__instances.length = 0;
  });

  function loadWithInstances() {
    const mod = loadApiClient();
    const instances = (axios as unknown as { __instances: Array<Record<string, unknown>> })
      .__instances;
    return {
      apiClient: mod.apiClient,
      // Construction order in apiClient.ts: public, refresh, api, replay.
      refreshInstance: instances[1] as unknown as { post: jest.Mock },
      replayInstance: instances[3] as unknown as { request: jest.Mock },
      onRejected: asMock(mod.apiClient).interceptors.response.handlers[0].onRejected as (
        error: unknown,
      ) => Promise<unknown>,
    };
  }

  it('clears the session and propagates the original error when the refresh itself fails', async () => {
    (secureStorage.getRefreshToken as jest.Mock).mockResolvedValue('refresh-abc');
    (secureStorage.clearSession as jest.Mock).mockResolvedValue(undefined);

    const { refreshInstance, replayInstance, onRejected } = loadWithInstances();
    refreshInstance.post.mockRejectedValue({ response: { status: 401 } });

    const originalError = { response: { status: 401 }, config: { url: '/me', headers: {} } };

    await expect(onRejected(originalError)).rejects.toBe(originalError);

    expect(secureStorage.clearSession).toHaveBeenCalledTimes(1);
    // The replay never happened — there was no new token to replay with.
    expect(replayInstance.request).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh succeeds but the replay fails', async () => {
    (secureStorage.getRefreshToken as jest.Mock).mockResolvedValue('refresh-abc');
    (secureStorage.saveSession as jest.Mock).mockResolvedValue(undefined);
    (secureStorage.clearSession as jest.Mock).mockResolvedValue(undefined);

    const { refreshInstance, replayInstance, onRejected } = loadWithInstances();
    refreshInstance.post.mockResolvedValue({
      data: { accessToken: 'new-token', refreshToken: 'refresh-def', expiresAt: 'x' },
    });
    // A network drop on the retry — nothing whatsoever to do with the credentials, which
    // were just successfully renewed one line above.
    const replayError = Object.assign(new Error('Network Error'), { code: 'ECONNABORTED' });
    replayInstance.request.mockRejectedValue(replayError);

    const originalError = { response: { status: 401 }, config: { url: '/me', headers: {} } };

    const rejection = await onRejected(originalError).catch((e: unknown) => e);

    // The whole point, asserted before the error-identity check so a RED run names the
    // actual defect rather than a symptom of it: a just-refreshed session survives a
    // failed replay.
    expect(secureStorage.clearSession).not.toHaveBeenCalled();
    expect(secureStorage.saveSession).toHaveBeenCalledTimes(1);
    expect(rejection).toBe(replayError);
  });
});

// Phase G: profile reads and writes both go through `apiClient` (not `publicClient`) so the
// bearer token and the 401-refresh-retry both apply automatically — neither function needs
// its own auth handling.
describe('apiClient - profile reads and writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios as unknown as { __instances: unknown[] }).__instances.length = 0;
  });

  function apiClientInstance() {
    const instances = (axios as unknown as { __instances: Array<Record<string, unknown>> })
      .__instances;
    // Construction order in apiClient.ts: public, refresh, api, replay.
    return instances[2] as unknown as { get: jest.Mock; patch: jest.Mock };
  }

  it('getMe reads GET /users/me through the authenticated client', async () => {
    const { getMe } = loadApiClient();
    const instance = apiClientInstance();
    const body = { id: 'u1', email: 'a@example.com', profile: null, privacy: null };
    instance.get.mockResolvedValue({ data: body });

    await expect(getMe()).resolves.toEqual(body);

    expect(instance.get).toHaveBeenCalledWith('/users/me');
  });

  it('updateProfile sends only the given fields through PATCH /users/me/profile', async () => {
    const { updateProfile } = loadApiClient();
    const instance = apiClientInstance();
    const updated = { userId: 'u1', displayName: 'Ada' };
    instance.patch.mockResolvedValue({ data: updated });

    await expect(updateProfile({ displayName: 'Ada' })).resolves.toEqual(updated);

    expect(instance.patch).toHaveBeenCalledWith('/users/me/profile', { displayName: 'Ada' });
  });

  it('updatePrivacy sends the given flags through PATCH /users/me/privacy', async () => {
    const { updatePrivacy } = loadApiClient();
    const instance = apiClientInstance();
    const updated = {
      publicProfile: false,
      leaderboardOptIn: true,
      locationForLeaderboard: true,
      aiFeaturesConsent: true,
      aiFeaturesConsentAt: '2026-01-01T00:00:00.000Z',
      crashDiagnostics: false,
    };
    instance.patch.mockResolvedValue({ data: updated });

    await expect(updatePrivacy({ leaderboardOptIn: true })).resolves.toEqual(updated);

    expect(instance.patch).toHaveBeenCalledWith('/users/me/privacy', {
      leaderboardOptIn: true,
    });
  });

  it('getAthlete reads GET /athletes/:userId through the authenticated client', async () => {
    const { getAthlete } = loadApiClient();
    const instance = apiClientInstance();
    const body = {
      userId: 'u2',
      displayName: 'Ada Lovelace',
      avatarUrl: null,
      city: 'Alexandria',
      trainingGoals: [],
      activities: [],
      isSelf: false,
    };
    instance.get.mockResolvedValue({ data: body });

    await expect(getAthlete('u2')).resolves.toEqual(body);

    expect(instance.get).toHaveBeenCalledWith('/athletes/u2');
  });
});
