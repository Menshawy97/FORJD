import {
  ongoingNotice,
  type NoticeActionEvent,
  type OngoingNotice,
} from '@/integrations/notifications/ongoing-notice';

import { completeSet, type LiveSessionChange } from './live-session';
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
  type WorkoutNoticeInput,
} from './workout-notice-content';

export { WORKOUT_NOTICE_ID } from './workout-notice-content';
export type { WorkoutNoticeInput } from './workout-notice-content';

/**
 * The session-level owner of the workout's lock-screen notice and of the rest period (12B-2, ADR-063,
 * ADR-026). One of these exists while the live screen does, and it is the only thing that:
 *
 * - **posts the notice**, the set card or the rest card, and keeps it current as the session changes;
 * - **owns the rest's end time and its "Rest complete" alert**, so a rest works with no rest screen
 *   open -- a Done tapped on the lock screen starts one -- and the screen only reads it;
 * - **turns a tap on the notice's buttons into the same thing the live screen does** -- Done is
 *   `completeSet`, Skip is the rest screen's Skip -- after checking it still means what it said.
 *
 * Android ticks the countdown itself (a chronometer) and swaps the rest card for the next set when it
 * ends, so nothing here has to run while the phone is locked. Nothing here throws into the workout: a
 * missed notice is a stale lock screen, never a broken session (CLAUDE.md rule 6).
 *
 * **A late tap is checked, not trusted.** A button's id names its session and its target (see
 * `workout-notice-content.ts`); a tap kept while the app was stopped is compared with the session as
 * it is now, and dropped unless it still names the open set or the running rest.
 */
export interface WorkoutNoticeHost {
  /** The live screen's own `apply`: it logs the events, adopts the session and opens the next screen. */
  apply: (change: LiveSessionChange) => void;
}

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
  now?: () => number;
}

export interface WorkoutNotice {
  /** Starts listening for taps and owning the notice. Returns the detach. */
  attach: (host: WorkoutNoticeHost) => () => void;
  /** Stops everything: dismisses the notice, cancels the alert, clears the rest. Safe to repeat. */
  detach: () => void;
  /** The session as it is now; call after every change. Reposts the card only if it differs. */
  sync: (input: WorkoutNoticeInput) => void;
  /** A set was completed and a rest began. `session` is null when the rest screen opens on its own. */
  beginRest: (session: WorkoutNoticeInput['session'] | null, seconds: number) => void;
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
}

/** The most taps kept for a session that has not been restored yet; the module itself keeps 20. */
const MAX_EARLY_TAPS = 20;

export function createWorkoutNotice(deps: WorkoutNoticeDeps): WorkoutNotice {
  const now = deps.now ?? (() => Date.now());
  let host: WorkoutNoticeHost | null = null;
  let unsubscribeTaps: (() => void) | null = null;
  let latest: WorkoutNoticeInput | null = null;
  let rest: RestState | null = null;
  let permission: Promise<boolean> | null = null;
  let lastSignature: string | null = null;
  /** Bumped by every teardown, so a card that was still posting can tell it lost the race. */
  let generation = 0;
  /** Taps that arrived before the session was restored: replayed, and checked, once it is. */
  let earlyTaps: NoticeActionEvent[] = [];
  const restListeners = new Set<() => void>();

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

  const teardownNotice = () => {
    generation += 1;
    lastSignature = null;
    dropRest();
    void deps.notice.dismiss(WORKOUT_NOTICE_ID);
  };

  /** Asked once per workout: the notice is the reason, so the prompt is not a surprise. */
  const isPermitted = (): Promise<boolean> => {
    permission ??= deps.alerts.ensurePermission().catch(() => false);
    return permission;
  };

  const post = async (): Promise<void> => {
    const input = latest;
    if (!input) return;
    if (input.session.status === 'completed') {
      teardownNotice();
      return;
    }
    const mine = generation;
    if (!(await isPermitted()) || mine !== generation || !latest) return;

    const options = workoutNoticeContent({ ...latest, rest });
    if (!options) return;
    const signature = JSON.stringify(options);
    if (signature === lastSignature) return;
    lastSignature = signature;
    try {
      const shown = await deps.notice.show(options);
      if (!shown && lastSignature === signature) lastSignature = null;
      // Ended while this was posting: the card landed after the dismiss, so take it down again.
      if (mine !== generation) void deps.notice.dismiss(WORKOUT_NOTICE_ID);
    } catch {
      if (lastSignature === signature) lastSignature = null;
    }
  };

  const openRest = (endsAt: number, totalSeconds: number) => {
    if (rest) cancelAlert(rest);
    const state: RestState = { endsAt, totalSeconds, alertId: null };
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
    if (!latest) {
      // The app was stopped and is still restoring the session: keep the tap until it is checkable.
      if (earlyTaps.length < MAX_EARLY_TAPS) earlyTaps = [...earlyTaps, event];
      return;
    }
    const input = latest;
    if (!host || target.sessionId !== input.session.id) return;

    if (target.kind === 'skip') {
      if (!rest || rest.endsAt !== target.endsAt) return;
      if (now() >= rest.endsAt) dropRest();
      else endRest();
      return;
    }

    const open = findOpenSet(input.session);
    if (!open || open.exerciseIndex !== target.exerciseIndex || open.setIndex !== target.setIndex) return;
    if (rest && now() >= rest.endsAt) dropRest();

    const change = completeSet(input.session, open.exerciseIndex, open.setIndex, new Date(now()));
    host.apply(change);
    // Adopted here too, not only by the screen's next render: a second tap right behind this one must
    // already see the set as done, or it would tick it again.
    if (!change.refusal) latest = { ...input, session: change.session };
  };

  const detach = () => {
    host = null;
    unsubscribeTaps?.();
    unsubscribeTaps = null;
    latest = null;
    earlyTaps = [];
    teardownNotice();
  };

  return {
    attach: (nextHost) => {
      host = nextHost;
      unsubscribeTaps ??= deps.notice.onAction(handleAction);
      return detach;
    },
    detach,
    sync: (input) => {
      latest = input;
      if (earlyTaps.length > 0) {
        const taps = earlyTaps;
        earlyTaps = [];
        taps.forEach(handleAction);
      }
      void post();
    },
    beginRest: (session, seconds) => {
      if (session) latest = { pausedMs: 0, units: {}, ...latest, session };
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
});
