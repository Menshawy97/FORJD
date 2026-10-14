// Loading last time's sets for the live workout (docs/product/live-prev-column-plan.md): the phone's memory first, so
// PREV works offline at once; then the server, only when its latest session with the exercise is newer than what the
// phone remembers. Never throws: a workout never waits on, or fails over, PREV (rule 6).
import type { WorkoutSessionResponse, WorkoutSessionUploadRequest } from '@forjd/contracts';

import { loadPreviousSets, rememberFinishedWorkout, type PreviousSetsDeps } from '../load-previous-sets';
import type { PreviousSet } from '../previous-sets';

const BENCH = '11111111-1111-4111-8111-111111111111';
const ROW = '33333333-3333-4333-8333-333333333333';
const set = (weightKg: number, reps: number): PreviousSet => ({ weightKg, reps, durationSeconds: null, distanceMeters: null });

function serverSession(weightKg: number): WorkoutSessionResponse {
  return {
    exercises: [
      {
        exerciseId: BENCH,
        orderIndex: 0,
        sets: [{ setIndex: 0, isCompleted: true, weightKg, reps: 10, durationSeconds: null, distanceMeters: null }],
      },
    ],
  } as unknown as WorkoutSessionResponse;
}

function deps(over: Partial<PreviousSetsDeps> = {}): jest.Mocked<PreviousSetsDeps> {
  return {
    accountId: jest.fn(async () => 'acct-1'),
    readLocal: jest.fn(async () => null),
    writeLocal: jest.fn(async () => undefined),
    latestSession: jest.fn(async () => null),
    getSession: jest.fn(async () => serverSession(40)),
    ...over,
  } as jest.Mocked<PreviousSetsDeps>;
}

describe('loadPreviousSets', () => {
  it("shows the phone's memory first, without asking the server for anything newer when there is nothing newer", async () => {
    const d = deps({
      readLocal: jest.fn(async () => ({ performedAt: '2026-10-12T09:00:00.000Z', sets: [set(40, 10)] })),
      latestSession: jest.fn(async () => ({ sessionId: 's-old', performedAt: '2026-10-12T09:00:00.000Z' })),
    });
    const onUpdate = jest.fn();

    await loadPreviousSets([BENCH], onUpdate, d);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(BENCH, [set(40, 10)]);
    expect(d.getSession).not.toHaveBeenCalled();
  });

  it("takes the server's newer session, remembers it, and shows it", async () => {
    const d = deps({
      readLocal: jest.fn(async () => ({ performedAt: '2026-10-01T09:00:00.000Z', sets: [set(30, 10)] })),
      latestSession: jest.fn(async () => ({ sessionId: 's-new', performedAt: '2026-10-12T09:00:00.000Z' })),
      getSession: jest.fn(async () => serverSession(42.5)),
    });
    const onUpdate = jest.fn();

    await loadPreviousSets([BENCH], onUpdate, d);

    expect(d.getSession).toHaveBeenCalledWith('s-new');
    expect(d.writeLocal).toHaveBeenCalledWith('acct-1', BENCH, '2026-10-12T09:00:00.000Z', [set(42.5, 10)]);
    expect(onUpdate.mock.calls).toEqual([
      [BENCH, [set(30, 10)]],
      [BENCH, [set(42.5, 10)]],
    ]);
  });

  it('still shows the memory when the server cannot be reached, and never throws', async () => {
    const d = deps({
      readLocal: jest.fn(async () => ({ performedAt: '2026-10-12T09:00:00.000Z', sets: [set(40, 10)] })),
      latestSession: jest.fn(async () => {
        throw new Error('Network Error');
      }),
    });
    const onUpdate = jest.fn();

    await expect(loadPreviousSets([BENCH], onUpdate, d)).resolves.toBeUndefined();
    expect(onUpdate).toHaveBeenCalledWith(BENCH, [set(40, 10)]);
  });

  it('shows nothing for an exercise never done, and one exercise failing does not stop another', async () => {
    const d = deps({
      readLocal: jest.fn(async (_account: string | null, exerciseId: string) => {
        if (exerciseId === ROW) throw new Error('disk');
        return null;
      }),
      latestSession: jest.fn(async () => null),
    });
    const onUpdate = jest.fn();

    await loadPreviousSets([ROW, BENCH], onUpdate, d);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(d.latestSession).toHaveBeenCalledWith(BENCH);
  });
});

describe('rememberFinishedWorkout', () => {
  it("keeps each exercise's completed sets as last time's, dated by the workout's start (as the server dates it)", async () => {
    const d = deps();
    const request = {
      startedAt: '2026-10-14T08:00:00.000Z',
      exercises: [
        { exerciseId: BENCH, sets: [{ type: 'working', isCompleted: true, weightKg: 40, reps: 10 }] },
        { exerciseId: ROW, sets: [{ type: 'working', isCompleted: false, weightKg: 20, reps: 10 }] },
      ],
    } as unknown as WorkoutSessionUploadRequest;

    await rememberFinishedWorkout(request, d);

    expect(d.writeLocal).toHaveBeenCalledTimes(1);
    expect(d.writeLocal).toHaveBeenCalledWith('acct-1', BENCH, '2026-10-14T08:00:00.000Z', [set(40, 10)]);
  });

  it('never throws', async () => {
    const d = deps({
      writeLocal: jest.fn(async () => {
        throw new Error('disk');
      }),
    });
    const request = {
      startedAt: '2026-10-14T08:00:00.000Z',
      exercises: [{ exerciseId: BENCH, sets: [{ type: 'working', isCompleted: true, weightKg: 40, reps: 10 }] }],
    } as unknown as WorkoutSessionUploadRequest;

    await expect(rememberFinishedWorkout(request, d)).resolves.toBeUndefined();
  });
});
