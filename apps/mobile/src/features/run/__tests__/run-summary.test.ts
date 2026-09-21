// The run-complete screen reads the same numbers the upload carries, so the two cannot disagree.
import { addFix, finishRun, startRun, toRunUploadRequest } from '@/workouts/live-run';

import { toRunSummary } from '../run-summary';

const T0 = 1_700_000_000_000;
const ID = '11111111-1111-4111-8111-111111111111';
const M_PER_DEG = (6_371_000 * Math.PI) / 180;

function finishedRun() {
  let state = startRun(ID, T0);
  for (let t = 1; t <= 700; t += 1) {
    state = addFix(state, {
      latitude: (3.3 * t) / M_PER_DEG,
      longitude: 0,
      altitudeMeters: 10 + t * 0.02,
      accuracyMeters: 5,
      timestampMs: T0 + t * 1000,
    });
  }
  return finishRun(state, T0 + 700_000);
}

describe('toRunSummary', () => {
  const state = finishedRun();
  const request = toRunUploadRequest(state, {
    weightKg: 70,
    allowStartLocation: false,
    healthDataAllowed: false,
    watchCaloriesKcal: null,
  });
  const route = [
    { latitude: 1, longitude: 2 },
    { latitude: 3, longitude: 4 },
  ];
  const summary = toRunSummary(request, route);

  it('carries the upload run figures', () => {
    expect(summary.distanceMeters).toBe(request.run!.distanceMeters);
    expect(summary.movingSeconds).toBe(request.run!.movingSeconds);
    expect(summary.caloriesKcal).toBe(request.run!.caloriesKcal);
    expect(summary.caloriesSource).toBe('estimate');
    expect(summary.splits.length).toBe(request.run!.splits.length);
    expect(summary.avgHeartRateBpm).toBeNull();
  });

  it('works out the average pace from distance and moving time', () => {
    expect(summary.averagePaceSecondsPerKm).toBeCloseTo((summary.movingSeconds / summary.distanceMeters) * 1000, 5);
  });

  it('keeps the route for drawing, and only the route it was given', () => {
    expect(summary.route).toEqual(route);
  });

  it('throws for an upload with no run object, which is a programming error', () => {
    expect(() => toRunSummary({ ...request, run: undefined }, [])).toThrow();
  });
});
