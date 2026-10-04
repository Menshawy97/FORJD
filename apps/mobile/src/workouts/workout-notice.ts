import {
  ongoingNotice,
  type NoticeActionEvent,
  type OngoingNotice,
} from '@/integrations/notifications/ongoing-notice';

import { activeWorkout, type ActiveWorkout } from './active-workout';
import { completeSet } from './live-session';
import {
  cancelRestEndNotification,
  ensureRestNotificationPermission,
  scheduleRestEndNotification,
} from './rest-notifications';
import {
  WORKOUT_NOTICE_ID,
  findOpenSet,
  parseNoticeAction,
  workoutNoticeContent,
  type NoticeUnits,
} from './workout-notice-content';

export { WORKOUT_NOTICE_ID } from './workout-notice-content';

/**
 * The owner of the workout's lock-screen notice and of the rest period (12B-2, ADR-063, ADR-026), now a
 * follower of the active workout (12B-2b). It is bound once for the life of the app and:
 *
 * - **posts the notice**, the set card or the rest card, and keeps it current as the workout changes,
 *   whichever screen is open, including none;
 * - **owns the rest's end time and its "Rest complete" alert**, so a rest works with no rest screen
 *   open -- a Done tapped on the lock screen starts one -- and the screen only reads it;
 * - **turns a tap on the notice's buttons into the same thing the live screen does**: Done is
 *   `completeSet`, applied through the active workout (its events are logged first), and Skip is the rest
 *   screen's Skip -- after checking the tap still means what it said.
 *
 * Android ticks the countdown itself (a chronometer) and swaps the rest card for the next set when it
 * ends, so nothing here has to run while the phone is locked. Nothing here throws into the workout: a
 * missed notice is a stale lock screen, never a broken session (CLAUDE.md rule 6).
 *
 * **A late tap is checked, not trusted.** A button's id names its workout and its target (see
 * `workout-notice-content.ts`); a tap kept while the app was stopped waits for the workout to be restored,
 * is compared with it as it is then, and is dropped unless it still names the open set or the running rest.
 *
 * **Away from the workout screen for three hours with nothing logged**, the card (not the workout) is
 * taken down; opening the workout screen, or any change to the workout, puts it back.
 */
export interface ActiveRest {
  endsAt: number;
  /** The ring's full length: it grows when the rest is extended, as the prototype's `restTotal` does. */
  totalSeconds: number;
}

export interface WorkoutNoticeDeps {
  notice: Pick<OngoingNotice, 'show' | 'dismiss' | 'onAction'>;
  alerts: {
    ensurePermission: () => Promise<boolean>;
    /** The "Rest complete" alert, `seconds` from now. Null when it was not scheduled. */
    schedule: (seconds: number) => Promise<string | null>;
    cancel: (identifier: string | null) => Promise<void>;
  };
  workout: Pick<ActiveWorkout, 'getState' | 'subscribe' | 'apply'>;
  now?: () => number;
  /** Runs `fn` after `ms`; returns the cancel. Injected so the three hours can be driven by hand. */
  after?: (fn: () => void, ms: number) => () => void;
}

export interface WorkoutNotice {
  /** Starts following the active workout and listening for taps. Returns the unbind. */
  bind: () => () => void;
  /** The unit each exercise is read in on the live screen (kg or lb, m or mi). */
  setUnits: (units: NoticeUnits) => void;
  /** Whether the workout screen is open. Away for three hours with nothing logged takes the card down. */
  setViewing: (viewing: boolean) => void;
  /** A rest of `seconds` begins now. Normally started by a completed set; the rest screen may open one itself. */
  beginRest: (seconds: number) => void;
  getRest: () => ActiveRest | null;
  /** Shortens (negative) or extends the running rest; the alert and the card follow. */
  adjustRest: (deltaSeconds: number) => void;
  /** Ends the rest now, by Skip or by running out: cancels the alert and shows the next set. */
  skipRest: () => void;
  /** Called whenever the rest starts, changes or ends. */
  subscribeRest: (listener: () => void) => () => void;
}

interface RestState extends ActiveRest {
  alertId: string | null;
  /** The workout it belongs to: a rest never carries over into another one. */
  sessionId: string | null;
}

