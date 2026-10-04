/**
 * Phase 12C. Finished workouts and runs upload while the app is closed.
 *
 * The offline queue (ADR-025) already holds a finished session until it can be sent; what was
 * missing was a trigger that does not need the athlete to open the app. This file owns that
 * trigger: a background task Android runs about every 15 minutes (its shortest gap; it may wait
 * longer to save battery), when there is a connection. It is the only place `expo-background-task`
 * is used (CLAUDE.md rule 4, conformance check).
 *
 * It is a trigger and nothing more. What to send, to whom and with what retry policy stays in
 * `workouts/sync-sessions.ts`, handed in as `drain` so this file never imports the workout code.
 * Only what is already saved on the phone is sent, to FORJD's own API; no live workout is ever
 * touched (rule 6) and no analytics SDK is involved (rule 15).
 *
 * A queue row the server rejected is not a failed task run: the queue records that itself. `Failed`
 * is reserved for the drain not being able to run at all.
 *
 * Nothing here throws into the caller. The native modules are required lazily, as the location
 * adapters do, so a build without them (Expo Go) reports `unavailable` instead of crashing at start.
 */
export const BACKGROUND_UPLOAD_TASK = 'forjd-background-upload';

/** Android's shortest allowed gap between background runs. */
export const BACKGROUND_UPLOAD_INTERVAL_MINUTES = 15;

export type BackgroundUploadRegistration = 'registered' | 'restricted' | 'unavailable';

type BackgroundTaskSdk = typeof import('expo-background-task');
type TaskManagerSdk = typeof import('expo-task-manager');

function load<T>(name: 'expo-background-task' | 'expo-task-manager'): T | null {
  try {
    // A guarded `require`, not `import()`: it must throw here, inside the try, when the native module is missing.
    return (name === 'expo-background-task' ? require('expo-background-task') : require('expo-task-manager')) as T;
  } catch {
    return null;
  }
}

/**
 * Defines the task with TaskManager. Safe to call more than once. The app's root layout calls it as
 * the bundle loads, so a process Android wakes headless still has the task to run.
 */
export function defineBackgroundUpload(drain: () => Promise<unknown>): void {
  const taskManager = load<TaskManagerSdk>('expo-task-manager');
  const background = load<BackgroundTaskSdk>('expo-background-task');
  if (!taskManager || !background) return;
  try {
    if (taskManager.isTaskDefined(BACKGROUND_UPLOAD_TASK)) return;
    taskManager.defineTask(BACKGROUND_UPLOAD_TASK, async () => {
      try {
        await drain();
        return background.BackgroundTaskResult.Success;
      } catch {
        return background.BackgroundTaskResult.Failed;
      }
    });
  } catch {
    // Without the task there is no background upload; the foreground triggers still send.
  }
}

/**
 * Register and unregister are each several awaits, and the layout fires them without waiting. Run
 * one after the other so a quick sign-in then sign-out cannot end with the task still registered.
 */
let queue: Promise<unknown> = Promise.resolve();

function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}

/** Registers the task, once. Never prompts and never throws. */
export function registerBackgroundUpload(): Promise<BackgroundUploadRegistration> {
  return inOrder(registerNow);
}

/** Stops the task. Safe to call when it is not registered, and twice. Never throws. */
export function unregisterBackgroundUpload(): Promise<void> {
  return inOrder(unregisterNow);
}

async function registerNow(): Promise<BackgroundUploadRegistration> {
  const taskManager = load<TaskManagerSdk>('expo-task-manager');
  const background = load<BackgroundTaskSdk>('expo-background-task');
  if (!taskManager || !background) return 'unavailable';
  try {
    if ((await background.getStatusAsync()) === background.BackgroundTaskStatus.Restricted) return 'restricted';
    if (await taskManager.isTaskRegisteredAsync(BACKGROUND_UPLOAD_TASK)) return 'registered';
    await background.registerTaskAsync(BACKGROUND_UPLOAD_TASK, {
      minimumInterval: BACKGROUND_UPLOAD_INTERVAL_MINUTES,
    });
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

async function unregisterNow(): Promise<void> {
  const taskManager = load<TaskManagerSdk>('expo-task-manager');
  const background = load<BackgroundTaskSdk>('expo-background-task');
  if (!taskManager || !background) return;
  try {
    if (!(await taskManager.isTaskRegisteredAsync(BACKGROUND_UPLOAD_TASK))) return;
    await background.unregisterTaskAsync(BACKGROUND_UPLOAD_TASK);
  } catch {
    // Nothing to surface: the drain only sends the signed-in account's rows regardless.
  }
}
