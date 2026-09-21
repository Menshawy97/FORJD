// ADR-049 #2: a run that survives a crash resumes from its saved state. The snapshot is the whole
// RunState, and it is restored PAUSED at the moment it was saved, so the time the app was dead is
// never counted as running time.
import { addFix, movingMsAt, pauseRun, startRun } from '@/workouts/live-run';

import { restoreRunSnapshot, toRunSnapshot } from '../run-snapshot';

const T0 = 1_700_000_000_000;
const ID = '11111111-1111-4111-8111-111111111111';
const fix = (seconds: number) => ({
  latitude: 51.5 + seconds * 0.00001,
  longitude: -0.12,
  altitudeMeters: 20,
  accuracyMeters: 5,
  timestampMs: T0 + seconds * 1000,
});

describe('run snapshot', () => {
  it('round-trips a running run and restores it paused at the save time', () => {
    let state = startRun(ID, T0);
    state = addFix(state, fix(1));
    state = addFix(state, fix(2));

    const restored = restoreRunSnapshot(JSON.parse(JSON.stringify(toRunSnapshot(state, T0 + 2_000))));

    expect(restored).not.toBeNull();
    expect(restored?.status).toBe('paused');
    expect(restored?.fixes).toHaveLength(2);
    // Two seconds moved; an hour later the app reopens and it is still two seconds.
    expect(movingMsAt(restored!, T0 + 3_600_000)).toBe(2_000);
  });

  it('keeps a run that was already paused paused, with its banked time', () => {
    const paused = pauseRun(startRun(ID, T0), T0 + 5_000);
    const restored = restoreRunSnapshot(JSON.parse(JSON.stringify(toRunSnapshot(paused, T0 + 60_000))));
    expect(restored?.status).toBe('paused');
    expect(movingMsAt(restored!, T0 + 90_000)).toBe(5_000);
  });

  it('the first reading after a restore starts a new segment, so the walk home is not distance', () => {
    const restored = restoreRunSnapshot(toRunSnapshot(addFix(startRun(ID, T0), fix(1)), T0 + 1_000))!;
    expect(restored.nextFixStartsSegment).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['no state', { savedAtMs: 1 }],
    ['a bad id', { savedAtMs: 1, state: { id: 5 } }],
    ['a finished run, which is never offered back', { savedAtMs: T0, state: { ...startRun(ID, T0), status: 'finished' } }],
    ['fixes that are not readings', { savedAtMs: T0, state: { ...startRun(ID, T0), fixes: [{ latitude: 'x' }] } }],
    ['a non-finite save time', { savedAtMs: Number.NaN, state: startRun(ID, T0) }],
  ])('refuses %s', (_label, payload) => {
    expect(restoreRunSnapshot(payload)).toBeNull();
  });
});
