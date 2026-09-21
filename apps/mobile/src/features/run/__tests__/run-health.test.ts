// R8: heart rate and calories from a watch, through the HealthProvider abstraction (CLAUDE.md rules 3
// and 17: nothing here knows about Health Connect). Proven against the FakeHealthProvider.
import type { HealthProvider, SyncedObservation } from '@forjd/domain';

import { FakeHealthProvider } from '@/integrations/health/fake-health-provider';

import { HEART_RATE_POLL_MS, prepareRunHealth, readFinalHealth, sumActiveEnergyKcal, toHeartRateSamples } from '../run-health';

const T0 = 1_700_000_000_000;

const obs = (over: Partial<SyncedObservation>): SyncedObservation => ({
  metricType: 'heart_rate',
  value: 140,
  unit: 'bpm',
  startTime: new Date(T0 + 1000),
  endTime: new Date(T0 + 1000),
  providerRecordId: null,
  deviceId: null,
  quality: null,
  ...over,
});

describe('toHeartRateSamples', () => {
  it('turns heart-rate readings into samples stamped at their start, and ignores other metrics', () => {
    const samples = toHeartRateSamples([
      obs({ value: 141 }),
      obs({ metricType: 'steps', value: 9, unit: 'count' }),
      obs({ value: 150, startTime: new Date(T0 + 5000) }),
    ]);
    expect(samples).toEqual([
      { timestampMs: T0 + 1000, bpm: 141 },
      { timestampMs: T0 + 5000, bpm: 150 },
    ]);
  });
});

describe('sumActiveEnergyKcal', () => {
  const energy = (kcal: number, from: number, to: number) =>
    obs({ metricType: 'active_energy', value: kcal, unit: 'kcal', startTime: new Date(T0 + from), endTime: new Date(T0 + to) });

  it('adds the energy records that fall inside the run', () => {
    const total = sumActiveEnergyKcal([energy(40, 0, 60_000), energy(35.4, 60_000, 120_000), energy(500, 900_000, 960_000)], T0, T0 + 200_000);
    expect(total).toBe(75);
  });

  it('is null when the watch reported none, never zero', () => {
    expect(sumActiveEnergyKcal([], T0, T0 + 1000)).toBeNull();
    expect(sumActiveEnergyKcal([energy(40, 900_000, 960_000)], T0, T0 + 1000)).toBeNull();
  });

  it('ignores a record that is not in kilocalories or is not a sensible amount', () => {
    expect(sumActiveEnergyKcal([obs({ metricType: 'active_energy', value: 40, unit: 'kJ' })], T0, T0 + 5000)).toBeNull();
    expect(sumActiveEnergyKcal([energy(-3, 0, 1000)], T0, T0 + 5000)).toBeNull();
  });
});

describe('prepareRunHealth', () => {
  it('asks Health Connect once, on the first run, and marks it asked', async () => {
    const provider = new FakeHealthProvider();
    const request = jest.spyOn(provider, 'requestPermissions');
    const markAsked = jest.fn().mockResolvedValue(undefined);

    const reader = await prepareRunHealth(provider, { alreadyAsked: false, markAsked });

    expect(reader).not.toBeNull();
    expect(request).toHaveBeenCalledWith(['heart_rate', 'active_energy']);
    expect(markAsked).toHaveBeenCalledTimes(1);
  });

  it('counts the ask as made even if the request itself fails, so it is never repeated', async () => {
    const provider = new FakeHealthProvider();
    jest.spyOn(provider, 'requestPermissions').mockRejectedValue(new Error('dialog failed'));
    const markAsked = jest.fn().mockResolvedValue(undefined);

    expect(await prepareRunHealth(provider, { alreadyAsked: false, markAsked })).toBeNull();
    expect(markAsked).toHaveBeenCalledTimes(1);
  });

  it('does not ask again on later runs: it only reads', async () => {
    const provider = new FakeHealthProvider();
    const request = jest.spyOn(provider, 'requestPermissions');
    const markAsked = jest.fn();

    await prepareRunHealth(provider, { alreadyAsked: true, markAsked });

    expect(request).not.toHaveBeenCalled();
    expect(markAsked).not.toHaveBeenCalled();
  });

  it('has no reader when the person says no to heart rate', async () => {
    const provider = new FakeHealthProvider({ supportedMetrics: ['steps'] });
    expect(await prepareRunHealth(provider, { alreadyAsked: false, markAsked: jest.fn() })).toBeNull();
  });

  it('has no reader when Health Connect is not available, and never throws', async () => {
    const provider: HealthProvider = {
      source: 'health_connect',
      connect: jest.fn().mockRejectedValue(new Error('not available')),
      disconnect: jest.fn(),
      getCapabilities: jest.fn(),
      requestPermissions: jest.fn(),
      sync: jest.fn(),
    };
    await expect(prepareRunHealth(provider, { alreadyAsked: false, markAsked: jest.fn() })).resolves.toBeNull();
  });

  it('reads heart rate from the start of the run', async () => {
    const provider = new FakeHealthProvider({ observations: [obs({ value: 152 })] });
    const reader = await prepareRunHealth(provider, { alreadyAsked: false, markAsked: jest.fn() });
    expect(await reader?.readHeartRate(T0)).toEqual([{ timestampMs: T0 + 1000, bpm: 152 }]);
  });
});

describe('readFinalHealth', () => {
  it('returns heart rate and calories together', async () => {
    const provider = new FakeHealthProvider({
      observations: [
        obs({ value: 150 }),
        obs({ metricType: 'active_energy', value: 210, unit: 'kcal', startTime: new Date(T0 + 1000), endTime: new Date(T0 + 60_000) }),
      ],
    });
    const reader = await prepareRunHealth(provider, { alreadyAsked: false, markAsked: jest.fn() });

    const result = await readFinalHealth(reader, T0, T0 + 120_000, 1000);

    expect(result.heartRate).toHaveLength(1);
    expect(result.caloriesKcal).toBe(210);
  });

  it('gives nothing, quickly, when there is no reader or the watch is slow', async () => {
    expect(await readFinalHealth(null, T0, T0 + 1000, 1000)).toEqual({ heartRate: [], caloriesKcal: null });

    const slow = { readHeartRate: () => new Promise<never>(() => undefined), readActiveEnergyKcal: () => new Promise<never>(() => undefined) };
    expect(await readFinalHealth(slow, T0, T0 + 1000, 20)).toEqual({ heartRate: [], caloriesKcal: null });
  });

  it('gives nothing when a read fails, so a finished run is never lost to a watch', async () => {
    const broken = { readHeartRate: jest.fn().mockRejectedValue(new Error('x')), readActiveEnergyKcal: jest.fn().mockRejectedValue(new Error('x')) };
    expect(await readFinalHealth(broken, T0, T0 + 1000, 1000)).toEqual({ heartRate: [], caloriesKcal: null });
  });
});

describe('polling', () => {
  it('polls every half minute, gently, because watches sync in batches', () => {
    expect(HEART_RATE_POLL_MS).toBe(30_000);
  });
});
