import {
  PUSH_CHANNEL_ID,
  registerForPush,
  syncPushRegistration,
  unregisterFromPush,
  type PushApi,
  type PushRegistrationDeps,
} from '../push-registration';

// Phase 12F slice 4 (docs/product/phase-12f-plan.md). The phone asks the push service for its token once it may show
// notifications, tells the server (POST /users/me/push-tokens), and takes the token off the server before sign-out.
// Everything native or networked is injected, so this is proved without a phone. Nothing here throws: a phone without
// push set up (no Firebase config yet, no network) just does not register, and the app works as it did.
const TOKEN = 'ExponentPushToken[abc123]';
const DAY = 86_400_000;

function makeDeps(over: { api?: Partial<PushApi>; stored?: { token: string; registeredAt: number; userId?: string } | null; userId?: string | null; switches?: { pr: boolean; rank: boolean } } = {}) {
  let stored = over.stored ?? null;
  const calls: string[] = [];
  const api: PushApi = {
    platform: 'android',
    projectId: 'project-1',
    getPermissionGranted: jest.fn(async () => true),
    setChannel: jest.fn(async () => {
      calls.push('channel');
    }),
    getExpoPushToken: jest.fn(async () => {
      calls.push('token');
      return TOKEN;
    }),
    ...over.api,
  };
  const deps: PushRegistrationDeps = {
    api,
    tokenStore: {
      load: jest.fn(async () => stored),
      save: jest.fn(async (value) => {
        stored = value;
      }),
      clear: jest.fn(async () => {
        stored = null;
      }),
    },
    register: jest.fn(async () => {
      calls.push('register');
    }),
    remove: jest.fn(async () => {
      calls.push('remove');
    }),
    loadSwitches: jest.fn(async () => over.switches ?? { pr: true, rank: false }),
    getUserId: jest.fn(async () => (over.userId === undefined ? 'user-1' : over.userId)),
    now: () => 1_000_000_000,
  };
  return { deps, api, calls, getStored: () => stored };
}

describe('registerForPush', () => {
  it('asks for the token and tells the server, in that order, then remembers it', async () => {
    const { deps, calls, getStored } = makeDeps();

    await expect(registerForPush(deps)).resolves.toBe('registered');

    expect(calls).toEqual(['channel', 'token', 'register']);
    expect(deps.api.getExpoPushToken).toHaveBeenCalledWith('project-1');
    expect(deps.register).toHaveBeenCalledWith({ token: TOKEN, platform: 'android' });
    expect(getStored()).toEqual({ token: TOKEN, registeredAt: 1_000_000_000, userId: 'user-1' });
  });

  it('creates the Android channel before it asks for the token, and not at all on iPhone', async () => {
    const android = makeDeps();
    const ios = makeDeps({ api: { platform: 'ios' } });

    await registerForPush(android.deps);
    await registerForPush(ios.deps);

    expect(PUSH_CHANNEL_ID).toBe('updates');
    expect(android.calls.indexOf('channel')).toBeLessThan(android.calls.indexOf('token'));
    expect(ios.api.setChannel).not.toHaveBeenCalled();
    expect(ios.deps.register).toHaveBeenCalledWith({ token: TOKEN, platform: 'ios' });
  });

  it('does nothing when the phone has not allowed notifications', async () => {
    const { deps } = makeDeps({ api: { getPermissionGranted: jest.fn(async () => false) } });

    await expect(registerForPush(deps)).resolves.toBe('no_permission');

    expect(deps.api.getExpoPushToken).not.toHaveBeenCalled();
    expect(deps.register).not.toHaveBeenCalled();
  });

  it('does nothing on a platform the server does not know, or without an EAS project id', async () => {
    const web = makeDeps({ api: { platform: 'web' } });
    const noProject = makeDeps({ api: { projectId: null } });

    await expect(registerForPush(web.deps)).resolves.toBe('unavailable');
    await expect(registerForPush(noProject.deps)).resolves.toBe('unavailable');

    expect(web.deps.register).not.toHaveBeenCalled();
    expect(noProject.deps.register).not.toHaveBeenCalled();
  });

  it('does not throw when the push service cannot give a token (no Firebase config yet, no network)', async () => {
    const { deps, getStored } = makeDeps({ api: { getExpoPushToken: jest.fn(async () => { throw new Error('FCM not configured'); }) } });

    await expect(registerForPush(deps)).resolves.toBe('unavailable');

    expect(deps.register).not.toHaveBeenCalled();
    expect(getStored()).toBeNull();
  });

  it('does not remember a token the server did not take, so it tries again next time', async () => {
    const { deps, getStored } = makeDeps();
    (deps.register as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await expect(registerForPush(deps)).resolves.toBe('failed');

    expect(getStored()).toBeNull();
    await expect(registerForPush(deps)).resolves.toBe('registered');
  });

  it('leaves it alone when the same token was registered in the last week, and refreshes it after that', async () => {
    const fresh = makeDeps({ stored: { token: TOKEN, registeredAt: 1_000_000_000 - 2 * DAY, userId: 'user-1' } });
    const old = makeDeps({ stored: { token: TOKEN, registeredAt: 1_000_000_000 - 8 * DAY, userId: 'user-1' } });

    await expect(registerForPush(fresh.deps)).resolves.toBe('fresh');
    await expect(registerForPush(old.deps)).resolves.toBe('registered');

    expect(fresh.deps.register).not.toHaveBeenCalled();
    expect(old.deps.register).toHaveBeenCalledTimes(1);
  });

  it('registers again at once when the token has changed', async () => {
    const { deps } = makeDeps({ stored: { token: 'ExponentPushToken[old]', registeredAt: 1_000_000_000 - DAY } });

    await expect(registerForPush(deps)).resolves.toBe('registered');

    expect(deps.register).toHaveBeenCalledWith({ token: TOKEN, platform: 'android' });
  });
});

describe('registerForPush across accounts and sign-out', () => {
  it('registers again when a different account is signed in, even for a token registered a minute ago', async () => {
    const { deps, getStored } = makeDeps({ stored: { token: TOKEN, registeredAt: 1_000_000_000 - 60_000, userId: 'user-1' }, userId: 'user-2' });

    await expect(registerForPush(deps)).resolves.toBe('registered');

    expect(deps.register).toHaveBeenCalledTimes(1);
    expect(getStored()?.userId).toBe('user-2');
  });

  it('registers again when the stored token has no account recorded', async () => {
    const { deps } = makeDeps({ stored: { token: TOKEN, registeredAt: 1_000_000_000 - 60_000 } });

    await expect(registerForPush(deps)).resolves.toBe('registered');
  });

  it('does not register without a signed-in account', async () => {
    const { deps } = makeDeps({ userId: null });

    await expect(registerForPush(deps)).resolves.toBe('unavailable');

    expect(deps.register).not.toHaveBeenCalled();
  });

  it('sends one request when several syncs start together', async () => {
    const { deps } = makeDeps();

    const results = await Promise.all([registerForPush(deps), registerForPush(deps), registerForPush(deps)]);

    expect(results).toEqual(['registered', 'registered', 'registered']);
    expect(deps.register).toHaveBeenCalledTimes(1);
  });

  it('does not keep or leave a token when the person signs out while the registration is on its way', async () => {
    const { deps, getStored } = makeDeps();
    let release: () => void = () => undefined;
    (deps.register as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));

    const registering = registerForPush(deps);
    await new Promise((resolve) => setImmediate(resolve));
    await unregisterFromPush(deps);
    release();

    await expect(registering).resolves.toBe('failed');
    expect(getStored()).toBeNull();
    expect(deps.remove).toHaveBeenLastCalledWith({ token: TOKEN });
  });
});

