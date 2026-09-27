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

// The table the user accepted on 2026-09-27 (docs/product/weekly-forge-plan.md). A change to any
// value is a product decision, so these are pinned literally rather than recomputed here.
const ACCEPTED: Record<string, Record<string, number[]>> = {
  volume: {
    ore: [2000, 2500, 3000, 3500, 4200, 5000],
    ember: [5600, 6250, 7000, 7850, 8800, 9850, 11050],
    anvil: [12400, 13850, 15550, 17400, 19500, 21800, 24450, 27350],
    tempered: [30650, 34350, 38450, 43050, 48250, 54000],
    forged: [60500, 67750, 75900, 85000, 95200, 106600],
  },
  distance: {
    ore: [3, 5, 7, 9, 11, 13],
    ember: [14.5, 16.5, 18.5, 20.5, 23, 25.5, 28.5],
    anvil: [32, 36, 40.5, 45, 50.5, 56.5, 63.5, 71],
    tempered: [79.5, 89.5, 100, 112, 125.5, 140.5],
    forged: [157.5, 176, 197.5, 221, 247.5, 277],
  },
  minutes: {
    ore: [60, 80, 100, 120, 135, 150],
    ember: [170, 190, 210, 235, 265, 295],
    anvil: [330, 370, 415, 465, 520, 585, 655],
    tempered: [735, 820, 920],
    forged: [1030, 1155, 1290],
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
    'grows %s by 12% a level from Ember up, within rounding',
    (ladder) => {
      const fromEmber = FORGE_TIERS[ladder].filter((tier) => tier.band !== 'ore').map((t) => t.target);
      for (let i = 1; i < fromEmber.length; i += 1) {
        expect(fromEmber[i]! / fromEmber[i - 1]!).toBeGreaterThan(1.1);
        expect(fromEmber[i]! / fromEmber[i - 1]!).toBeLessThan(1.14);
      }
    },
  );

  it('caps Nourish at six days a week, ending at Anvil with no Forged tier', () => {
    expect(maxLevelOf('nourish')).toBe(6);
    expect(targetOf('nourish', 6)).toBe(6);
    expect(maxBandOf('nourish')).toBe('anvil');
  });
});

describe('lookups', () => {
  it('reads the band and target of a level', () => {
    expect(bandOf('volume', 1)).toBe('ore');
    expect(bandOf('volume', 7)).toBe('ember');
    expect(targetOf('volume', 7)).toBe(5600);
    expect(bandOf('consistency', 6)).toBe('forged');
  });

  it('finds the first and top level of a band', () => {
    expect(firstLevelOf('volume', 'anvil')).toBe(14);
    expect(topLevelOf('volume', 'tempered')).toBe(27);
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
