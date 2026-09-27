import type { ForgeLadderProgress } from '@forjd/contracts';
import { FORGE_LADDER_UNITS, maxLevelOf, targetOf, type ForgeLadder } from '@forjd/domain';

import { outlookLine } from '../forge-outlook-copy';

// The ladder screen's "what this week does" line (weekly-forge-explainer-plan.md, X3). The first
// four cases are the exact lines approved in the mock-ups (sections D and E).
const progress = (
  ladder: ForgeLadder,
  level: number,
  total: number,
  over: Partial<ForgeLadderProgress> = {},
): ForgeLadderProgress => ({
  ladder,
  unit: FORGE_LADDER_UNITS[ladder] as ForgeLadderProgress['unit'],
  band: 'ore',
  level,
  maxLevel: maxLevelOf(ladder),
  target: targetOf(ladder, level),
  total,
  progress: Math.min(1, total / targetOf(ladder, level)),
  missStreak: 0,
  temperedHoldWeeks: 0,
  forgedStreak: 0,
  bestForgedStreak: 0,
  badges: [],
  ...over,
});

describe('outlookLine', () => {
  it('names the level a met goal reaches, and the total for the next jump (mock-up D)', () => {
    expect(outlookLine(progress('volume', 4, 6250))).toBe(
      '6,250 kg takes you to level 5 on Saturday. Reach 10,000 kg by Friday to jump to level 6.',
    );
  });

  it('names the goal while the week is still short (mock-up D, nothing logged)', () => {
    expect(outlookLine(progress('volume', 4, 0))).toBe('Hit 5,500 kg by Friday to reach level 5.');
  });

  it('keeps a Forged athlete Forged, counting workouts (mock-up E, Consistency)', () => {
    expect(outlookLine(progress('consistency', 6, 1, { band: 'forged', forgedStreak: 2 }))).toBe(
      "You're Forged. Finish 6 workouts by Friday to stay Forged. 1 done so far.",
    );
  });

  it('names the top of Nourish when the next level is its last (mock-up E, Nourish)', () => {
    expect(outlookLine(progress('nourish', 5, 0))).toBe(
      'Log meals on 5 days by Friday to reach level 6, the top of Nourish.',
    );
  });

  it('counts workouts for a Consistency week that is still short', () => {
    expect(outlookLine(progress('consistency', 3, 1))).toBe('Finish 3 workouts by Friday to reach level 4.');
  });

  it('uses a singular for one day or one workout', () => {
    expect(outlookLine(progress('nourish', 1, 0))).toBe('Log meals on 1 day by Friday to reach level 2.');
    expect(outlookLine(progress('consistency', 1, 0))).toBe('Finish 1 workout by Friday to reach level 2.');
  });

  it('keeps the top of Nourish once reached', () => {
    expect(outlookLine(progress('nourish', 6, 2))).toBe('Log meals on 6 days by Friday to stay at the top of Nourish.');
    expect(outlookLine(progress('nourish', 6, 6))).toBe('6 days keeps you at the top of Nourish.');
  });

  it('says a met Forged week keeps Forged when nothing higher is in reach', () => {
    expect(outlookLine(progress('consistency', 6, 6, { band: 'forged', forgedStreak: 1 }))).toBe(
      '6 workouts keeps you Forged.',
    );
  });

  it('reads a Forged total in the ladder unit while short', () => {
    expect(outlookLine(progress('distance', 13, 40, { band: 'forged', forgedStreak: 1 }))).toBe(
      "You're Forged. Reach 100 km by Friday to stay Forged. 40 km so far.",
    );
  });

  it('stops at the landing level when the week already climbs as far as a week can', () => {
    expect(outlookLine(progress('volume', 1, 1_000_000))).toBe('1,000,000 kg takes you to level 4 on Saturday.');
  });

  it('never promises Forged before the Tempered hold is done', () => {
    expect(outlookLine(progress('volume', 12, 50_000, { band: 'tempered', temperedHoldWeeks: 1 }))).toBe(
      '50,000 kg meets the goal. Forged opens after 4 weeks in a row in Tempered.',
    );
  });

  it('treats a missing hold count as no weeks held, so an older API never over-promises', () => {
    const withoutHold = Object.fromEntries(
      Object.entries(progress('volume', 12, 50_000, { band: 'tempered' })).filter(([key]) => key !== 'temperedHoldWeeks'),
    ) as unknown as ForgeLadderProgress;
    expect(outlookLine(withoutHold)).toBe('50,000 kg meets the goal. Forged opens after 4 weeks in a row in Tempered.');
  });
});
