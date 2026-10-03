/**
 * ADR-063, Phase 12B-1. A lock-screen notice whose time Android itself ticks every second, through the
 * app's own small Kotlin module (`modules/forjd-ongoing-notice`), because `expo-notifications` cannot
 * draw a chronometer. This file is the only place the module is imported (conformance check).
 *
 * - **A countdown keeps going with the app asleep.** Android redraws it; no JavaScript runs. When it
 *   reaches zero the notice is replaced by its `then` content (the next set after a rest), posted by the
 *   module itself, so a frozen app never leaves a timer running past zero.
 * - **Taps arrive as `onAction`.** A tap made while nothing listened (the app was stopped) is kept by
 *   the module and handed over, in order, when a listener subscribes.
 * - **Local only** (ADR-061 decision 3): built on the phone, never pushed, so it may carry training
 *   values. `lockScreen: 'private'` hides them on the lock screen (the 12H setting).
 * - **Never throws, and a no-op where the module is missing** (iOS, Expo Go, Jest): a notice is never in
 *   a workout's critical path (CLAUDE.md rule 6). Invalid options are refused here, before Kotlin.
 */
import type {
  NativeNoticeAction,
  NativeNoticeContent,
  NativeShowOptions,
  NoticeActionPayload,
} from '../../../modules/forjd-ongoing-notice/src/ForjdOngoingNotice.types';

export type NoticeChronometer = { countDownToMs: number } | { countUpFromMs: number };

export interface NoticeAction {
  id: string;
  title: string;
  /** Opens the app with the action; otherwise it acts without opening it. */
  opensApp?: boolean;
}

export interface NoticeContent {
  title: string;
  text: string;
  /** Android's subText, beside the app name in the header. */
  subText?: string;
  chronometer?: NoticeChronometer;
  actions?: NoticeAction[];
}

export interface OngoingNoticeOptions extends NoticeContent {
  /** One notice per id: showing again updates it in place, silently. */
  id: string;
  /** A low-importance channel, created on first use: never a sound, a buzz or a pop-up. */
  channel: { id: string; name: string };
  /** `#RRGGBB`. */
  color: string;
  lockScreen?: 'public' | 'private';
  /** Shown in this notice's place when its countdown ends. Only with a countdown, and without one itself. */
  then?: NoticeContent;
}

export type NoticeActionEvent = NoticeActionPayload;

/** The module as JavaScript sees it; injected so the seam is tested without it. */
export interface OngoingNoticeNative {
  show: (options: NativeShowOptions) => Promise<boolean>;
  dismiss: (id: string) => void;
  takePendingActions: () => NoticeActionEvent[];
  addListener: (event: 'onAction', listener: (event: NoticeActionEvent) => void) => { remove: () => void };
}

export interface OngoingNotice {
  isAvailable: () => boolean;
  /** Whether it is showing: false where the module is missing, the options are invalid or notifications are off. */
  show: (options: OngoingNoticeOptions) => Promise<boolean>;
  dismiss: (id: string) => Promise<void>;
  /** Taps on any notice's actions, including those made while nothing listened. Returns the unsubscribe. */
  onAction: (handler: (event: NoticeActionEvent) => void) => () => void;
}

/** Android shows at most three action buttons. */
const MAX_ACTIONS = 3;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const filled = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0;
const isTime = (value: number): boolean => Number.isFinite(value) && value > 0;

function toNativeActions(actions: NoticeAction[] | undefined): NativeNoticeAction[] | null {
  const list = actions ?? [];
  if (list.length > MAX_ACTIONS) return null;
  if (new Set(list.map((action) => action.id)).size !== list.length) return null;
  if (!list.every((action) => filled(action.id) && filled(action.title))) return null;
  return list.map((action) => ({ id: action.id, title: action.title, opensApp: action.opensApp === true }));
}

