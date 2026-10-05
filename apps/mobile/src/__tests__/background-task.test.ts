// Phase 12C. Route files (`app/_layout.tsx` included) are loaded lazily by expo-router, so a
// background wake-up that never renders the app would never evaluate them and the task would be
// undefined (TaskManager then unregisters it). The task is therefore defined by a module the app's
// entry file imports first. What is proven here: loading it defines the task with the shared drain.
const mockDefine = jest.fn();

jest.mock('@/integrations/background/background-upload', () => ({
  defineBackgroundUpload: (...args: unknown[]) => mockDefine(...args),
}));

jest.mock('@/workouts/sync-sessions', () => ({
  syncPendingSessions: jest.fn(),
}));

describe('background task entry (12C)', () => {
  it('defines the background upload with the drain every foreground trigger uses', () => {
    mockDefine.mockClear();

    let sharedDrain: unknown;
    jest.isolateModules(() => {
      require('../background-task');
      sharedDrain = require('@/workouts/sync-sessions').syncPendingSessions;
    });

    expect(mockDefine).toHaveBeenCalledTimes(1);
    expect(mockDefine.mock.calls[0][0]).toBe(sharedDrain);
  });
});
