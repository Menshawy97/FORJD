// The finished run is handed to the summary screen in memory, like the strength summary: a read-only
// report that cannot write back into a run already queued for upload.
import { clearCompletedRun, getCompletedRun, setCompletedRun, type CompletedRun } from '../run-handoff';

const run: CompletedRun = {
  distanceMeters: 3560,
  movingSeconds: 1329,
  averagePaceSecondsPerKm: 373,
  avgHeartRateBpm: null,
  caloriesKcal: 298,
  caloriesSource: 'estimate',
  elevationGainMeters: 24,
  splits: [],
  route: [],
};

describe('run handoff', () => {
  afterEach(() => clearCompletedRun());

  it('is empty until a run finishes', () => {
    expect(getCompletedRun()).toBeNull();
  });

  it('holds the finished run until it is cleared', () => {
    setCompletedRun(run);
    expect(getCompletedRun()).toEqual(run);
    expect(getCompletedRun()).toEqual(run);
    clearCompletedRun();
    expect(getCompletedRun()).toBeNull();
  });
});
