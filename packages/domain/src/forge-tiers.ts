import { FORGE_BANDS, ForgeBand, ForgeLadder } from './forge-vocabulary';

/**
 * Weekly Forge's tier table: every level's weekly target, per ladder (ADR-057 decision 6).
 *
 * **This file is the single source.** The `forge:seed` script copies it into `forge_ladders` and
 * `forge_tiers` on every deploy, and no other code carries a target. The values were accepted by
 * the user on 2026-09-27 (docs/product/weekly-forge-plan.md).
 *
 * - Ore is written by hand, so beginners see friendly round numbers.
 * - From Ember up, each level is 12% above the one before, computed on the unrounded chain and then
 *   rounded (Volume to 50 kg, Distance to 0.5 km, Minutes to 5 minutes), so every climb is equally
 *   hard. Ember has 7 levels and Anvil 8, so the band widths match the brief's anchors.
 * - Active minutes has only 3 levels each in Tempered and Forged: at 12% a level, six each would
 *   reach about 40 hours a week.
 * - Consistency is one step per band (Forged is 6 workouts, held through the 4-week gate).
 * - Nourish counts days with meals logged, tops out at 6, and ends at Anvil.
 */
export interface ForgeTier {
  /** 1-based, contiguous. */
  level: number;
  band: ForgeBand;
  /** The weekly total that meets this level, in the ladder's unit. */
  target: number;
}

type BandTargets = Partial<Record<ForgeBand, readonly number[]>>;

const TARGETS: Record<ForgeLadder, BandTargets> = {
  consistency: {
    ore: [1, 2],
    ember: [3],
    anvil: [4],
    tempered: [5],
    forged: [6],
  },
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
  nourish: {
    ore: [1, 2],
    ember: [3, 4],
    anvil: [5, 6],
  },
};

function build(bands: BandTargets): readonly ForgeTier[] {
  const tiers: ForgeTier[] = [];
  for (const band of FORGE_BANDS) {
    for (const target of bands[band] ?? []) {
      tiers.push({ level: tiers.length + 1, band, target });
    }
  }
  return tiers;
}

export const FORGE_TIERS: Record<ForgeLadder, readonly ForgeTier[]> = {
  consistency: build(TARGETS.consistency),
  volume: build(TARGETS.volume),
  distance: build(TARGETS.distance),
  minutes: build(TARGETS.minutes),
  nourish: build(TARGETS.nourish),
};

function tierAt(ladder: ForgeLadder, level: number): ForgeTier {
  const tier = Number.isInteger(level) ? FORGE_TIERS[ladder][level - 1] : undefined;
  if (!tier) {
    throw new RangeError(`${ladder} has no level ${level}`);
  }
  return tier;
}

export function maxLevelOf(ladder: ForgeLadder): number {
  return FORGE_TIERS[ladder].length;
}

export function targetOf(ladder: ForgeLadder, level: number): number {
  return tierAt(ladder, level).target;
}

export function bandOf(ladder: ForgeLadder, level: number): ForgeBand {
  return tierAt(ladder, level).band;
}

/** The highest band a ladder reaches: Forged for most, Anvil for Nourish. */
export function maxBandOf(ladder: ForgeLadder): ForgeBand {
  return bandOf(ladder, maxLevelOf(ladder));
}

/** The first level of a band on a ladder, or `null` when the ladder has no such band. */
export function firstLevelOf(ladder: ForgeLadder, band: ForgeBand): number | null {
  return FORGE_TIERS[ladder].find((tier) => tier.band === band)?.level ?? null;
}

/** The top level of a band on a ladder, or `null` when the ladder has no such band. */
export function topLevelOf(ladder: ForgeLadder, band: ForgeBand): number | null {
  const inBand = FORGE_TIERS[ladder].filter((tier) => tier.band === band);
  return inBand.length > 0 ? inBand[inBand.length - 1]!.level : null;
}
