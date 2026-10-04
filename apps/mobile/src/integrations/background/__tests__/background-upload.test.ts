// Phase 12C. Finished workouts and runs upload while the app is closed. `expo-background-task` and
// `expo-task-manager` are mocked at their boundary; what is proven is the seam's own behaviour: the
// task is defined as soon as the module loads and runs the injected drain, a drain that merely
// reports rejected rows is still a successful task run, registration asks for the 15-minute gap
// the owner chose and is idempotent, and nothing here ever throws (CLAUDE.md rule 6).
const mockDefineTask = jest.fn();
const mockIsTaskDefined = jest.fn();
const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockGetStatus = jest.fn();
const mockIsRegistered = jest.fn();

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => mockDefineTask(...args),
  isTaskDefined: (...args: unknown[]) => mockIsTaskDefined(...args),
  isTaskRegisteredAsync: (...args: unknown[]) => mockIsRegistered(...args),
}));

jest.mock('expo-background-task', () => ({
  registerTaskAsync: (...args: unknown[]) => mockRegister(...args),
  unregisterTaskAsync: (...args: unknown[]) => mockUnregister(...args),
  getStatusAsync: (...args: unknown[]) => mockGetStatus(...args),
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

import {
  BACKGROUND_UPLOAD_INTERVAL_MINUTES,
  BACKGROUND_UPLOAD_TASK,
  defineBackgroundUpload,
  registerBackgroundUpload,
  unregisterBackgroundUpload,
} from '../background-upload';

/** The executor the seam registered with TaskManager, as TaskManager would call it. */
function registeredExecutor(): () => Promise<number> {
  const call = mockDefineTask.mock.calls.find(([name]) => name === BACKGROUND_UPLOAD_TASK);
  if (!call) throw new Error('task not defined');
  return call[1];
}

describe('background upload (12C)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTaskDefined.mockReturnValue(false);
    mockGetStatus.mockResolvedValue(2);
    mockIsRegistered.mockResolvedValue(false);
    mockRegister.mockResolvedValue(undefined);
    mockUnregister.mockResolvedValue(undefined);
  });

  describe('defineBackgroundUpload', () => {
    it('defines the task so a process Android wakes headless still has it', () => {
      defineBackgroundUpload(jest.fn().mockResolvedValue(undefined));

      expect(mockDefineTask).toHaveBeenCalledWith(BACKGROUND_UPLOAD_TASK, expect.any(Function));
    });

    it('does not define the task twice', () => {
      mockIsTaskDefined.mockReturnValue(true);

      defineBackgroundUpload(jest.fn().mockResolvedValue(undefined));

      expect(mockDefineTask).not.toHaveBeenCalled();
    });

    it('runs the drain and reports success', async () => {
      const drain = jest.fn().mockResolvedValue(undefined);
      defineBackgroundUpload(drain);

      await expect(registeredExecutor()()).resolves.toBe(1);
      expect(drain).toHaveBeenCalledTimes(1);
    });

    it('still reports success when the drain reports rows the server rejected (the queue tracks those)', async () => {
      defineBackgroundUpload(jest.fn().mockResolvedValue({ uploaded: [], failed: ['session-1'] }));

      await expect(registeredExecutor()()).resolves.toBe(1);
    });

    it('reports failure when the drain itself throws, and does not throw itself', async () => {
      defineBackgroundUpload(jest.fn().mockRejectedValue(new Error('storage unavailable')));

      await expect(registeredExecutor()()).resolves.toBe(2);
    });
  });

  describe('registerBackgroundUpload', () => {
    it('registers with the 15-minute gap', async () => {
      await expect(registerBackgroundUpload()).resolves.toBe('registered');

      expect(BACKGROUND_UPLOAD_INTERVAL_MINUTES).toBe(15);
      expect(mockRegister).toHaveBeenCalledWith(BACKGROUND_UPLOAD_TASK, { minimumInterval: 15 });
    });

    it('does not register again when it already is', async () => {
      mockIsRegistered.mockResolvedValue(true);

      await expect(registerBackgroundUpload()).resolves.toBe('registered');
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('reports restricted, without registering, when the system turned background work off', async () => {
      mockGetStatus.mockResolvedValue(1);

      await expect(registerBackgroundUpload()).resolves.toBe('restricted');
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('reports unavailable, and does not throw, when registering fails', async () => {
      mockRegister.mockRejectedValue(new Error('Task not defined'));

      await expect(registerBackgroundUpload()).resolves.toBe('unavailable');
    });
  });

  describe('unregisterBackgroundUpload', () => {
    it('unregisters when registered', async () => {
      mockIsRegistered.mockResolvedValue(true);

      await unregisterBackgroundUpload();

      expect(mockUnregister).toHaveBeenCalledWith(BACKGROUND_UPLOAD_TASK);
    });

    it('does nothing when it is not registered', async () => {
      await unregisterBackgroundUpload();

      expect(mockUnregister).not.toHaveBeenCalled();
    });

    it('waits for a registration still in flight, so a quick sign-out cannot leave it registered', async () => {
      let finishRegistering: () => void = () => {};
      mockRegister.mockReturnValue(new Promise<void>((resolve) => (finishRegistering = resolve)));
      mockIsRegistered.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const registering = registerBackgroundUpload();
      const unregistering = unregisterBackgroundUpload();
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockUnregister).not.toHaveBeenCalled();

      finishRegistering();
      await Promise.all([registering, unregistering]);
      expect(mockUnregister).toHaveBeenCalledWith(BACKGROUND_UPLOAD_TASK);
    });

    it('does not throw when unregistering fails', async () => {
      mockIsRegistered.mockResolvedValue(true);
      mockUnregister.mockRejectedValue(new Error('boom'));

      await expect(unregisterBackgroundUpload()).resolves.toBeUndefined();
    });
  });
});
