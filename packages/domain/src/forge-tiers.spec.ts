import { FORGE_BANDS, FORGE_LADDERS } from './forge-vocabulary';
import {
  bandOf,
  firstLevelOf,
  FORGE_TIERS,
  maxBandOf,
  maxLevelOf,
  targetOf,
  topLevelOf,
} from './forge-tiers';

// The table the user approved on 2026-09-27 (ADR-058, replacing ADR-057's 12%-per-level table). A
// change to any value is a product decision, so these are pinned literally rather than recomputed.
const ACCEPTED: Record<string, Record<string, number[]>> = {
  volume: {
    ore: [2000, 3000, 4000],
    ember: [5500, 7500, 10000],
    anvil: [13000, 17000, 22000],
    tempered: [28000, 35000, 43000],
    forged: [52000, 62000, 75000],
  },
  distance: {
    ore: [5, 8, 12],
    ember: [16, 21, 27],
    anvil: [34, 42, 52],
    tempered: [63, 75, 88],
    forged: [100, 115, 130],
  },
  minutes: {
    ore: [60, 90, 120],
    ember: [150, 190, 230],
    anvil: [300, 360, 420],
    tempered: [480, 560, 640],
    forged: [720, 810, 900],
  },
  consistency: {
    ore: [1, 2],
    ember: [3],
    anvil: [4],
    tempered: [5],
    forged: [6],
  },
  nourish: {
    ore: [1, 2],
    ember: [3, 4],
    anvil: [5, 6],
  },
};

describe('FORGE_TIERS', () => {
  it.each(FORGE_LADDERS)('matches the accepted table for %s, band by band', (ladder) => {
    const byBand: Record<string, number[]> = {};
    for (const tier of FORGE_TIERS[ladder]) {
      (byBand[tier.band] ??= []).push(tier.target);
    }
    expect(byBand).toEqual(ACCEPTED[ladder]);
  });

  it.each(FORGE_LADDERS)('numbers %s levels 1..n with no gaps', (ladder) => {
    expect(FORGE_TIERS[ladder].map((tier) => tier.level)).toEqual(
      FORGE_TIERS[ladder].map((_, index) => index + 1),
    );
  });

  it.each(FORGE_LADDERS)('makes every %s target strictly higher than the one before', (ladder) => {
    const targets = FORGE_TIERS[ladder].map((tier) => tier.target);
    for (let i = 1; i < targets.length; i += 1) {
      expect(targets[i]!).toBeGreaterThan(targets[i - 1]!);
    }
  });

  it.each(FORGE_LADDERS)('keeps %s bands in forge order, never interleaved', (ladder) => {
    const order = FORGE_TIERS[ladder].map((tier) => FORGE_BANDS.indexOf(tier.band));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each(['volume', 'distance', 'minutes'] as const)(
    'gives %s exactly three levels in every band, fifteen in all (ADR-058 decision 1)',
    (ladder) => {
      for (const band of FORGE_BANDS) {
        expect(FORGE_TIERS[ladder].filter((tier) => tier.band === band)).toHaveLength(3);
      }
      expect(maxLevelOf(ladder)).toBe(15);
    },
  );

  it('starts the bands where ADR-058 pins them to its sources', () => {
    // WHO: 150 to 300 minutes a week (R1).
    expect(targetOf('minutes', firstLevelOf('minutes', 'ember')!)).toBe(150);
    expect(targetOf('minutes', firstLevelOf('minutes', 'anvil')!)).toBe(300);
    // The fastest marathoners and the high-volume plans train at 100 km a week or more (R5, R6).
    expect(targetOf('distance', firstLevelOf('distance', 'forged')!)).toBe(100);
  });

  it('caps Nourish at six days a week, ending at Anvil with no Forged tier', () => {
    expect(maxLevelOf('nourish')).toBe(6);
    expect(targetOf('nourish', 6)).toBe(6);
    expect(maxBandOf('nourish')).toBe('anvil');
  });
});

describe('lookups', () => {
  it('reads the band and target of a level', () => {
    expect(bandOf('volume', 1)).toBe('ore');
    expect(bandOf('volume', 4)).toBe('ember');
    expect(targetOf('volume', 4)).toBe(5500);
    expect(bandOf('consistency', 6)).toBe('forged');
  });

  it('finds the first and top level of a band', () => {
    expect(firstLevelOf('volume', 'anvil')).toBe(7);
    expect(topLevelOf('volume', 'tempered')).toBe(12);
    expect(topLevelOf('consistency', 'tempered')).toBe(5);
    expect(firstLevelOf('nourish', 'forged')).toBeNull();
    expect(topLevelOf('nourish', 'tempered')).toBeNull();
  });

  it('reports the highest band each ladder reaches', () => {
    expect(maxBandOf('volume')).toBe('forged');
    expect(maxBandOf('consistency')).toBe('forged');
  });

  it('refuses a level outside the ladder rather than inventing a target', () => {
    expect(() => targetOf('volume', 0)).toThrow(RangeError);
    expect(() => bandOf('nourish', 7)).toThrow(RangeError);
    expect(() => targetOf('volume', 1.5)).toThrow(RangeError);
  });
});
