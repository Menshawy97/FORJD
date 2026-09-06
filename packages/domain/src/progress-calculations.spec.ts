import {
  MUSCLE_GROUPS,
  MUSCLE_SPLIT_BUCKETS,
  MUSCLE_SPLIT_BUCKET_DISPLAY_NAMES,
  distributeSetVolume,
  muscleSplitBucketFor,
  toPercentages,
  type MuscleSplitBucket,
} from './index';

describe('muscleSplitBucketFor', () => {
  it('maps every canonical muscle group to a bucket or explicitly excludes it', () => {
    // Totality: a muscle added to MUSCLE_GROUPS later must be classified deliberately, not
    // silently dropped into `undefined` and then silently dropped from the chart.
    for (const muscle of MUSCLE_GROUPS) {
      const bucket = muscleSplitBucketFor(muscle);
      expect(bucket === null || MUSCLE_SPLIT_BUCKETS.includes(bucket)).toBe(true);
    }
  });

  it('collapses the four back-adjacent vocabulary values into one Back bucket', () => {
    // `back`, `lats`, `traps` and `lower_back` are separate values in the vocabulary, so a
    // naive group-by would draw four "back" rows in a chart the design gives one.
    expect(muscleSplitBucketFor('back')).toBe('back');
    expect(muscleSplitBucketFor('lats')).toBe('back');
    expect(muscleSplitBucketFor('traps')).toBe('back');
    expect(muscleSplitBucketFor('lower_back')).toBe('back');
  });

  it('collapses every lower-body value into Legs', () => {
    for (const muscle of ['quads', 'hamstrings', 'glutes', 'calves', 'hips', 'abductors', 'adductors'] as const) {
      expect(muscleSplitBucketFor(muscle)).toBe('legs');
    }
  });

  it('collapses the three arm values into Arms', () => {
    expect(muscleSplitBucketFor('biceps')).toBe('arms');
    expect(muscleSplitBucketFor('triceps')).toBe('arms');
    expect(muscleSplitBucketFor('forearms')).toBe('arms');
  });

  it('maps chest, shoulders and core to their own buckets', () => {
    expect(muscleSplitBucketFor('chest')).toBe('chest');
    expect(muscleSplitBucketFor('shoulders')).toBe('shoulders');
    expect(muscleSplitBucketFor('core')).toBe('core');
  });

  it('excludes full_body and neck rather than mis-attributing them', () => {
    // `full_body` belongs to every bucket, which means it distinguishes nothing; `neck` has no
    // row in the design. Attributing either would move the percentages without informing them.
    expect(muscleSplitBucketFor('full_body')).toBeNull();
    expect(muscleSplitBucketFor('neck')).toBeNull();
  });

  it('gives every bucket a display name', () => {
    for (const bucket of MUSCLE_SPLIT_BUCKETS) {
      expect(MUSCLE_SPLIT_BUCKET_DISPLAY_NAMES[bucket]).toBeTruthy();
    }
    expect(Object.keys(MUSCLE_SPLIT_BUCKET_DISPLAY_NAMES).sort()).toEqual([...MUSCLE_SPLIT_BUCKETS].sort());
  });
});

describe('distributeSetVolume', () => {
  it('divides a set volume equally among the buckets it trains', () => {
    expect(distributeSetVolume(100, ['legs', 'back'])).toEqual({ legs: 50, back: 50 });
  });

  it('gives the whole volume to a single bucket', () => {
    expect(distributeSetVolume(90, ['chest'])).toEqual({ chest: 90 });
  });

  it('deduplicates buckets so a two-primary exercise mapping to one bucket is not double counted', () => {
    // A lift listing `lats` and `traps` trains the back once, not twice.
    expect(distributeSetVolume(60, ['back', 'back'])).toEqual({ back: 60 });
  });

  it('returns nothing when no bucket applies', () => {
    expect(distributeSetVolume(100, [])).toEqual({});
  });

  it('never invents volume: the parts sum to the whole', () => {
    const distributed = distributeSetVolume(100, ['legs', 'back', 'core']);
    const total = Object.values(distributed).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(100, 10);
  });
});

describe('toPercentages', () => {
  it('reproduces the design reference split exactly', () => {
    // The design's own figures (progress strength 2.png): 28/22/18/14/12/6, summing to 100.
    const result = toPercentages({ legs: 28, back: 22, chest: 18, shoulders: 14, arms: 12, core: 6 });
    expect(result).toEqual([
      { bucket: 'legs', percent: 28 },
      { bucket: 'back', percent: 22 },
      { bucket: 'chest', percent: 18 },
      { bucket: 'shoulders', percent: 14 },
      { bucket: 'arms', percent: 12 },
      { bucket: 'core', percent: 6 },
    ]);
  });

  it('returns whole numbers that sum to exactly 100 even when the raw shares do not round cleanly', () => {
    // Three equal thirds naively round to 33/33/33 = 99. Largest-remainder must not lose the
    // point, because a chart whose labels sum to 99% reads as a bug.
    const result = toPercentages({ legs: 1, back: 1, chest: 1 });
    expect(result.reduce((sum, row) => sum + row.percent, 0)).toBe(100);
  });

  it('sums to exactly 100 across an awkward seven-way split', () => {
    const result = toPercentages({ legs: 1, back: 1, chest: 1, shoulders: 1, arms: 1, core: 1 });
    expect(result.reduce((sum, row) => sum + row.percent, 0)).toBe(100);
  });

  it('orders rows by descending share, as the design lists them', () => {
    const result = toPercentages({ core: 5, legs: 50, back: 45 });
    expect(result.map((row) => row.bucket)).toEqual(['legs', 'back', 'core']);
  });

  it('omits buckets with no volume rather than drawing empty rows', () => {
    const result = toPercentages({ legs: 100, back: 0 });
    expect(result.map((row) => row.bucket)).toEqual(['legs']);
  });

  it('returns an empty list when nothing was trained', () => {
    expect(toPercentages({})).toEqual([]);
    const allZero: Partial<Record<MuscleSplitBucket, number>> = { legs: 0 };
    expect(toPercentages(allZero)).toEqual([]);
  });
});
