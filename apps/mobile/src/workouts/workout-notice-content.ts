import { distanceForDisplay, weightForDisplay } from '@forjd/domain';

import type { NoticeContent, OngoingNoticeOptions } from '@/integrations/notifications/ongoing-notice';

import type { LiveExercise, LiveSession, LiveSet } from './live-session';

/**
 * What the workout's lock-screen notice says (12B-2, ADR-063; the approved design of 2026-10-03).
 *
 * Pure: a session in, the notice's options out, no clock and no native module. Two cards, both on
 * absolute times so Android can tick them with the app asleep:
 *
 * - **The set card** -- the exercise, `Set 3 of 4 · 82.5 kg × 6`, and Done. The header's time counts up
 *   from the start plus the time spent paused, so it equals the live screen's own clock.
 * - **The rest card** -- `REST`, a countdown, what is next and Skip rest. Its `then` is the next set's
 *   card, which the module posts itself when the countdown ends.
 *
 * **Local only, training values only** (ADR-061 decision 3): nothing here reads a health value.
 * Loads use the live screen's own units, kg or lb per exercise.
 */
export const WORKOUT_NOTICE_ID = 'forjd-workout-live';
export const WORKOUT_NOTICE_CHANNEL = { id: 'workout-live', name: 'Workout in progress' } as const;
const EMBER = '#E9712F';

/** The unit each exercise is read in on the live screen; anything missing is metric. */
export type NoticeUnits = Readonly<Record<string, string | undefined>>;

export interface WorkoutNoticeInput {
  session: LiveSession;
  /** Milliseconds spent paused so far, as the live screen's clock counts them. */
  pausedMs: number;
  units: NoticeUnits;
}

export interface WorkoutNoticeCardInput extends WorkoutNoticeInput {
  /** The rest in progress, or null between rests. */
  rest: { endsAt: number } | null;
}

export interface OpenSet {
  exerciseIndex: number;
  setIndex: number;
  exercise: LiveExercise;
  set: LiveSet;
}

/** The first set still to be done: the one the live screen calls current, and the one Done ticks. */
export function findOpenSet(session: LiveSession): OpenSet | null {
  for (const [exerciseIndex, exercise] of session.exercises.entries()) {
    const set = exercise.sets.find((each) => !each.isCompleted);
    if (set) return { exerciseIndex, setIndex: set.setIndex, exercise, set };
  }
  return null;
}

export type NoticeTarget =
  | { kind: 'done' | 'start'; sessionId: string; exerciseIndex: number; setIndex: number }
  | { kind: 'skip'; sessionId: string; endsAt: number };

/**
 * A button's id names what it acts on, so a tap that arrives late can be checked against the session
 * before it does anything: a Done for a set that is no longer the open one must never tick the next.
 */
const setActionId = (kind: 'done' | 'start', sessionId: string, open: OpenSet) =>
  `${kind}:${sessionId}:${open.exerciseIndex}:${open.setIndex}`;
const skipActionId = (sessionId: string, endsAt: number) => `skip:${sessionId}:${endsAt}`;

const SET_ACTION = /^(done|start):(.+):(\d+):(\d+)$/;
const SKIP_ACTION = /^skip:(.+):(\d+)$/;

export function parseNoticeAction(actionId: string): NoticeTarget | null {
  const set = SET_ACTION.exec(actionId);
  if (set) {
    return {
      kind: set[1] as 'done' | 'start',
      sessionId: set[2]!,
      exerciseIndex: Number(set[3]),
      setIndex: Number(set[4]),
    };
  }
  const skip = SKIP_ACTION.exec(actionId);
  return skip ? { kind: 'skip', sessionId: skip[1]!, endsAt: Number(skip[2]) } : null;
}

/** `82.5 kg × 6`, `10 reps`, `45 s`, `500 m` -- the live screen's own units. */
function setDetail({ exercise, set }: OpenSet, units: NoticeUnits): string {
  if (exercise.measure === 'time') return `${set.durationSeconds ?? 0} s`;
  if (exercise.measure === 'distance') {
    const unit = units[exercise.exerciseId] === 'mi' ? 'mi' : 'm';
    return `${distanceForDisplay(set.distanceMeters ?? 0, unit)} ${unit}`;
  }
  const unit = units[exercise.exerciseId] === 'lb' ? 'lb' : 'kg';
  const load = set.weightKg === null ? null : `${weightForDisplay(set.weightKg, unit)} ${unit}`;
  if (load !== null && set.reps !== null) return `${load} × ${set.reps}`;
  if (set.reps !== null) return `${set.reps} reps`;
  return load ?? '';
}

function elapsedChronometer({ session, pausedMs }: WorkoutNoticeInput): NoticeContent['chronometer'] {
  // Paused: Android cannot freeze a chronometer, so the time is left off and the header says so.
  if (session.status === 'paused') return undefined;
  return { countUpFromMs: session.startedAt.getTime() + pausedMs };
}

function setCard(input: WorkoutNoticeInput): NoticeContent {
  const { session } = input;
  const subText = session.status === 'paused' ? `${session.name} · Paused` : session.name;
  const chronometer = elapsedChronometer(input);
  const open = findOpenSet(session);

  if (!open) {
    return {
      title: 'All sets complete',
      text: 'Open FORJD to finish your workout',
      subText,
      ...(chronometer ? { chronometer } : {}),
      actions: [],
    };
  }

  const detail = setDetail(open, input.units);
  const position = `Set ${open.setIndex + 1} of ${open.exercise.sets.length}`;
  // A timed set is performed on the set timer, so its button opens the app rather than ticking it.
  const action =
    open.exercise.measure === 'time'
      ? { id: setActionId('start', session.id, open), title: 'Start timer', opensApp: true }
      : { id: setActionId('done', session.id, open), title: 'Done' };
  return {
    title: open.exercise.name,
    text: detail ? `${position} · ${detail}` : position,
    subText,
    ...(chronometer ? { chronometer } : {}),
    actions: [action],
  };
}

function restCard(input: WorkoutNoticeInput, endsAt: number): NoticeContent & { then: NoticeContent } {
  const open = findOpenSet(input.session);
  const detail = open ? setDetail(open, input.units) : '';
  const next = open ? ['Next', open.exercise.name, detail].filter(Boolean).join(' · ') : 'Next · All sets complete';
  return {
    title: 'REST',
    text: next,
    subText: input.session.name,
    chronometer: { countDownToMs: endsAt },
    actions: [{ id: skipActionId(input.session.id, endsAt), title: 'Skip rest' }],
    then: setCard(input),
  };
}

/** The notice for a session right now, or null once the workout is finished. */
export function workoutNoticeContent(input: WorkoutNoticeCardInput): OngoingNoticeOptions | null {
  if (input.session.status === 'completed') return null;
  return {
    id: WORKOUT_NOTICE_ID,
    channel: WORKOUT_NOTICE_CHANNEL,
    color: EMBER,
    ...(input.rest ? restCard(input, input.rest.endsAt) : setCard(input)),
  };
}
