// Phase 12C. `expo-background-task` is a native module, and a build without it (Expo Go) must
// degrade, never crash: a missing module cannot take the app, or a workout, down with it.

describe('background upload without the native modules', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-background-task');
    jest.dontMock('expo-task-manager');
  });

  const load = () => {
    jest.doMock('expo-background-task', () => {
      throw new Error("Cannot find native module 'ExpoBackgroundTask'");
    });
    jest.doMock('expo-task-manager', () => {
      throw new Error("Cannot find native module 'ExpoTaskManager'");
    });
    return require('../background-upload') as typeof import('../background-upload');
  };

  it('reports registration as unavailable', async () => {
    await expect(load().registerBackgroundUpload()).resolves.toBe('unavailable');
  });

  it('defines nothing and does not throw', () => {
    expect(() => load().defineBackgroundUpload(jest.fn())).not.toThrow();
  });

  it('unregisters nothing and does not throw', async () => {
    await expect(load().unregisterBackgroundUpload()).resolves.toBeUndefined();
  });

  it('does not load either module until something asks for it', () => {
    const background = jest.fn(() => ({}));
    const taskManager = jest.fn(() => ({}));
    jest.doMock('expo-background-task', background);
    jest.doMock('expo-task-manager', taskManager);

    require('../background-upload');

    expect(background).not.toHaveBeenCalled();
    expect(taskManager).not.toHaveBeenCalled();
  });
});