/** The most taps kept for a workout that has not been restored yet; the module itself keeps 20. */
const MAX_EARLY_TAPS = 20;
export const AWAY_REMOVAL_MS = 3 * 60 * 60 * 1000;

const defaultAfter = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  // A pending three-hour timer must never keep a process or a test run alive.
  (id as { unref?: () => void }).unref?.();
  return () => clearTimeout(id);
};

export function createWorkoutNotice(deps: WorkoutNoticeDeps): WorkoutNotice {
  const now = deps.now ?? (() => Date.now());
  const after = deps.after ?? defaultAfter;
  let unbind: (() => void) | null = null;
  let units: NoticeUnits = {};
  let viewing = false;
  let cancelAway: (() => void) | null = null;
  let rest: RestState | null = null;
  let permission: Promise<boolean> | null = null;
  let lastSignature: string | null = null;
  let tornDown = false;
  /** Bumped by every teardown, so a card that was still posting can tell it lost the race. */
  let generation = 0;
  /** Taps that arrived before the workout was restored: replayed, and checked, once it is. */
  let earlyTaps: NoticeActionEvent[] = [];
  const restListeners = new Set<() => void>();

  const sessionNow = () => deps.workout.getState().session;
  const notifyRest = () => restListeners.forEach((listener) => listener());

  const cancelAlert = (state: RestState) => {
    if (state.alertId !== null) void deps.alerts.cancel(state.alertId).catch(() => undefined);
  };

  const dropRest = () => {
    const previous = rest;
    rest = null;
    if (previous) cancelAlert(previous);
    notifyRest();
  };

  /** The card comes down and the rest with it, whatever is in flight. The workout itself is untouched. */
  const hideCard = () => {
    generation += 1;
    lastSignature = null;
    dropRest();
    void deps.notice.dismiss(WORKOUT_NOTICE_ID);
  };

  /** Asked once per app run: the notice is the reason, so the prompt is not a surprise. */
  const isPermitted = (): Promise<boolean> => {
    permission ??= deps.alerts.ensurePermission().catch(() => false);
    return permission;
  };

  const post = async (): Promise<void> => {
    const session = sessionNow();
    if (!session || session.status === 'completed') return;
    const mine = generation;
    if (!(await isPermitted()) || mine !== generation) return;

    // A rest that ran out while nothing was watching (the phone locked, the rest screen not open) must
    // not come back as a REST card counting from the past: the set card, and its Done, replace it.
    if (rest && rest.endsAt <= now()) dropRest();

    const fresh = deps.workout.getState();
    if (!fresh.session) return;
    const options = workoutNoticeContent({
      session: fresh.session,
      pausedMs: fresh.pausedMs,
      units,
      rest,
    });
    if (!options) return;
    const signature = JSON.stringify(options);
    if (signature === lastSignature) return;
    lastSignature = signature;
    try {
      const shown = await deps.notice.show(options);
      if (!shown && lastSignature === signature) lastSignature = null;
      // Ended while this was posting: the card landed after the dismiss, so take it down again. Not if a
      // newer card has been posted since: the id is shared, and that dismiss would remove it.
      if (mine !== generation && lastSignature === null) void deps.notice.dismiss(WORKOUT_NOTICE_ID);
    } catch {
      if (lastSignature === signature) lastSignature = null;
    }
  };

  /** Three hours away from the workout screen with nothing logged: the card goes, the workout stays. */
  const rearmAway = () => {
    cancelAway?.();
    cancelAway = null;
    const session = sessionNow();
    if (viewing || !session || session.status === 'completed') return;
    cancelAway = after(() => {
      cancelAway = null;
      hideCard();
    }, AWAY_REMOVAL_MS);
  };

  const openRest = (endsAt: number, totalSeconds: number) => {
    if (rest) cancelAlert(rest);
    const state: RestState = { endsAt, totalSeconds, alertId: null, sessionId: sessionNow()?.id ?? null };
    rest = state;
    void deps.alerts
      .schedule(Math.max(0, Math.round((endsAt - now()) / 1000)))
      .then((identifier) => {
        if (identifier === null) return;
        // The rest ended (or was replaced) before the schedule resolved: cancel it rather than orphan it.
        if (rest === state) state.alertId = identifier;
        else void deps.alerts.cancel(identifier).catch(() => undefined);
      })
      .catch(() => undefined);
    notifyRest();
    void post();
  };

  const endRest = () => {
    if (!rest) return;
    dropRest();
    void post();
  };

  const handleAction = (event: NoticeActionEvent): void => {
    if (event.noticeId !== WORKOUT_NOTICE_ID) return;
    const target = parseNoticeAction(event.actionId);
    if (!target) return;
    const session = sessionNow();
    if (!session) {
      // The app was stopped and is still restoring the workout: keep the tap until it is checkable.
      if (earlyTaps.length < MAX_EARLY_TAPS) earlyTaps = [...earlyTaps, event];
      return;
    }
    if (target.sessionId !== session.id) return;
    // Finish was pressed: a button still on the lock screen must not tick a set after workout_finished.
    if (session.status === 'completed') return;

    if (target.kind === 'skip') {
      if (!rest) {
        // A rest this process does not know (it was restarted mid-rest): the card still says REST, so
        // put the set card back. Its alert cannot be cancelled, the id was lost with the process.
        void post();
        return;
      }
      if (rest.endsAt !== target.endsAt) return;
      if (now() >= rest.endsAt) dropRest();
      else endRest();
      return;
    }

    const open = findOpenSet(session);
    if (!open || open.exerciseIndex !== target.exerciseIndex || open.setIndex !== target.setIndex) return;
    if (rest && now() >= rest.endsAt) dropRest();

    // Through the active workout, which logs the events first and adopts the session at once, so a second
    // tap right behind this one already sees the set as done.
    deps.workout.apply(completeSet(session, open.exerciseIndex, open.setIndex, new Date(now())));
  };

  const onWorkoutChange: Parameters<ActiveWorkout['subscribe']>[0] = (state, change) => {
    const session = state.session;
    if (!session || session.status === 'completed') {
      cancelAway?.();
      cancelAway = null;
      earlyTaps = [];
      if (!tornDown) hideCard();
      tornDown = true;
      return;
    }
    tornDown = false;
    // Another workout began: the old one's rest is not this one's.
    if (rest && rest.sessionId !== session.id) dropRest();
    if (earlyTaps.length > 0) {
      const taps = earlyTaps;
      earlyTaps = [];
      taps.forEach(handleAction);
    }
    rearmAway();
    if (change?.restStartedSeconds != null) {
      const length = Math.max(0, change.restStartedSeconds);
      openRest(now() + length * 1000, length);
      return;
    }
    void post();
  };

  return {
    bind: () => {
      if (unbind) return () => undefined;
      const stopState = deps.workout.subscribe(onWorkoutChange);
      const stopTaps = deps.notice.onAction(handleAction);
      const stop = () => {
        stopState();
        stopTaps();
        cancelAway?.();
        cancelAway = null;
        earlyTaps = [];
        hideCard();
        tornDown = true;
        unbind = null;
      };
      unbind = stop;
      // A workout that already exists when this binds (restored before it) is shown at once.
      if (sessionNow()) onWorkoutChange(deps.workout.getState(), null);
      return stop;
    },
    setUnits: (next) => {
      units = next;
      void post();
    },
    setViewing: (next) => {
      viewing = next;
      rearmAway();
      if (next) void post();
    },
    beginRest: (seconds) => {
      const length = Math.max(0, seconds);
      openRest(now() + length * 1000, length);
    },
    getRest: () => (rest ? { endsAt: rest.endsAt, totalSeconds: rest.totalSeconds } : null),
    adjustRest: (deltaSeconds) => {
      if (!rest) return;
      const remaining = Math.max(0, (rest.endsAt - now()) / 1000);
      const next = Math.max(0, remaining + deltaSeconds);
      // The ring must never overflow: extending past the original length extends the total with it.
      openRest(Math.round(now() + next * 1000), Math.max(rest.totalSeconds, next));
    },
    skipRest: endRest,
    subscribeRest: (listener) => {
      restListeners.add(listener);
      return () => {
        restListeners.delete(listener);
      };
    },
  };
}

export const workoutNotice = createWorkoutNotice({
  notice: ongoingNotice,
  alerts: {
    ensurePermission: () => ensureRestNotificationPermission(),
    schedule: (seconds) => scheduleRestEndNotification(seconds),
    cancel: (identifier) => cancelRestEndNotification(identifier),
  },
  workout: activeWorkout,
});
