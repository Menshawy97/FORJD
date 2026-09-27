import { FORGE_BANDS, ForgeBand, ForgeLadder } from './forge-vocabulary';

/**
 * Weekly Forge's tier table: every level's weekly target, per ladder (ADR-057 decision 6, as
 * amended by ADR-058).
 *
 * **This file is the single source.** The `forge:seed` script copies it into `forge_ladders` and
 * `forge_tiers` on every deploy, and no other code carries a target. The values were approved by
 * the user on 2026-09-27 (docs/decisions/ADR-058-weekly-forge-fifteen-levels.md).
 *
 * - Volume, Distance and Active minutes have 3 levels in every band, 15 in total.
 * - Each band starts where a published source puts it (ADR-058 decision 2): 150 and 300 minutes
 *   are the WHO weekly range, and Forged Distance starts at the 100 km the fastest marathoners run.
 *   The steps inside a band are even round numbers.
 * - Volume's kilograms are an estimate built from the sources' sets and reps (ADR-058 decision 3).
 * - Consistency is one step per band, two in Ore (Forged is 6 workouts, held through the 4-week gate).
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