describe('unregisterFromPush', () => {
  it('takes the stored token off the server and forgets it', async () => {
    const { deps, getStored } = makeDeps({ stored: { token: TOKEN, registeredAt: 1 } });

    await expect(unregisterFromPush(deps)).resolves.toBe(true);

    expect(deps.remove).toHaveBeenCalledWith({ token: TOKEN });
    expect(getStored()).toBeNull();
  });

  it('does nothing when no token was registered', async () => {
    const { deps } = makeDeps();

    await expect(unregisterFromPush(deps)).resolves.toBe(false);

    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('forgets the token even when the server cannot be reached, and never throws', async () => {
    const { deps, getStored } = makeDeps({ stored: { token: TOKEN, registeredAt: 1 } });
    (deps.remove as jest.Mock).mockRejectedValue(new Error('offline'));

    await expect(unregisterFromPush(deps)).resolves.toBe(false);

    expect(getStored()).toBeNull();
  });

  it('does not hold up a sign-out when the server hangs: it gives up after its time limit', async () => {
    jest.useFakeTimers();
    const { deps, getStored } = makeDeps({ stored: { token: TOKEN, registeredAt: 1 } });
    (deps.remove as jest.Mock).mockImplementation(() => new Promise(() => undefined));

    const result = unregisterFromPush(deps, 3000);
    await jest.advanceTimersByTimeAsync(3001);

    await expect(result).resolves.toBe(false);
    expect(getStored()).toBeNull();
    jest.useRealTimers();
  });
});

describe('syncPushRegistration', () => {
  it('registers when the person wants either push, and the phone allows notifications', async () => {
    for (const switches of [{ pr: true, rank: false }, { pr: false, rank: true }, { pr: true, rank: true }]) {
      const { deps } = makeDeps({ switches });

      await expect(syncPushRegistration(deps)).resolves.toBe('registered');
    }
  });

  it('takes the token off the server when the person has turned both pushes off', async () => {
    const { deps, getStored } = makeDeps({ switches: { pr: false, rank: false }, stored: { token: TOKEN, registeredAt: 1 } });

    await expect(syncPushRegistration(deps)).resolves.toBe('removed');

    expect(deps.remove).toHaveBeenCalledWith({ token: TOKEN });
    expect(getStored()).toBeNull();
    expect(deps.register).not.toHaveBeenCalled();
  });

  it('does nothing when both are off and no token was registered', async () => {
    const { deps } = makeDeps({ switches: { pr: false, rank: false } });

    await expect(syncPushRegistration(deps)).resolves.toBe('none');

    expect(deps.api.getPermissionGranted).not.toHaveBeenCalled();
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('never throws, even when reading the switches fails', async () => {
    const { deps } = makeDeps();
    (deps.loadSwitches as jest.Mock).mockRejectedValue(new Error('storage'));

    await expect(syncPushRegistration(deps)).resolves.toBe('none');
  });
});