function toNativeContent(content: NoticeContent, nowMs: number): NativeNoticeContent | null {
  if (!filled(content.title)) return null;
  const actions = toNativeActions(content.actions);
  if (!actions) return null;
  const chronometer = content.chronometer;
  const countDownToMs = chronometer && 'countDownToMs' in chronometer ? chronometer.countDownToMs : null;
  const countUpFromMs = chronometer && 'countUpFromMs' in chronometer ? chronometer.countUpFromMs : null;
  if (countDownToMs !== null && !isTime(countDownToMs)) return null;
  // A count-up from the future would show a negative elapsed time: a caller's sign error, refused here.
  if (countUpFromMs !== null && (!isTime(countUpFromMs) || countUpFromMs > nowMs)) return null;
  return { title: content.title, text: content.text, subText: content.subText ?? null, countDownToMs, countUpFromMs, actions };
}

/**
 * The options as the Kotlin records read them, or null when they are invalid. A countdown that has
 * already ended shows its `then` content straight away.
 */
export function toNativeOptions(options: OngoingNoticeOptions, nowMs: number): NativeShowOptions | null {
  if (!filled(options.id) || !filled(options.channel.id) || !filled(options.channel.name)) return null;
  if (!HEX_COLOR.test(options.color)) return null;

  const content = toNativeContent(options, nowMs);
  if (!content) return null;

  let then: NativeNoticeContent | null = null;
  if (options.then) {
    if (content.countDownToMs === null) return null;
    then = toNativeContent(options.then, nowMs);
    if (!then || then.countDownToMs !== null) return null;
  }

  const base = {
    id: options.id,
    channelId: options.channel.id,
    channelName: options.channel.name,
    color: options.color,
    visibility: options.lockScreen ?? 'public',
  } as const;

  if (content.countDownToMs !== null && content.countDownToMs <= nowMs) {
    return then ? { ...base, ...then, then: null } : null;
  }
  return { ...base, ...content, then };
}

function isActionEvent(value: unknown): value is NoticeActionEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.noticeId === 'string' && typeof event.actionId === 'string';
}

export function createOngoingNotice(
  load: () => OngoingNoticeNative | null,
  now: () => number = Date.now,
): OngoingNotice {
  let loaded = false;
  let native: OngoingNoticeNative | null = null;

  const module = (): OngoingNoticeNative | null => {
    if (!loaded) {
      loaded = true;
      try {
        native = load();
      } catch {
        native = null;
      }
    }
    return native;
  };

  return {
    isAvailable: () => module() !== null,
    show: async (options) => {
      const target = module();
      if (!target) return false;
      const nativeOptions = toNativeOptions(options, now());
      if (!nativeOptions) return false;
      try {
        return (await target.show(nativeOptions)) === true;
      } catch {
        return false;
      }
    },
    dismiss: async (id) => {
      try {
        module()?.dismiss(id);
      } catch {
        // Nothing to dismiss, or the module is gone: either way it is not showing.
      }
    },
    onAction: (handler) => {
      const target = module();
      if (!target) return () => undefined;
      const deliver = (event: unknown) => {
        if (!isActionEvent(event)) return;
        try {
          handler({ noticeId: event.noticeId, actionId: event.actionId });
        } catch {
          // A handler that throws must not stop the next tap from arriving.
        }
      };
      let subscription: { remove: () => void } | null = null;
      try {
        subscription = target.addListener('onAction', deliver);
        const pending: unknown = target.takePendingActions();
        if (Array.isArray(pending)) pending.forEach(deliver);
      } catch {
        // Without the event the notice still shows; its taps are kept by the module until the next subscribe.
      }
      return () => {
        try {
          subscription?.remove();
        } catch {
          // Already removed.
        }
      };
    },
  };
}

function loadNative(): OngoingNoticeNative | null {
  // A guarded `require`, as `run-location-task.ts` does: it must fail inside the seam's try on a build
  // without the module. The module file itself returns null there (`requireOptionalNativeModule`).
  const { default: native } = require('../../../modules/forjd-ongoing-notice/src/ForjdOngoingNoticeModule') as {
    default: OngoingNoticeNative | null;
  };
  return native ?? null;
}

export const ongoingNotice = createOngoingNotice(loadNative);
